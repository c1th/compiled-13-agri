#!/usr/bin/env python3
"""Phase A acceptance checklist (Steps 0-2)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from Bio import SeqIO

ROOT = Path(__file__).resolve().parents[1]


def ok(msg: str) -> None:
    print(f"PASS  {msg}")


def fail(msg: str) -> None:
    print(f"FAIL  {msg}", file=sys.stderr)


def main() -> int:
    errors = 0

    # Step 0 — runtime + frozen RNA-FM checkpoint
    try:
        import pandas  # noqa: F401
        import pybloom_live  # noqa: F401
        import torch  # noqa: F401
        import fm  # noqa: F401

        ok("core Python and RNA-FM deps importable")
    except Exception as exc:  # noqa: BLE001
        fail(f"deps: {exc}")
        errors += 1

    manifest_path = ROOT / "data" / "MANIFEST.json"
    if not manifest_path.exists():
        fail("missing data/MANIFEST.json")
        errors += 1
    else:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        expected = manifest.get("species_expected", [])
        present = manifest.get("species", {})
        missing = [s for s in expected if s not in present]
        if missing:
            fail(f"transcriptomes missing: {missing}")
            errors += 1
        else:
            ok(f"all {len(expected)} transcriptomes in MANIFEST")
            for stem, info in present.items():
                path = ROOT / info["path"]
                if not path.exists():
                    fail(f"missing file {path}")
                    errors += 1

        model = manifest.get("models", {}).get("rna_fm")
        if not model:
            fail("RNA-FM checkpoint missing from MANIFEST")
            errors += 1
        else:
            checkpoint = ROOT / model["path"]
            if not checkpoint.exists():
                fail(f"missing RNA-FM checkpoint {checkpoint}")
                errors += 1
            else:
                try:
                    from embed.rnafm import embed

                    vector = embed("AUGGCUACGAUCGGAUACGUA")
                    if vector.shape != (640,):
                        raise ValueError(f"expected (640,), got {vector.shape}")
                    ok("RNA-FM loads offline and emits a 640-d embedding")
                except Exception as exc:  # noqa: BLE001
                    fail(f"RNA-FM embedding smoke test: {exc}")
                    errors += 1

    # Step 1 — corpus gates via ingest
    import subprocess

    r = subprocess.run(
        [sys.executable, str(ROOT / "corpus" / "ingest.py")],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    print(r.stdout, end="")
    if r.returncode != 0:
        print(r.stderr, end="", file=sys.stderr)
        fail("corpus ingest")
        errors += 1
    else:
        ok("corpus ingest gates")

    prov = ROOT / "corpus" / "provenance.md"
    if prov.exists() and prov.stat().st_size > 500:
        ok("provenance.md present")
    else:
        fail("provenance.md missing/thin")
        errors += 1

    # Step 2 — golden cases
    for case in ("ledprona_psmb5", "dvsnf7_240"):
        fasta = ROOT / "demo" / "golden_cases" / case / "construct.fasta"
        meta = ROOT / "demo" / "golden_cases" / case / "meta.json"
        if not fasta.exists() or not meta.exists():
            fail(f"golden case incomplete: {case}")
            errors += 1
            continue
        recs = list(SeqIO.parse(str(fasta), "fasta"))
        if len(recs) != 1 or len(recs[0].seq) < 100:
            fail(f"golden FASTA invalid: {case}")
            errors += 1
        else:
            ok(f"golden {case}: {len(recs[0].seq)} nt")
        json.loads(meta.read_text(encoding="utf-8"))

    if errors:
        print(f"\n{errors} check(s) failed")
        return 1
    print("\nPHASE A ACCEPTANCE: ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
