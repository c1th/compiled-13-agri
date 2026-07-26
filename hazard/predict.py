"""Posterior prediction and extrapolation flags for a fitted hazard model."""

from __future__ import annotations

import numpy as np

from corpus.contracts import HazardEstimate, MatchProfile
from corpus.evidence import source_sd
from .fit import ModelArtifact


def _draws(artifact: ModelArtifact, name: str) -> np.ndarray:
    return np.asarray(artifact.idata.posterior[name]).reshape(-1, *artifact.idata.posterior[name].shape[2:])


def _group_effect(artifact: ModelArtifact, group: str, value: str, rng: np.random.Generator) -> tuple[np.ndarray, bool]:
    levels = artifact.metadata["levels"][group]
    effects = _draws(artifact, f"{group}_effect")
    if value in levels:
        return effects[:, levels.index(value)], False
    sigma = _draws(artifact, f"sigma_{group}")
    return rng.normal(0.0, sigma), True


def predict_hazard(
    artifact: ModelArtifact,
    profile: MatchProfile,
    *,
    dose_ng_per_uL: float,
    construct_len_nt: int,
    matched_gene_essential: bool,
    nontarget_order: str,
    endpoint: str,
    exposure_route: str,
    seed: int = 20260725,
) -> HazardEstimate:
    """Return a posterior predictive interval for one contextualized profile."""
    rng = np.random.default_rng(seed)
    means = artifact.metadata["numeric_means"]
    scales = artifact.metadata["numeric_scales"]
    sequence_burden = profile.max_contiguous_match_nt + 0.5 * np.log1p(profile.n_21mers_perfect)
    raw = {
        "sequence_burden": sequence_burden,
        "log_dose": np.log1p(max(0.0, dose_ng_per_uL)),
        "construct_len": float(construct_len_nt),
        "essential_hit": float(matched_gene_essential),
    }
    standardized = {name: (value - means[name]) / scales[name] for name, value in raw.items()}
    posterior_n = len(_draws(artifact, "intercept"))
    sequence_true = rng.normal(
        standardized["sequence_burden"],
        source_sd(profile.match_source.value) / scales["sequence_burden"],
        size=posterior_n,
    )
    linear = (
        _draws(artifact, "intercept")
        + _draws(artifact, "beta_sequence") * sequence_true
        + _draws(artifact, "beta_dose") * standardized["log_dose"]
        + _draws(artifact, "beta_length") * standardized["construct_len"]
        + _draws(artifact, "beta_essential") * standardized["essential_hit"]
    )
    notes: list[str] = []
    for group, value in (("order", nontarget_order), ("endpoint", endpoint), ("route", exposure_route)):
        effect, unseen = _group_effect(artifact, group, value, rng)
        linear += effect
        if unseen:
            notes.append(f"Unseen {group}; population-level partial pooling used.")
    # Predictions are for a new study, so draw its random effect rather than use
    # a training-study intercept.
    linear += rng.normal(0.0, _draws(artifact, "sigma_study"))
    if artifact.metadata["use_embedding"]:
        if profile.embedding_similarity is None:
            linear += _draws(artifact, "beta_embedding") * rng.normal(0.0, 1.0, size=posterior_n)
            notes.append("Embedding unavailable; similarity was marginalized under its training prior.")
        else:
            embedding = (profile.embedding_similarity - artifact.metadata["embedding_mean"]) / artifact.metadata["embedding_scale"]
            linear += _draws(artifact, "beta_embedding") * embedding
    probability = 1.0 / (1.0 + np.exp(-linear))
    ranges = artifact.metadata["numeric_ranges"]
    extrapolating = any(not (ranges[name][0] <= raw[name] <= ranges[name][1]) for name in raw)
    if profile.sequence_evidence_level != "verified":
        notes.append("Sequence match evidence is not fully recomputed; interval includes source-specific error.")
    if extrapolating:
        notes.append("One or more numeric inputs fall outside the development-corpus range.")
    return HazardEstimate(
        p_effect=float(np.mean(probability)),
        ci_low=float(np.quantile(probability, 0.025)),
        ci_high=float(np.quantile(probability, 0.975)),
        n_support=int(artifact.metadata["n_rows"]),
        extrapolating=extrapolating,
        sequence_evidence_level=profile.sequence_evidence_level,
        model_version=artifact.metadata["model_version"],
        endpoint=endpoint,
        exposure_route=exposure_route,
        uncertainty_notes=tuple(notes),
    )
