# PENUMBRA

Calibrated empirical model of cross-species RNAi non-target risk.
Risk = hazard × exposure — we fit the hazard side from published bioassays.

## Offline rebuild

```bash
uv sync
python scripts/fetch_data.py
python scripts/check_phase_a.py
```

Transcriptomes land in `data/transcriptomes/` and the pinned official RNA-FM
checkpoint lands in `data/models/rna-fm/` (both gitignored). After fetch, the
stack runs offline. The checkpoint source revision and SHA-256 are written to
`data/MANIFEST.json`.

## Phase A assets

| Path | What |
|------|------|
| `corpus/bioassays.csv` | Curated non-target assay rows |
| `corpus/provenance.md` | Normalization rules |
| `corpus/ingest.py` | Acceptance gates (≥60 rows / ≥15 studies / ≥5 orders) |
| `demo/golden_cases/` | Ledprona PSMB5 + DvSnf7_240 constructs |
| `data/MANIFEST.json` | Transcriptome checksums |

Optional ViennaRNA (M3 efficacy later): `uv sync --extra rna` (may lack a Windows wheel).

## Research workflow

PENUMBRA's working method is intentionally offline and evidence-first:

```bash
# Create the curator-facing sequence-evidence registry once per corpus revision.
python scripts/bootstrap_evidence_registry.py

# After curators recover public construct/window sequences, attach cached RNA-FM features.
python scripts/enrich_corpus_features.py

# Fit the hierarchical Bayesian hazard model and persist posterior samples + provenance.
python scripts/fit_hazard.py --corpus data/derived/bioassays_features.csv

# Evaluate internally by leaving one entire study out at a time.
python scripts/evaluate_hazard.py --model data/runs/<run-id>
```

The external benchmark lives in `corpus/external_bioassays.csv` and is
deliberately empty until it contains at least five study-disjoint, curated
studies. Evaluation refuses to substitute development data for that test.

`scripts/profile_construct.py` computes verified strand-aware k-mer features
and cached RNA-FM similarity for a construct/transcriptome pair. Every model
prediction reports a posterior interval and its sequence-evidence level.
