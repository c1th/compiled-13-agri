# PENUMBRA — Step-by-Step Build

Sequenced so that each step has a hard acceptance test. Don't advance until the test passes. Steps 0–2 happen before the hackathon.

## PHASE A — Pre-hackathon (this week)

### Step 0 — Environment, frozen

```bash
uv init penumbra && cd penumbra
uv add pandas numpy scikit-learn statsmodels biopython viennarna \
       pybloom-live requests fastapi uvicorn reportlab matplotlib \
       torch --index-strategy unsafe-best-match
uv add transformers   # for RNA-FM / RiNALMo checkpoint loading
```

Download and commit nothing large; write `scripts/fetch_data.py` that pulls transcriptomes *and* the RNA-FM checkpoint into `data/` (gitignored) so any teammate can rebuild in one command. Verify the exact checkpoint source (HuggingFace hub or the original `ml4bio/RNA-FM` repo) and pin the revision before the hackathon — don't discover a broken download link during H0.

**Accept:** fresh clone → `uv sync` → `python scripts/fetch_data.py` → all files present, model loads and produces an embedding for a test sequence offline, from then on.

### Step 1 — Build the corpus

The asset. Everything else is scaffolding.

Create `corpus/bioassays.csv`:

```
study_id, doi, target_pest, nontarget_species, nontarget_order,
construct_len_nt, max_contiguous_match_nt, n_21mers_perfect,
n_21mers_1mm, n_21mers_2mm, matched_gene, matched_gene_essential,
dose_ng_per_uL, exposure_route, duration_days,
endpoint, effect_size, control_effect_size, significant,
normalization_rule, notes
```

Sources, in order of value:
- EPA ledprona/Calantha registration docket (regulations.gov, EPA-HQ-OPP-2021-0271) — already structured for regulators
- EFSA opinions on dsRNA plant protection products
- Published non-target bioassays: *Apis mellifera, Coccinella septempunctata, Harmonia axyridis, Chrysoperla carnea, Daphnia magna, Eisenia fetida, Danaus plexippus, C. elegans*
- Review tables in the SIGS/RNAi-biopesticide reviews — they aggregate assays you'd otherwise hunt individually

**Extraction accelerant:** use a fast, low-cost LLM API call to produce first-pass structured rows from each paper's abstract/methods text, matched to the schema above. Treat every LLM-produced row as a draft — a human still fills `normalization_rule` and confirms `significant`/`effect_size` against the source before it enters the corpus. This speeds the mining, not the judgment call.

Two rules that keep this honest:
- One row per (study × non-target species × dose × endpoint). Multiple rows share a `study_id`. This matters in Step 6.
- Every normalization decision gets written into `normalization_rule` and `corpus/provenance.md`. When a judge asks how a 7-day larval mortality assay compares to a fecundity endpoint, you point at the rule.

Many papers report sequence identity loosely ("no significant homology"). Where the construct sequence is published, recompute `max_contiguous_match_nt` yourself in Step 4 and mark `notes = recomputed`. Where it isn't, mark the row `match_source = reported` and keep it — but flag it in the model.

**Accept:** ≥60 rows, ≥5 non-target orders, ≥15 distinct studies, provenance file complete.

### Step 2 — Golden cases, chosen by hand

Pick two real constructs where you expect disagreement. Ledprona (PSMB5, Colorado potato beetle) is the obvious anchor — public sequence, public non-target data, registered product. Second: a published rootworm vATPase-A or snf7 construct.

**Accept:** two named constructs with sequences on disk in `demo/golden_cases/`.

## PHASE B — Hours 0–10: the core

### Step 3 — Contracts first (H0–2)

Write the schemas before any logic, so everyone builds against stubs. Note the addition of `embedding_similarity` to `MatchProfile`:

