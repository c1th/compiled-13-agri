"""Corpus loading, quality rules, and strict external-benchmark handling."""

from __future__ import annotations

import hashlib
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DEVELOPMENT_PATH = ROOT / "corpus" / "bioassays.csv"
EXTERNAL_PATH = ROOT / "corpus" / "external_bioassays.csv"

REQUIRED_COLUMNS = {
    "study_id", "doi", "nontarget_species", "nontarget_order", "construct_len_nt",
    "max_contiguous_match_nt", "n_21mers_perfect", "dose_ng_per_uL",
    "exposure_route", "endpoint", "significant", "match_source", "normalization_rule",
}
VALID_MATCH_SOURCES = {"recomputed", "reported", "inferred"}
SOURCE_SD_NT = {"recomputed": 0.25, "reported": 1.5, "inferred": 3.5}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_corpus(path: Path | str = DEVELOPMENT_PATH) -> pd.DataFrame:
    path = Path(path)
    df = pd.read_csv(path)
    errors = validate_corpus(df)
    if errors:
        raise ValueError("Invalid corpus:\n- " + "\n- ".join(errors))
    return df


def validate_corpus(df: pd.DataFrame, *, min_studies: int = 1) -> list[str]:
    errors: list[str] = []
    missing = REQUIRED_COLUMNS - set(df.columns)
    if missing:
        return [f"missing columns: {sorted(missing)}"]
    if df.empty:
        return ["corpus has no rows"]
    if df.study_id.isna().any() or df.study_id.astype(str).str.strip().eq("").any():
        errors.append("study_id must be present for every row")
    if df.study_id.nunique() < min_studies:
        errors.append(f"requires at least {min_studies} distinct studies")
    if not set(df.match_source.astype(str)).issubset(VALID_MATCH_SOURCES):
        errors.append("match_source contains unsupported values")
    if (pd.to_numeric(df.construct_len_nt, errors="coerce") <= 0).any():
        errors.append("construct_len_nt must be positive")
    if (pd.to_numeric(df.dose_ng_per_uL, errors="coerce") < 0).any():
        errors.append("dose_ng_per_uL cannot be negative")
    if df[["endpoint", "exposure_route", "nontarget_order"]].isna().any().any():
        errors.append("endpoint, exposure_route, and nontarget_order must be present")
    return errors


def duplicate_assay_keys(df: pd.DataFrame) -> pd.DataFrame:
    """Return possible duplicate arms for curator review without rejecting constructs."""
    keys = ["study_id", "nontarget_species", "dose_ng_per_uL", "endpoint"]
    return df[df.duplicated(subset=keys, keep=False)].copy()


def source_sd(match_source: str) -> float:
    return SOURCE_SD_NT[str(match_source)]


def lock_external_benchmark(
    development: pd.DataFrame,
    external_path: Path | str = EXTERNAL_PATH,
    *,
    min_studies: int = 5,
) -> dict[str, str | int]:
    """Validate and fingerprint a study-disjoint external corpus before evaluation."""
    external_path = Path(external_path)
    if not external_path.exists():
        raise FileNotFoundError(
            f"External benchmark is absent: {external_path}. Do not evaluate on development rows."
        )
    external = load_corpus(external_path)
    errors = validate_corpus(external, min_studies=min_studies)
    overlap = set(development.study_id.astype(str)) & set(external.study_id.astype(str))
    if overlap:
        errors.append(f"external benchmark overlaps development studies: {sorted(overlap)}")
    if errors:
        raise ValueError("External benchmark cannot be locked:\n- " + "\n- ".join(errors))
    return {
        "path": str(external_path.relative_to(ROOT)).replace("\\", "/"),
        "sha256": sha256(external_path),
        "rows": len(external),
        "studies": external.study_id.nunique(),
    }
