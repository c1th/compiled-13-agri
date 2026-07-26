#!/usr/bin/env python3
"""Fit and persist a versioned PENUMBRA Bayesian hazard model."""

from __future__ import annotations

import argparse
from datetime import UTC, datetime
from pathlib import Path

from corpus.evidence import DEVELOPMENT_PATH, load_corpus, sha256
from hazard.fit import fit_hazard

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", type=Path, default=DEVELOPMENT_PATH)
    parser.add_argument("--draws", type=int, default=500)
    parser.add_argument("--tune", type=int, default=500)
    parser.add_argument("--chains", type=int, default=2)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    args.corpus = args.corpus.resolve()
    corpus = load_corpus(args.corpus)
    artifact = fit_hazard(corpus, draws=args.draws, tune=args.tune, chains=args.chains)
    artifact.metadata["development_corpus"] = {
        "path": str(args.corpus.relative_to(ROOT)).replace("\\", "/"), "sha256": sha256(args.corpus)
    }
    manifest = ROOT / "data" / "MANIFEST.json"
    if manifest.exists():
        artifact.metadata["input_manifest"] = {"path": "data/MANIFEST.json", "sha256": sha256(manifest)}
    output = args.output or ROOT / "data" / "runs" / datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    artifact.save(output)
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
