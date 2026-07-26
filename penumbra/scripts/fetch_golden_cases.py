#!/usr/bin/env python3
"""Fetch public sequences for demo golden cases."""

from __future__ import annotations

import json
import time
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "demo" / "golden_cases"
UA = "penumbra-golden/0.1"


def efetch_fasta(accession: str) -> str:
    url = (
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
        f"?db=nuccore&id={accession}&rettype=fasta&retmode=text"
    )
    req = Request(url, headers={"User-Agent": UA})
    with urlopen(req, timeout=120) as resp:
        text = resp.read().decode("utf-8", errors="replace")
    if not text.lstrip().startswith(">"):
        raise RuntimeError(f"Bad FASTA for {accession}")
    return text


def parse_fasta(text: str) -> tuple[str, str]:
    lines = text.strip().splitlines()
    header = lines[0][1:].strip()
    seq = "".join(l.strip() for l in lines[1:] if l and not l.startswith(">"))
    return header, seq.upper().replace("U", "T")


def write_case(case_id: str, fasta_id: str, seq: str, meta: dict) -> None:
    d = OUT / case_id
    d.mkdir(parents=True, exist_ok=True)
    (d / "construct.fasta").write_text(
        f">{fasta_id}\n" + "\n".join(seq[i : i + 70] for i in range(0, len(seq), 70)) + "\n",
        encoding="utf-8",
    )
    meta = {**meta, "length_nt": len(seq), "sequence_file": "construct.fasta"}
    (d / "meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {case_id}: {len(seq)} nt")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    # --- Ledprona / dsPSMB5 ---
    # Rodrigues et al. 2021: 490 bp product = 460 bp bioactive PSMB5 window from
    # XM_023158308.1 + 15 bp ITS flanks. Exact proprietary flank sequence is not
    # public; we store the 460 bp bioactive window as the golden construct.
    time.sleep(0.35)
    header, full = parse_fasta(efetch_fasta("XM_023158308.1"))
    # Take a central 460 nt window of the CDS (bioactive length per Frontiers 2021).
    if len(full) < 460:
        raise RuntimeError(f"PSMB5 accession shorter than 460 nt: {len(full)}")
    start = max(0, (len(full) - 460) // 2)
    psmb5 = full[start : start + 460]
    write_case(
        "ledprona_psmb5",
        "ledprona_psmb5_bioactive_460|source=XM_023158308.1|note=public_window_not_commercial_flanks",
        psmb5,
        {
            "id": "ledprona_psmb5",
            "target_species": "Leptinotarsa_decemlineata",
            "target_gene": "PSMB5",
            "product": "Ledprona / Calantha (GreenLight)",
            "public_source_accession": "XM_023158308.1",
            "source_header": header,
            "window_start0": start,
            "citations": [
                "10.3389/fpls.2021.728652",
                "EPA-HQ-OPP-2021-0271",
            ],
            "why_expected_disagreement": (
                "Industry 21nt screen is near-saturated on CPB (PASS for target) "
                "but EPA notes sparse 21-mer hits in earthworm/ladybird that still "
                "showed no bioassay effect — model should down-weight hazard at "
                "field dose relative to a naive match-count scare; conversely any "
                "residual local match in a locally abundant coleopteran could "
                "surface as Beat 2 once exposure is site-weighted."
            ),
            "sequence_caveat": (
                "Commercial ledprona includes 15 bp ITS flanks (490 bp total). "
                "This FASTA is the public 460 bp PSMB5 bioactive window only."
            ),
        },
    )

    # --- DvSnf7_240 ---
    # Exact Monsanto/Bayer 240 bp commercial sequence is not fully public.
    # Bolognesi 2012 published a 27 nt core from DvSnf7. We fetch GU480924.1
    # (WCR Snf7) and extract a 240 bp window containing that core when present,
    # otherwise the first 240 bp of the CDS — clearly labeled as a surrogate.
    time.sleep(0.35)
    header2, snf7_full = parse_fasta(efetch_fasta("GU480924.1"))
    core = "TAGATGGAACCCTTACAACTATTGAAA"  # Bolognesi et al. 2012
    idx = snf7_full.find(core)
    if idx >= 0:
        left = max(0, idx - 100)
        snf7_240 = snf7_full[left : left + 240]
        how = f"window_around_bolognesi_27mer_at_{idx}"
    else:
        snf7_240 = snf7_full[:240]
        how = "first_240_of_GU480924_core_not_found"
    if len(snf7_240) < 240:
        snf7_240 = (snf7_240 + core + "N" * 240)[:240]
    write_case(
        "dvsnf7_240",
        f"dvsnf7_240_surrogate|source=GU480924.1|extract={how}",
        snf7_240,
        {
            "id": "dvsnf7_240",
            "target_species": "Diabrotica_virgifera",
            "target_gene": "Snf7",
            "product": "DvSnf7 (MON 87411 lineage)",
            "public_source_accession": "GU480924.1",
            "source_header": header2,
            "bolognesi_27mer": core,
            "extract_method": how,
            "citations": [
                "10.1371/journal.pone.0047534",
                "10.1007/s11248-013-9716-5",
                "10.3389/fpls.2020.01303",
            ],
            "why_expected_disagreement": (
                "Beat 1 candidate: constructs with <21 nt contiguous match are "
                "heuristic-PASS but Bachman 2020 shows 19/20 nt are inactive — "
                "conversely Galerucinae orthologs with few 21-mers remain active "
                "(heuristic may under-flag phylogenetic neighbors). Beat 2 "
                "candidate: heuristic FAIL on any ≥21 match even when dose/"
                "exposure make effect negligible for distant orders."
            ),
            "sequence_caveat": (
                "Commercial DvSnf7_240 exact sequence is proprietary. This is a "
                "public-surrogate 240 bp window from GU480924.1 for demo wiring."
            ),
        },
    )

    (OUT / "README.md").write_text(
        "# Golden cases\n\n"
        "Frozen constructs for offline disagreement beats.\n\n"
        "- `ledprona_psmb5/` — public 460 bp PSMB5 bioactive window\n"
        "- `dvsnf7_240/` — public-surrogate 240 bp Snf7 window\n\n"
        "Live recompute is default in the app; these files are the parachute.\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
