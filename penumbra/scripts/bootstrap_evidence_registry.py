#!/usr/bin/env python3
"""Create a curator-facing sequence-evidence registry from the assay corpus.

The generated registry deliberately leaves accession/window values blank when a
paper has not published them. Blank is evidence of missingness, not a license
to fabricate sequence similarity.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / "corpus" / "bioassays.csv"
OUTPUT = ROOT / "corpus" / "sequence_evidence.csv"


def main() -> int:
    corpus = pd.read_csv(INPUT)
    rows = pd.DataFrame(
        {
            "row_index": corpus.index,
            "evidence_id": [f"{study}:{index:03d}" for index, study in enumerate(corpus.study_id)],
            "study_id": corpus.study_id,
            "construct_accession": "",
            "construct_sequence": "",
            "nontarget_transcript_accession": "",
            "matched_window_sequence": "",
            "match_source": corpus.match_source,
            "max_match_lower": corpus.max_contiguous_match_nt,
            "max_match_upper": corpus.max_contiguous_match_nt,
            "extraction_citation": corpus.doi,
            "notes": corpus.notes.fillna(""),
        }
    )
    # Inferred values are bounds, not falsely precise point measurements.
    inferred = rows.match_source.eq("inferred")
    rows.loc[inferred, "max_match_lower"] = 0
    rows.to_csv(OUTPUT, index=False)
    print(OUTPUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
