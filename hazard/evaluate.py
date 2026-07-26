"""Study-grouped evaluation for development and locked external corpora."""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score

from corpus.contracts import MatchProfile, MatchSource
from corpus.evidence import lock_external_benchmark
from .fit import ModelArtifact, fit_hazard
from .predict import predict_hazard


def profile_from_row(row: pd.Series) -> MatchProfile:
    def integer(name: str) -> int:
        value = pd.to_numeric(row.get(name, 0), errors="coerce")
        return 0 if pd.isna(value) else int(value)

    source = MatchSource(str(row.match_source))
    evidence = {"recomputed": "verified", "reported": "reported", "inferred": "inferred"}[source.value]
    embedding = pd.to_numeric(row.get("embedding_similarity", np.nan), errors="coerce")
    return MatchProfile(
        nontarget_species=str(row.nontarget_species),
        max_contiguous_match_nt=integer("max_contiguous_match_nt"),
        n_21mers_perfect=integer("n_21mers_perfect"),
        n_21mers_1mm=integer("n_21mers_1mm"),
        n_21mers_2mm=integer("n_21mers_2mm"),
        embedding_similarity=None if pd.isna(embedding) else float(embedding),
        match_source=source,
        sequence_evidence_level=evidence,
    )


def predict_frame(artifact: ModelArtifact, frame: pd.DataFrame) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for index, row in frame.iterrows():
        estimate = predict_hazard(
            artifact,
            profile_from_row(row),
            dose_ng_per_uL=float(row.dose_ng_per_uL),
            construct_len_nt=int(row.construct_len_nt),
            matched_gene_essential=str(row.matched_gene_essential).lower() == "true",
            nontarget_order=str(row.nontarget_order),
            endpoint=str(row.endpoint),
            exposure_route=str(row.exposure_route),
            seed=20260725 + int(index),
        )
        rows.append({"row_index": int(index), "study_id": str(row.study_id), **asdict(estimate)})
    return pd.DataFrame(rows)


def classification_metrics(y_true: np.ndarray, probability: np.ndarray) -> dict[str, float | None]:
    metrics: dict[str, float | None] = {"brier": float(brier_score_loss(y_true, probability))}
    if len(np.unique(y_true)) == 2:
        metrics["roc_auc"] = float(roc_auc_score(y_true, probability))
        metrics["average_precision"] = float(average_precision_score(y_true, probability))
    else:
        metrics.update({"roc_auc": None, "average_precision": None})
    # Calibration intercept/slope are estimated only when finite logits exist.
    clipped = np.clip(probability, 1e-6, 1 - 1e-6)
    logits = np.log(clipped / (1 - clipped))
    if len(np.unique(y_true)) == 2 and np.std(logits) > 1e-8:
        from sklearn.linear_model import LogisticRegression

        calibration = LogisticRegression(C=1e6, solver="lbfgs").fit(logits[:, None], y_true)
        metrics["calibration_intercept"] = float(calibration.intercept_[0])
        metrics["calibration_slope"] = float(calibration.coef_[0, 0])
    else:
        metrics.update({"calibration_intercept": None, "calibration_slope": None})
    return metrics


def leave_one_study_out(
    development: pd.DataFrame,
    *,
    draws: int = 250,
    tune: int = 250,
    chains: int = 2,
) -> tuple[pd.DataFrame, dict[str, float | None]]:
    """Fit each fold without all rows from its held-out study."""
    predictions: list[pd.DataFrame] = []
    for study in sorted(development.study_id.astype(str).unique()):
        train = development[development.study_id.astype(str) != study].reset_index(drop=True)
        test = development[development.study_id.astype(str) == study].reset_index(drop=True)
        artifact = fit_hazard(train, draws=draws, tune=tune, chains=chains, seed=20260725)
        fold = predict_frame(artifact, test)
        fold["held_out_study"] = study
        fold["observed_effect"] = test.significant.astype(str).str.lower().eq("true").to_numpy()
        predictions.append(fold)
    result = pd.concat(predictions, ignore_index=True)
    return result, classification_metrics(result.observed_effect.to_numpy(), result.p_effect.to_numpy())


def evaluate_locked_external(
    artifact: ModelArtifact,
    development: pd.DataFrame,
    external_path: str,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Evaluate once a study-disjoint external corpus has been locked."""
    lock = lock_external_benchmark(development, external_path)
    external = pd.read_csv(external_path)
    predictions = predict_frame(artifact, external)
    predictions["observed_effect"] = external.significant.astype(str).str.lower().eq("true").to_numpy()
    return predictions, {"lock": lock, "metrics": classification_metrics(predictions.observed_effect.to_numpy(), predictions.p_effect.to_numpy())}
