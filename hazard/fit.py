"""Hierarchical Bayesian hazard model for heterogeneous RNAi bioassays."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import arviz as az
import numpy as np
import pandas as pd
import pymc as pm

from corpus.evidence import SOURCE_SD_NT

MODEL_VERSION = "hazard-hb-v1"


@dataclass
class ModelArtifact:
    idata: az.InferenceData
    metadata: dict[str, Any]

    def save(self, directory: Path | str) -> Path:
        directory = Path(directory)
        directory.mkdir(parents=True, exist_ok=True)
        az.to_netcdf(self.idata, directory / "posterior.nc")
        (directory / "metadata.json").write_text(
            json.dumps(self.metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        return directory

    @classmethod
    def load(cls, directory: Path | str) -> "ModelArtifact":
        directory = Path(directory)
        return cls(
            idata=az.from_netcdf(directory / "posterior.nc"),
            metadata=json.loads((directory / "metadata.json").read_text(encoding="utf-8")),
        )


def _bools(series: pd.Series) -> np.ndarray:
    return series.astype(str).str.lower().eq("true").astype(int).to_numpy()


def _category(values: pd.Series) -> tuple[np.ndarray, list[str]]:
    levels = sorted(values.astype(str).unique())
    lookup = {value: index for index, value in enumerate(levels)}
    return values.astype(str).map(lookup).to_numpy(), levels


def prepare_training_data(df: pd.DataFrame) -> tuple[dict[str, Any], dict[str, Any]]:
    """Encode a corpus without inspecting outcomes during standardization."""
    required = {
        "study_id", "nontarget_order", "endpoint", "exposure_route", "significant",
        "max_contiguous_match_nt", "n_21mers_perfect", "dose_ng_per_uL",
        "construct_len_nt", "matched_gene_essential", "match_source",
    }
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Hazard corpus missing fields: {sorted(missing)}")

    numeric_raw = pd.DataFrame(
        {
            "sequence_burden": pd.to_numeric(df.max_contiguous_match_nt)
            + 0.5 * np.log1p(pd.to_numeric(df.n_21mers_perfect)),
            "log_dose": np.log1p(pd.to_numeric(df.dose_ng_per_uL).clip(lower=0)),
            "construct_len": pd.to_numeric(df.construct_len_nt),
            "essential_hit": _bools(df.matched_gene_essential),
        }
    )
    means = numeric_raw.mean().to_dict()
    scales = numeric_raw.std(ddof=0).replace(0, 1.0).to_dict()
    scaled = (numeric_raw - pd.Series(means)) / pd.Series(scales)
    order_idx, order_levels = _category(df.nontarget_order)
    endpoint_idx, endpoint_levels = _category(df.endpoint)
    route_idx, route_levels = _category(df.exposure_route)
    study_idx, study_levels = _category(df.study_id)

    embedding_values = pd.to_numeric(df.get("embedding_similarity", pd.Series(np.nan, index=df.index)), errors="coerce")
    embedding_observed = embedding_values.notna().to_numpy()
    use_embedding = int(embedding_observed.sum()) >= 10 and np.nanstd(embedding_values) > 1e-6
    metadata = {
        "model_version": MODEL_VERSION,
        "n_rows": len(df),
        "n_studies": len(study_levels),
        "numeric_means": means,
        "numeric_scales": scales,
        "numeric_ranges": {
            column: [float(numeric_raw[column].min()), float(numeric_raw[column].max())]
            for column in numeric_raw
        },
        "levels": {
            "order": order_levels,
            "endpoint": endpoint_levels,
            "route": route_levels,
            "study": study_levels,
        },
        "use_embedding": use_embedding,
        "embedding_observed_rows": int(embedding_observed.sum()),
        "feature_spec": "sequence_burden=max_contiguous_match_nt + 0.5*log1p(n_21mers_perfect)",
    }
    data: dict[str, Any] = {
        "y": _bools(df.significant),
        "sequence_obs": scaled.sequence_burden.to_numpy(),
        "sequence_sd": df.match_source.astype(str).map(SOURCE_SD_NT).to_numpy() / scales["sequence_burden"],
        "log_dose": scaled.log_dose.to_numpy(),
        "construct_len": scaled.construct_len.to_numpy(),
        "essential_hit": scaled.essential_hit.to_numpy(),
        "order_idx": order_idx,
        "endpoint_idx": endpoint_idx,
        "route_idx": route_idx,
        "study_idx": study_idx,
        "n_order": len(order_levels),
        "n_endpoint": len(endpoint_levels),
        "n_route": len(route_levels),
        "n_study": len(study_levels),
    }
    if use_embedding:
        observed = embedding_values[embedding_observed].to_numpy(dtype=float)
        embedding_mean = float(np.mean(observed))
        embedding_scale = float(np.std(observed)) or 1.0
        data.update(
            {
                "embedding_values": (observed - embedding_mean) / embedding_scale,
                "embedding_observed_idx": np.flatnonzero(embedding_observed),
                "embedding_mean": embedding_mean,
                "embedding_scale": embedding_scale,
            }
        )
        metadata.update({"embedding_mean": embedding_mean, "embedding_scale": embedding_scale})
    return data, metadata


def fit_hazard(
    df: pd.DataFrame,
    *,
    draws: int = 500,
    tune: int = 500,
    chains: int = 2,
    seed: int = 20260725,
    progressbar: bool = False,
) -> ModelArtifact:
    """Fit a partial-pooling logistic model with match-source measurement error."""
    data, metadata = prepare_training_data(df)
    coords = {
        "observation": np.arange(len(data["y"])),
        "order": metadata["levels"]["order"],
        "endpoint": metadata["levels"]["endpoint"],
        "route": metadata["levels"]["route"],
        "study": metadata["levels"]["study"],
    }
    with pm.Model(coords=coords) as model:
        sequence_true = pm.Normal(
            "sequence_burden_true",
            mu=data["sequence_obs"],
            sigma=data["sequence_sd"],
            dims="observation",
        )
        intercept = pm.Normal("intercept", 0.0, 1.5)
        beta_sequence = pm.Normal("beta_sequence", 0.0, 1.0)
        beta_dose = pm.Normal("beta_dose", 0.0, 1.0)
        beta_length = pm.Normal("beta_length", 0.0, 1.0)
        beta_essential = pm.Normal("beta_essential", 0.0, 1.0)

        def pooled(name: str, dimension: str):
            sigma = pm.HalfNormal(f"sigma_{name}", 0.75)
            offset = pm.Normal(f"{name}_offset", 0.0, 1.0, dims=dimension)
            return pm.Deterministic(f"{name}_effect", sigma * offset, dims=dimension)

        order_effect = pooled("order", "order")
        endpoint_effect = pooled("endpoint", "endpoint")
        route_effect = pooled("route", "route")
        study_effect = pooled("study", "study")
        linear = (
            intercept
            + beta_sequence * sequence_true
            + beta_dose * data["log_dose"]
            + beta_length * data["construct_len"]
            + beta_essential * data["essential_hit"]
            + order_effect[data["order_idx"]]
            + endpoint_effect[data["endpoint_idx"]]
            + route_effect[data["route_idx"]]
            + study_effect[data["study_idx"]]
        )
        if data.get("embedding_values") is not None:
            embedding_true = pm.Normal("embedding_true", 0.0, 1.0, dims="observation")
            pm.Normal(
                "embedding_observed",
                mu=embedding_true[data["embedding_observed_idx"]],
                sigma=0.05,
                observed=data["embedding_values"],
            )
            beta_embedding = pm.Normal("beta_embedding", 0.0, 1.0)
            linear = linear + beta_embedding * embedding_true
        pm.Bernoulli("effect", logit_p=linear, observed=data["y"], dims="observation")
        idata = pm.sample(
            draws=draws,
            tune=tune,
            chains=chains,
            cores=1,
            random_seed=seed,
            target_accept=0.92,
            progressbar=progressbar,
            idata_kwargs={"log_likelihood": True},
        )
        posterior_predictive = pm.sample_posterior_predictive(
            idata, var_names=["effect"], random_seed=seed, progressbar=progressbar
        )
        idata.extend(posterior_predictive)
    metadata["sampling"] = {"draws": draws, "tune": tune, "chains": chains, "seed": seed}
    return ModelArtifact(idata=idata, metadata=metadata)
