#!/usr/bin/env python3
"""Profile a construct against a transcriptome and cache RNA-FM similarities."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from Bio import SeqIO

from corpus.contracts import as_jsonable
from design.kmer import TranscriptomeIndex
from embed.cache import cached_similarity


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("construct_fasta", type=Path)
    parser.add_argument("transcriptome_fasta", type=Path)
    parser.add_argument("--species", required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    records = list(SeqIO.parse(str(args.construct_fasta), "fasta"))
    if len(records) != 1:
        raise ValueError("construct FASTA must contain exactly one record")
    construct = str(records[0].seq)
    profile = TranscriptomeIndex.from_fasta(args.transcriptome_fasta).profile(construct, args.species)
    if profile.matched_windows:
        profile = profile.__class__(**{**profile.__dict__, "embedding_similarity": cached_similarity(construct, profile.matched_windows[0])})
    output = args.output or Path("profile.json")
    output.write_text(json.dumps(as_jsonable(profile), indent=2) + "\n", encoding="utf-8")
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
