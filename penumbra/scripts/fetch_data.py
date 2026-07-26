#!/usr/bin/env python3
"""Download CDS/transcript FASTA for Penumbra offline use.

Usage:
    uv run python scripts/fetch_data.py

Files land under data/transcriptomes/ (gitignored). A MANIFEST.json
with SHA-256 checksums is written to data/MANIFEST.json.
"""

from __future__ import annotations

import hashlib
import json
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from huggingface_hub import hf_hub_download

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data" / "transcriptomes"
MANIFEST_PATH = ROOT / "data" / "MANIFEST.json"
MODEL_DIR = ROOT / "data" / "models" / "rna-fm"
RNAFM_REPO_ID = "cuhkaih/rnafm"
RNAFM_REVISION = "91d4a46d28d8054a7b429955e8fc0c253ba0afd6"
RNAFM_FILENAME = "RNA-FM_pretrained.pth"

# NCBI Taxonomy IDs → local stem. We pull RefSeq CDS when available,
# falling back to a modest RNA/mRNA subset for sparse assemblies.
SPECIES: dict[str, dict[str, str | int]] = {
    "apis_mellifera": {
        "taxid": 7460,
        "label": "Apis mellifera",
        "role": "nontarget",
    },
    "coccinella_septempunctata": {
        "taxid": 41155,
        "label": "Coccinella septempunctata",
        "role": "nontarget",
    },
    "chrysoperla_carnea": {
        # NCBI:txid189513 is the annotated lacewing genome species;
        # older taxon 7508 has essentially no nuccore mRNA.
        "taxid": 189513,
        "label": "Chrysoperla carnea",
        "role": "nontarget",
    },
    "danaus_plexippus": {
        "taxid": 13037,
        "label": "Danaus plexippus",
        "role": "nontarget",
    },
    "eisenia_fetida": {
        "taxid": 6397,
        "label": "Eisenia fetida",
        "role": "nontarget",
    },
    "daphnia_magna": {
        "taxid": 35525,
        "label": "Daphnia magna",
        "role": "nontarget",
    },
    "homo_sapiens": {
        "taxid": 9606,
        "label": "Homo sapiens",
        "role": "nontarget",
        # Full human CDS is huge; keep a compact chromosome-subset for demo.
        "mode": "human_demo",
    },
    "leptinotarsa_decemlineata": {
        "taxid": 7539,
        "label": "Leptinotarsa decemlineata",
        "role": "target",
    },
    "diabrotica_virgifera": {
        "taxid": 50390,
        "label": "Diabrotica virgifera",
        "role": "target",
        "mode": "small_mrna",
    },
    "spodoptera_frugiperda": {
        "taxid": 7108,
        "label": "Spodoptera frugiperda",
        "role": "target",
    },
}

USER_AGENT = "penumbra-fetch/0.1 (hackathon offline rebuild; biopython-compatible)"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def http_get(url: str, retries: int = 5) -> bytes:
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            req = Request(url, headers={"User-Agent": USER_AGENT})
            with urlopen(req, timeout=300) as resp:
                chunks: list[bytes] = []
                while True:
                    block = resp.read(1 << 20)
                    if not block:
                        break
                    chunks.append(block)
                return b"".join(chunks)
        except (HTTPError, URLError, TimeoutError, OSError) as exc:
            last_err = exc
            time.sleep(2 ** attempt)
    raise RuntimeError(f"Failed to GET {url}: {last_err}")


def fasta_record_count(text: str) -> int:
    return sum(1 for line in text.splitlines() if line.startswith(">"))


