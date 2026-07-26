#!/usr/bin/env python3
"""Run grouped development validation or locked external evaluation."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from corpus.evidence import DEVELOPMENT_PATH, load_corpus
from hazard.evaluate import evaluate_locked_external, leave_one_study_out
from hazard.fit import ModelArtifact


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--external", type=Path)
    parser.add_argument("--draws", type=int, default=250)
    parser.add_argument("--tune", type=int, default=250)
    args = parser.parse_args()
    development = load_corpus(DEVELOPMENT_PATH)
    artifact = ModelArtifact.load(args.model)
    if args.external:
        predictions, report = evaluate_locked_external(artifact, development, str(args.external))
    else:
        predictions, report = leave_one_study_out(development, draws=args.draws, tune=args.tune)
    output = args.model / ("external_predictions.csv" if args.external else "loso_predictions.csv")
    predictions.to_csv(output, index=False)
    print(json.dumps(report, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
