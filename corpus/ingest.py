#!/usr/bin/env python3
"""Validate corpus/bioassays.csv against Phase A acceptance gates."""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent
CSV_PATH = ROOT / "bioassays.csv"

REQUIRED = [
    "study_id",
    "doi",
    "target_pest",
    "nontarget_species",
    "nontarget_order",
    "construct_len_nt",
    "max_contiguous_match_nt",
    "n_21mers_perfect",
    "matched_gene",
    "matched_gene_essential",
    "dose_ng_per_uL",
    "exposure_route",
    "duration_days",
    "endpoint",
    "effect_size",
    "control_effect_size",
    "significant",
    "match_source",
    "normalization_rule",
    "notes",
]

MIN_ROWS = 60
MIN_STUDIES = 15
MIN_ORDERS = 5


def main() -> int:
    if not CSV_PATH.exists():
        print(f"FAIL: missing {CSV_PATH}", file=sys.stderr)
        return 1

    df = pd.read_csv(CSV_PATH)
    missing_cols = [c for c in REQUIRED if c not in df.columns]
    if missing_cols:
        print(f"FAIL: missing columns: {missing_cols}", file=sys.stderr)
        return 1

    n_rows = len(df)
    n_studies = df["study_id"].nunique()
    n_orders = df["nontarget_order"].nunique()
    n_sig = int((df["significant"].astype(str).str.lower() == "true").sum())
    n_nonsig = n_rows - n_sig

    print(f"rows:           {n_rows}  (need >={MIN_ROWS})")
    print(f"studies:        {n_studies}  (need >={MIN_STUDIES})")
    print(f"orders:         {n_orders}  (need >={MIN_ORDERS})")
    print(f"significant:    {n_sig}")
    print(f"non-significant:{n_nonsig}")
    print("orders list:", ", ".join(sorted(df["nontarget_order"].astype(str).unique())))
    print("match_source:", df["match_source"].value_counts().to_dict())

    # Both calibration error regions should be non-empty in raw data.
    below_21_effect = df[
        (df["max_contiguous_match_nt"] < 21)
        & (df["significant"].astype(str).str.lower() == "true")
    ]
    above_21_none = df[
        (df["max_contiguous_match_nt"] >= 21)
        & (df["significant"].astype(str).str.lower() == "false")
    ]
    print(f"error region A (effect & <21nt): {len(below_21_effect)}")
    print(f"error region B (no effect & >=21nt): {len(above_21_none)}")

    ok = (
        n_rows >= MIN_ROWS
        and n_studies >= MIN_STUDIES
        and n_orders >= MIN_ORDERS
        and len(below_21_effect) > 0
        and len(above_21_none) > 0
    )
    if not ok:
        print("FAIL: acceptance gates not met", file=sys.stderr)
        return 1

    print("PASS: corpus acceptance gates met")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