def fetch_nuccore_cds(taxid: int, retmax: int = 8_000, chunk_size: int = 500) -> str:
    """Pull RefSeq CDS nuccore records for a taxonomy ID via E-utilities."""
    search_url = (
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
        f"?db=nuccore&term=txid{taxid}[Organism:exp]+AND+biomol_mrna[PROP]"
        f"+AND+srcdb_refseq[PROP]&retmax={retmax}&retmode=json&usehistory=y"
    )
    search = json.loads(http_get(search_url).decode("utf-8"))
    result = search.get("esearchresult", {})
    count = int(result.get("count", 0))
    webenv = result.get("webenv")
    query_key = result.get("querykey")

    if count == 0 or not webenv or not query_key:
        # Broader fallback: any mRNA for the taxon (may include non-RefSeq).
        search_url = (
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
            f"?db=nuccore&term=txid{taxid}[Organism:exp]+AND+biomol_mrna[PROP]"
            f"&retmax={min(retmax, 50_000)}&retmode=json&usehistory=y"
        )
        search = json.loads(http_get(search_url).decode("utf-8"))
        result = search.get("esearchresult", {})
        count = int(result.get("count", 0))
        webenv = result.get("webenv")
        query_key = result.get("querykey")

    if count == 0 or not webenv or not query_key:
        raise RuntimeError(f"No nuccore mRNA hits for taxid={taxid}")

    # Cap + chunk downloads to avoid IncompleteRead on large taxa.
    fetch_count = min(count, retmax)
    parts: list[str] = []
    for start in range(0, fetch_count, chunk_size):
        n = min(chunk_size, fetch_count - start)
        fetch_url = (
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
            f"?db=nuccore&query_key={query_key}&WebEnv={webenv}"
            f"&rettype=fasta&retmode=text&retstart={start}&retmax={n}"
        )
        time.sleep(0.35)
        chunk = http_get(fetch_url).decode("utf-8", errors="replace")
        if not chunk.lstrip().startswith(">"):
            raise RuntimeError(
                f"Unexpected FASTA payload for taxid={taxid} at retstart={start}"
            )
        parts.append(chunk.rstrip() + "\n")
    return "".join(parts)


def fetch_by_accessions(accessions: list[str]) -> str:
    ids = ",".join(accessions)
    url = (
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
        f"?db=nuccore&id={ids}&rettype=fasta&retmode=text"
    )
    time.sleep(0.4)
    return http_get(url).decode("utf-8", errors="replace")


def fetch_diabrotica_panel() -> str:
    """Compact WCR panel: Snf7 + vATPase orthologs used in the corpus literature."""
    # Public Diabrotica / closely related accessions commonly cited for RNAi targets.
    accessions = [
        "GU480924.1",  # Diabrotica virgifera Snf7 (DvSnf7) region used in MON87411 literature
        "EF541168.1",  # WCR vacuolar ATPase
        "NM_001395686.1",  # if present; ignored if fetch fails per-id below
    ]
    parts: list[str] = []
    # Also pull a capped mRNA set with tiny chunks.
    try:
        parts.append(fetch_nuccore_cds(50390, retmax=400, chunk_size=50))
    except Exception as exc:  # noqa: BLE001
        print(f"  (capped mRNA pull failed: {exc}; using accession panel)", flush=True)
    for acc in accessions:
        try:
            fasta = fetch_by_accessions([acc])
            if fasta.lstrip().startswith(">"):
                parts.append(fasta.rstrip() + "\n")
        except Exception as exc:  # noqa: BLE001
            print(f"  (skip {acc}: {exc})", flush=True)
    if not parts:
        raise RuntimeError("Diabrotica panel fetch produced no FASTA")
    return "".join(parts)


def fetch_human_demo() -> str:
    """Compact human panel: TP53 + a few housekeeping CDS accessions."""
    accessions = [
        "NM_000546.6",  # TP53
        "NM_001101.5",  # ACTB
        "NM_002046.7",  # GAPDH
        "NM_004119.3",  # PSMB5 (human proteasome beta-5)
        "NM_001256799.3",  # VCP / SNX7-adjacent trafficking (control)
    ]
    ids = ",".join(accessions)
    url = (
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
        f"?db=nuccore&id={ids}&rettype=fasta&retmode=text"
    )
    time.sleep(0.4)
    return http_get(url).decode("utf-8", errors="replace")


