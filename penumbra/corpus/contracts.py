"""Shared, explicit contracts for the Penumbra evidence pipeline."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any


class MatchSource(str, Enum):
    RECOMPUTED = "recomputed"
    REPORTED = "reported"
    INFERRED = "inferred"


@dataclass(frozen=True)
class Construct:
    id: str
    sequence: str
    target_species: str
    target_gene: str | None = None


@dataclass(frozen=True)
class MatchProfile:
    nontarget_species: str
    max_contiguous_match_nt: int
    n_21mers_perfect: int
    n_21mers_1mm: int
    n_21mers_2mm: int
    matched_windows: tuple[str, ...] = ()
    matched_transcript_ids: tuple[str, ...] = ()
    embedding_similarity: float | None = None
    match_source: MatchSource = MatchSource.RECOMPUTED
    sequence_evidence_level: str = "verified"
    transcriptome_version: str | None = None


@dataclass(frozen=True)
class HazardEstimate:
    p_effect: float
    ci_low: float
    ci_high: float
    n_support: int
    extrapolating: bool
    sequence_evidence_level: str
    model_version: str
    endpoint: str
    exposure_route: str
    uncertainty_notes: tuple[str, ...] = ()


@dataclass(frozen=True)
class EvidenceRecord:
    """Supplemental provenance for a corpus row, keyed by a stable row ID."""

    evidence_id: str
    study_id: str
    construct_accession: str | None
    construct_sequence: str | None
    nontarget_transcript_accession: str | None
    matched_window_sequence: str | None
    match_source: MatchSource
    max_match_lower: int | None = None
    max_match_upper: int | None = None
    extraction_citation: str | None = None
    notes: str | None = None


def as_jsonable(value: Any) -> Any:
    if hasattr(value, "__dataclass_fields__"):
        return {key: as_jsonable(item) for key, item in asdict(value).items()}
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, tuple):
        return [as_jsonable(item) for item in value]
    if isinstance(value, dict):
        return {key: as_jsonable(item) for key, item in value.items()}
    return value
