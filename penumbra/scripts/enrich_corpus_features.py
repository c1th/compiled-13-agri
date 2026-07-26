#!/usr/bin/env python3
"""Attach cached RNA-FM similarity only where sequence provenance supports it."""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

from embed.cache import cached_similarity

ROOT = Path(__file__).resolve().parents[1]


def nonempty(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", type=Path, default=ROOT / "corpus" / "bioassays.csv")
    parser.add_argument("--evidence", type=Path, default=ROOT / "corpus" / "sequence_evidence.csv")
    parser.add_argument("--output", type=Path, default=ROOT / "data" / "derived" / "bioassays_features.csv")
    args = parser.parse_args()
    corpus = pd.read_csv(args.corpus)
    evidence = pd.read_csv(args.evidence)
    required = {"row_index", "construct_sequence", "matched_window_sequence", "match_source"}
    missing = required - set(evidence.columns)
    if missing:
        raise ValueError(f"Evidence registry missing fields: {sorted(missing)}")
    if evidence.row_index.duplicated().any():
        raise ValueError("Evidence registry has duplicate row_index values")
    lookup = evidence.set_index("row_index")
    similarities: list[float | None] = []
    levels: list[str] = []
    for index, row in corpus.iterrows():
        if index not in lookup.index:
            similarities.append(None)
            levels.append("missing_registry")
            continue
        item = lookup.loc[index]
        if nonempty(item.construct_sequence) and nonempty(item.matched_window_sequence):
            similarities.append(cached_similarity(item.construct_sequence, item.matched_window_sequence))
            levels.append("verified" if item.match_source == "recomputed" else "sequence_recovered")
        else:
            similarities.append(None)
            levels.append(str(item.match_source))
    corpus["embedding_similarity"] = similarities
    corpus["sequence_evidence_level"] = levels
    args.output.parent.mkdir(parents=True, exist_ok=True)
    corpus.to_csv(args.output, index=False)
    print({"output": str(args.output), "embedded_rows": int(pd.Series(similarities).notna().sum())})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