```python
Construct  = {id, sequence, target_species, target_gene}
MatchProfile = {nontarget_species, max_contiguous, n_perfect,
                n_1mm, n_2mm, matched_genes, essential_hit,
                embedding_similarity: float}   # NEW — cosine sim, construct vs. matched region
HazardEstimate = {p_effect, ci_low, ci_high, n_support, extrapolating: bool}
RiskRow = {nontarget_species, hazard, exposure, risk, ci_low, ci_high}
```

`extrapolating` is not optional — it flags when a query sits outside the corpus's support, and it's the field that keeps you honest on stage.

**Accept:** all modules import the schema and return valid stub objects, including a placeholder `embedding_similarity`.

### Step 4 — k-mer engine (H2–6)

`design/kmer.py`:
- Encode each 21-mer as `uint64` (2 bits/base, 42 bits used)
- Store canonical form — `min(forward, revcomp)` — so matching is strand-agnostic, which is what RNAi requires
- Build one Bloom filter per non-target transcriptome, pickle to `data/kmers/`
- `profile(construct, species) -> MatchProfile` (embedding_similarity left as `None` here, filled in Step 5)

For mismatch tolerance, don't do alignment. Generate all 1-mismatch and 2-mismatch neighbours of each construct k-mer and query the filter.

State the failure mode in your own README: a Bloom filter can only produce false positives, so you over-report non-target hits, never under-report. Conservative in the correct direction. Say this on stage.

**Accept:** ledprona construct profiled against all 7 non-target sets in <2s; recovers the published specificity claim.

### Step 5 — Embedding engine (H4–8) ← new module, feeds the thesis