def write_fasta(stem: str, fasta: str) -> dict:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"{stem}.cds.fasta"
    path.write_text(fasta, encoding="utf-8", newline="\n")
    return {
        "path": str(path.relative_to(ROOT)).replace("\\", "/"),
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
        "n_records": fasta_record_count(fasta),
    }


def fetch_rnafm_checkpoint() -> dict:
    """Download the pinned official RNA-FM checkpoint into the offline cache."""
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    checkpoint = Path(
        hf_hub_download(
            repo_id=RNAFM_REPO_ID,
            filename=RNAFM_FILENAME,
            revision=RNAFM_REVISION,
            local_dir=MODEL_DIR,
        )
    )
    if not checkpoint.exists():
        raise RuntimeError(f"RNA-FM checkpoint was not materialized at {checkpoint}")
    return {
        "repo_id": RNAFM_REPO_ID,
        "revision": RNAFM_REVISION,
        "filename": RNAFM_FILENAME,
        "path": str(checkpoint.relative_to(ROOT)).replace("\\", "/"),
        "bytes": checkpoint.stat().st_size,
        "sha256": sha256_file(checkpoint),
    }


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (ROOT / "data" / "kmers").mkdir(parents=True, exist_ok=True)
    (ROOT / "data" / "gbif_cache").mkdir(parents=True, exist_ok=True)

    entries: dict[str, dict] = {}
    failures: list[str] = []

    for stem, meta in SPECIES.items():
        label = meta["label"]
        print(f"[fetch] {label} ...", flush=True)
        try:
            cached_path = OUT_DIR / f"{stem}.cds.fasta"
            if cached_path.exists():
                fasta = cached_path.read_text(encoding="utf-8")
                print(f"  -> using cached {cached_path.relative_to(ROOT)}", flush=True)
            elif meta.get("mode") == "human_demo":
                fasta = fetch_human_demo()
            elif meta.get("mode") == "small_mrna":
                fasta = fetch_diabrotica_panel()
            else:
                fasta = fetch_nuccore_cds(int(meta["taxid"]))
            info = write_fasta(stem, fasta)
            info.update(
                {
                    "label": label,
                    "taxid": meta["taxid"],
                    "role": meta["role"],
                }
            )
            entries[stem] = info
            print(
                f"  -> {info['path']} ({info['n_records']} records, "
                f"{info['bytes']} bytes)",
                flush=True,
            )
        except Exception as exc:  # noqa: BLE001 — surface all fetch failures
            failures.append(f"{stem}: {exc}")
            print(f"  !! FAILED: {exc}", flush=True)

    print("[fetch] RNA-FM checkpoint ...", flush=True)
    try:
        model = fetch_rnafm_checkpoint()
        print(f"  -> {model['path']} ({model['bytes']} bytes)", flush=True)
    except Exception as exc:  # noqa: BLE001 — preserve a diagnosable partial manifest
        model = None
        failures.append(f"rnafm: {exc}")
        print(f"  !! FAILED: {exc}", flush=True)

    manifest = {
        "generated_by": "scripts/fetch_data.py",
        "species_expected": list(SPECIES.keys()),
        "species": entries,
        "models": {"rna_fm": model} if model else {},
        "failures": failures,
    }
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    missing = [s for s in SPECIES if s not in entries]
    if missing or model is None:
        if missing:
            print("\nMISSING:", ", ".join(missing), file=sys.stderr)
        if model is None:
            print("\nMISSING: RNA-FM checkpoint", file=sys.stderr)
        print(f"Wrote partial manifest to {MANIFEST_PATH}", file=sys.stderr)
        return 1

    print(f"\nOK — all {len(entries)} transcriptomes present.")
    print(f"Manifest: {MANIFEST_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
