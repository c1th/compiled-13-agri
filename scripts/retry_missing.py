#!/usr/bin/env python3
"""Retry missing transcriptome downloads and refresh MANIFEST.json."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.fetch_data import (  # noqa: E402
    MANIFEST_PATH,
    SPECIES,
    fetch_diabrotica_panel,
    fetch_nuccore_cds,
    write_fasta,
)


def main() -> int:
    missing = [s for s in SPECIES if not (ROOT / "data" / "transcriptomes" / f"{s}.cds.fasta").exists()]
    if not missing:
        print("All transcriptomes already present.")
        return 0

    entries: dict = {}
    if MANIFEST_PATH.exists():
        entries = json.loads(MANIFEST_PATH.read_text(encoding="utf-8")).get("species", {})

    failures: list[str] = []
    for stem in missing:
        meta = SPECIES[stem]
        print(f"[fetch] {meta['label']} ...", flush=True)
        try:
            if meta.get("mode") == "small_mrna":
                fasta = fetch_diabrotica_panel()
            else:
                fasta = fetch_nuccore_cds(int(meta["taxid"]))
            info = write_fasta(stem, fasta)
            info.update(
                {
                    "label": meta["label"],
                    "taxid": meta["taxid"],
                    "role": meta["role"],
                }
            )
            entries[stem] = info
            print(f"  -> {info['path']} ({info['n_records']} records)", flush=True)
        except Exception as exc:  # noqa: BLE001
            failures.append(f"{stem}: {exc}")
            print(f"  !! FAILED: {exc}", flush=True)

    manifest = {
        "generated_by": "scripts/fetch_data.py",
        "species_expected": list(SPECIES.keys()),
        "species": entries,
        "failures": failures,
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    still = [s for s in SPECIES if s not in entries]
    if still:
        print("MISSING:", ", ".join(still))
        return 1
    print("OK — all transcriptomes present.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