`embed/rnafm.py`:
- Load RNA-FM (frozen, `eval()` mode, no gradient) once at process start; cache the loaded model, don't reload per call
- `embed(sequence: str) -> np.ndarray` — returns the pooled per-sequence embedding (mean-pool over nucleotide-level outputs, or the model's provided pooled representation if available)
- Precompute and pickle embeddings for every corpus construct, every non-target matched region, and both golden cases to `data/embeddings/` — this is a one-time offline job, not a runtime dependency
- `similarity(construct_seq, nontarget_region_seq) -> float` — cosine similarity between the two pooled embeddings

`embed/similarity.py`: given a `MatchProfile` from Step 4 and the corresponding sequences, fill in `embedding_similarity`.

**Why this step exists:** raw k-mer/mismatch counting is edit-distance. The embedding similarity is a second, independent measure of how alike two sequences are in a space shaped by real RNA structure/function — this is specifically what lets you find cases where low homology still shows functional similarity (or vice versa), which is the whole disagreement-beat premise.

**Compute note:** on CPU, a single sequence embeds in well under a second. Embedding the full corpus plus demo sequences (low hundreds total) is a few minutes, once. Nothing in the live demo path should call the model — everything is precomputed and cached, same discipline as the GBIF cache.

**Accept:** embeddings for all corpus rows and both golden cases precomputed and cached; `similarity()` runs offline from the pickle, no network or live model call required; a smoke test confirms near-identical sequences score similarity ≥0.95 and unrelated sequences score meaningfully lower.

### Step 6 — Hazard model (H6–10) ← the thesis

`hazard/fit.py`. Binary outcome = `significant`.

Features:
- `max_contiguous_match_nt`
- `log1p(n_21mers_perfect)`
- `embedding_similarity` — **new**
- `matched_gene_essential`
- `log(dose_ng_per_uL)`
- `nontarget_order` (collapse to ≥3 levels; you don't have data for more)
- `exposure_route`

Model: logistic regression. With ~60–120 rows and now 7 features you are past the edge of what's comfortably fittable — regularize (L2, or Firth if separation appears), resist adding interactions, and specifically check `embedding_similarity` against `max_contiguous_match_nt` for collinearity before trusting both coefficients individually (they should be correlated but not redundant — if they're near-perfectly collinear, the embedding feature isn't adding anything and you should say so, not hide it).

The clustering issue, which you must get right: rows within a `study_id` are not independent.
- Bootstrap by study, not by row. Resample whole `study_id` groups. Row-level bootstrap will give you fake-narrow intervals and a bio-literate judge will catch it.
- Validate leave-one-study-out. Report LOSO AUC, not in-sample fit.

```python
def fit_hazard(df, n_boot=2000):
    studies = df.study_id.unique()
    coefs = []
    for _ in range(n_boot):
        draw = rng.choice(studies, size=len(studies), replace=True)
        boot = pd.concat([df[df.study_id == s] for s in draw])
        coefs.append(fit_once(boot))
    return np.percentile(coefs, [2.5, 50, 97.5], axis=0)
```

`hazard/uncertainty.py` sets `extrapolating=True` when a query's `max_contiguous_match`, `log(dose)`, or `embedding_similarity` falls outside the corpus range.

**Run the ablation now, not later:** fit the model with and without `embedding_similarity` and record LOSO AUC for both. This is the number that justifies the added complexity — if it doesn't move AUC, say so on the honesty slide rather than quietly keeping the feature because it makes the disagreement story better.

**Accept:** LOSO AUC reported honestly for both feature sets (0.65–0.80 is a real result at this n — do not tune until it looks better); every prediction ships with a study-clustered CI; ablation result written down.

### Step 7 — GATE 1: the calibration surface (H10)

`hazard/calibrate.py` renders the plot the whole pitch rests on.

Do not build a standard reliability diagram. With n≈100 you'd have ~5 points per bin and the plot would be noise. Build this instead:
- x-axis: `max_contiguous_match_nt`
- y-axis: observed outcome (jittered 0/1), point size ∝ dose, colour by `nontarget_order`
- Overlay: fitted P(effect) curve with bootstrap CI band (from the full model, embedding feature included)
- Vertical line at 21nt, labelled "current industry threshold"
- Shade the two error regions: assays with effect below 21nt, and assays with no effect above 21nt

That shading is your argument, and it's visible in the raw data even if the model fit is weak — which is exactly the fallback you want.

**Accept:** plot renders from real corpus rows; both error regions are non-empty. If either region is empty, stop and go find more corpus rows. No disagreement in the data means no project.

## PHASE C — Hours 10–18: the demo engine

### Step 8 — Heuristic baseline + disagreement finder (H10–14)

`compare/heuristic.py` — one function, deliberately dumb:

```python
def heuristic_verdict(profile, threshold=21):
    return "FAIL" if profile.max_contiguous >= threshold else "PASS"
```

`compare/disagreement.py` — sweep constructs × non-target species, classify into quadrants, rank by `|model − heuristic|`:
- Q1 (Beat 1, the unlock): heuristic FAIL, model P(effect) low at field-relevant dose
- Q2 (Beat 2, the catch): heuristic PASS, model P(effect) elevated

When you inspect your top-ranked cases, check which feature is driving each one. The strongest version of Beat 2 is a case where `max_contiguous_match_nt` is low (heuristic says PASS) but `embedding_similarity` is high (model flags risk anyway) — that's the disagreement that's hardest for a dsRNAEngineer-class tool to have caught, because it doesn't show up in exact-match counting at all. If your top disagreements are driven entirely by dose or essential-gene flags rather than the embedding feature, the demo still works, but say so honestly rather than implying the embedding was the reason.

**Accept:** ranked list produced; at least one credible case in each quadrant; you know which feature(s) drive each golden case.

### Step 9 — Freeze the golden cases (H14–16)

Take your best Q1 and Q2 case, serialize the full computed output (including the precomputed embeddings and similarity score) to `demo/golden_cases/*.json`, and add a UI flag that replays from disk.

Live recompute is the default; the frozen path is the parachute. You are not gambling the pitch on a live sweep, and you are especially not gambling it on a live model forward pass.

**Accept:** demo runs identically with the network off and the embedding model unloaded.

### Step 10 — Exposure (H14–18)

`exposure/gbif.py`:

```
GET api.gbif.org/v1/occurrence/search
    ?decimalLatitude=..&decimalLongitude=..&radius=..
    &month=..&taxonKey=..
```

Map returned species → nearest available transcriptome, record the taxonomic distance of that substitution and surface it.

The accuracy point you must state out loud: GBIF occurrence counts reflect sampling effort, not abundance. Birds and butterflies are massively over-recorded relative to soil fauna. So use occurrence as ordinal presence (absent / recorded / frequently recorded), never as a density estimate. Combine with `exposure_route` — a foliar spray gives high exposure to leaf-feeding non-targets, low to soil fauna.

```python
risk = hazard * exposure_weight   # both in [0,1]
```

Cache every response to `data/gbif_cache/`.

**Accept:** two pinned locations return different local species sets; substitution distances displayed; runs offline from cache.

### Step 11 — GATE 2 (H18)

Both beats render end-to-end through the UI. Everything after this is polish.

## PHASE D — Hours 18–36: surface and rehearsal

### Step 12 — UI (H18–26)

Four tabs, built in priority order — if you run out of time you ship the first two:
1. **Calibration** — the Step 7 plot, full-bleed
2. **Disagreement** — side-by-side heuristic verdict vs model estimate with CI, both golden cases one keypress apart; surface which features (match count vs. embedding similarity) drove each verdict
3. **Site** — map pin → local species → risk table
4. **Dossier** — export

Error bars render on every number. Do not hide the width; the width is the argument.

### Step 13 — Dossier (H26–31)

`report/dossier.py` → PDF containing: construct + match profile per non-target species (including embedding similarity), hazard estimate with CI and support count, ablation note (embedding feature's contribution to AUC), exposure basis with the GBIF caveat stated in the document, extrapolation flags, the corpus rows the estimate rests on, and the RNA-FM (or RiNALMo) checkpoint identifier used, for reproducibility.

Write it in EFSA/EPA problem-formulation language — hazard, exposure, risk characterization. Use the ledprona registration package as your format reference.

**Accept:** PDF a regulatory affairs person would recognize as the right shape.

### Step 14 — Backup + rehearsal (H31–36)

- Record `demo/backup_run.mp4` end-to-end
- Second laptop with the repo cloned, model checkpoint cached, and data synced
- Rehearse 5× timed, out loud, airplane mode
- Print the calibration plot as a handout

## Tools checklist

**Software**
- Python 3.11 + `uv`
- `pandas`, `numpy`, `scikit-learn`, `statsmodels` (logistic fit with CIs)
- `torch` (CPU build is sufficient) + `transformers` for RNA-FM / RiNALMo checkpoint loading
- `arviz` + `pymc` only if you want proper posterior intervals — otherwise bootstrap CIs, faster and sufficient
- `biopython`, `ViennaRNA`, `pybloom-live`
- `requests` (GBIF Occurrence API, free, no key)
- `fastapi` + `uvicorn`; React + Vite + Tailwind + Recharts, or Streamlit if short-handed
- `reportlab` for the risk dossier

**Skip:** BLAST, bowtie (k-mer/Bloom filter is faster and sufficient at this scale). Fine-tuning any embedding model — frozen inference only. GPU provisioning, unless one is trivially available for a RiNALMo swap-in; RNA-FM on CPU is fast enough that a GPU is a nice-to-have, not a requirement.

**Hardware / props**
- Laptop (CPU is fine; no vision model in this version, embedding model runs comfortably on CPU at this scale)
- Printed handouts: the calibration plot with the 21nt line drawn on it. This is your business card.
- Optional: laminated pest cards if you keep an image-ID front door — but it's decorative, not load-bearing

**Pre-downloads (hotel wifi, not venue wifi)**
- Non-target CDS/transcriptomes: *Apis mellifera, Coccinella septempunctata, Chrysoperla carnea, Danaus plexippus, Eisenia fetida, Daphnia magna, Homo sapiens*
- Target pest transcripts: *Leptinotarsa decemlineata, Diabrotica virgifera, Spodoptera frugiperda*
- RNA-FM checkpoint (or RiNALMo, if a GPU swap-in is planned) — pin the exact revision, verify it loads and embeds a test sequence before leaving for the venue
- Precompute all transcriptomes into pickled Bloom filters
- Precompute all corpus/demo/golden-case sequences into pickled embeddings
- Cache GBIF responses for 3–4 demo lat/lons
- The corpus CSV, versioned in-repo

## Repo layout

```
penumbra/
  corpus/      bioassays.csv  provenance.md  ingest.py
  hazard/      fit.py  calibrate.py  uncertainty.py
  embed/       rnafm.py  similarity.py          # NEW
  exposure/    gbif.py  routes.py  weight.py
  design/      kmer.py  chimera.py  efficacy.py
  compare/     heuristic.py  disagreement.py     # <- the demo engine
  report/      dossier.py  templates/
  api/         main.py
  ui/          src/  (Calibration | Design | Disagreement | Dossier)
  data/        kmers/  gbif_cache/  embeddings/  # NEW
  demo/        golden_cases/  backup_run.mp4
```

`compare/disagreement.py` exists solely to find and rank cases where your model and the 21nt heuristic diverge. Build it early — it tells you whether you have a demo at all.

## Hour-by-hour (36h)

- **H0–2** — Freeze scope. Write the two disagreement beats on paper first. Lock JSON contracts (including `embedding_similarity`). Everything that doesn't serve the calibration plot or the two beats is out.
- **H2–10** — Parallel.
  - M0: finish ingest, normalize endpoints, sanity-plot the raw data
  - M1/embed: logistic fit — `P(effect) ~ max_contiguous_match + n_perfect_matches + embedding_similarity + essential_gene + log(dose) + order`, with the embedding pipeline (Step 5) built first since the hazard fit depends on it. Bootstrap CIs. Run the with/without-embedding ablation.
  - M3: sliding-window construct assembly, thermodynamic asymmetry (weak 5′-antisense pairing), ViennaRNA accessibility
  - M2: GBIF query → local species → nearest available transcriptome
  - M4: dashboard shell, hardcoded numbers
- **H10** — GATE 1. The calibration plot renders from real corpus rows, with the 21nt heuristic drawn as a vertical line. If this doesn't exist by hour 10, you have no project — stop everything and make it exist.
- **H10–18** — Find the disagreements. Sweep constructs against the corpus-fitted model and the heuristic. Rank divergences by magnitude, noting which feature drives each. Hand-pick two golden cases and hardcode them into `demo/golden_cases/`. Do not gamble on finding a good disagreement live.
- **H18** — GATE 2. Both beats render end to end. Everything after this is polish.
- **H18–26** — Exposure + uncertainty. GBIF wired to the exposure term. Error bars visible on every prediction — a model with quantified uncertainty beating a heuristic with none is the argument, so don't hide the width.
- **H26–31** — The dossier. Export: construct, match profile per non-target species, hazard estimate with CI, ablation note, exposure basis, and the problem-formulation rationale in EFSA/EPA language. Cite the ledprona precedent (EPA-registered Dec 2023, IRAC Group 35) as the format you're writing toward.
- **H31–33** — Backup video, golden outputs, dry run.
- **H33–36** — Rehearse 5×, timed, offline.

## Definition of done

- [ ] Corpus ≥60 rows, ≥15 studies, provenance documented
- [ ] Calibration plot with both error regions populated
- [ ] LOSO AUC reported honestly, with and without the embedding feature; bootstrap clustered by study
- [ ] Embedding pipeline runs fully offline from precomputed cache during the demo
- [ ] Both disagreement beats reproducible offline, with driving features identified
- [ ] `extrapolating` flag surfaced in the UI
- [ ] GBIF sampling-effort caveat stated in UI and dossier
- [ ] Dossier exports, citing the embedding checkpoint used
- [ ] Honesty slide rehearsed
- [ ] Pitched 5× under time
