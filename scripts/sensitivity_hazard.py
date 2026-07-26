#!/usr/bin/env python3
"""Fit predeclared sensitivity analyses without changing the primary model."""

from __future__ import annotations

import argparse
from pathlib import Path

from corpus.evidence import load_corpus
from hazard.fit import fit_hazard

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--draws", type=int, default=500)
    parser.add_argument("--tune", type=int, default=500)
    parser.add_argument("--chains", type=int, default=2)
    parser.add_argument("--output", type=Path, default=ROOT / "data" / "runs" / "sensitivities")
    args = parser.parse_args()
    corpus = load_corpus()
    variants = {
        "primary": corpus,
        "sequence_confirmed": corpus[corpus.match_source.astype(str).eq("recomputed")],
        "organismal_only": corpus[~corpus.normalization_rule.astype(str).str.contains("NR18", na=False)],
        "without_target_controls": corpus[
            corpus.nontarget_species.astype(str).str.lower() != corpus.target_pest.astype(str).str.lower()
        ],
    }
    for name, frame in variants.items():
        if frame.study_id.nunique() < 3 or frame.significant.astype(str).str.lower().nunique() < 2:
            print(f"SKIP {name}: insufficient outcome/study support")
            continue
        artifact = fit_hazard(frame, draws=args.draws, tune=args.tune, chains=args.chains)
        artifact.metadata["sensitivity"] = name
        artifact.save(args.output / name)
        print(f"WROTE {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
