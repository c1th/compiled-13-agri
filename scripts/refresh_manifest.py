#!/usr/bin/env python3
"""Rebuild data/MANIFEST.json from files already on disk."""

from __future__ import annotations

import json
from pathlib import Path

from scripts.fetch_data import SPECIES, sha256_file, fasta_record_count, ROOT, MANIFEST_PATH, OUT_DIR


def main() -> None:
    entries = {}
    for stem, meta in SPECIES.items():
        path = OUT_DIR / f"{stem}.cds.fasta"
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        entries[stem] = {
            "path": str(path.relative_to(ROOT)).replace("\\", "/"),
            "bytes": path.stat().st_size,
            "sha256": sha256_file(path),
            "n_records": fasta_record_count(text),
            "label": meta["label"],
            "taxid": meta["taxid"],
            "role": meta["role"],
        }
    manifest = {
        "generated_by": "scripts/fetch_data.py",
        "species_expected": list(SPECIES.keys()),
        "species": entries,
        "failures": [s for s in SPECIES if s not in entries],
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {MANIFEST_PATH} with {len(entries)} species")
    if manifest["failures"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
