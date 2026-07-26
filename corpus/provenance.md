# Corpus provenance — Penumbra M0

Every normalization decision that maps heterogeneous published assays into
`corpus/bioassays.csv` is logged here. When a judge asks how a 7-day larval
mortality assay compares to a fecundity endpoint, point at the rule ID in the
row's `normalization_rule` column and the matching entry below.

## Unit of observation

One row = `(study × non-target species × dose × endpoint)`.

Multiple rows may share a `study_id`. This matters for Step 5 hazard fitting:
bootstrap **by study_id**, not by row.

## Match fields

| `match_source` | Meaning |
|---|---|
| `reported` | Exact contiguous-match length and/or 21-mer counts taken from the paper or EPA docket text/tables |
| `recomputed` | Construct sequence was public; we recomputed `max_contiguous_match_nt` ourselves (Step 4+) |
| `inferred` | Paper said "no significant homology" / NOEC without publishing the match length — coded conservatively (typically ≤15 nt, 0 perfect 21-mers) and flagged |

Uncertain match lengths are **never silently invented as precise values** without a `match_source` flag.

## Normalization rules

### NR1 — Adverse binary outcome
`significant = true` iff the authors reported a statistically significant adverse
effect on the stated endpoint (α = 0.05 as used in the source), or an LC50 was
estimated (coded as significant at the LC50 concentration with `effect_size≈0.5`).

Endpoint-specific mapping:
- **mortality** — treatment mortality significantly > control, or LC50 reported
- **development** — delayed stage progression / failed eclosion / emergence NS vs control → `significant=false`; significant delay or failure → `true`
- **fecundity** — significant reduction in offspring/reproduction → `true`

`effect_size` stores the treatment arm's adverse rate (e.g. mortality fraction).
`control_effect_size` stores the concurrent control rate when published; else 0.

### NR2 — Diet concentration units
Diet assays reported as **ng/mL** or **ng/g** diet are converted to
`dose_ng_per_uL = reported_ng_per_mL / 1000` (equating g≈mL for aqueous/agar diets).

### NR3 — Leaf-disk worst-case surface dose
When only a leaf-disk surface coating is described without a volumetric
concentration convertible under NR2, store a **worst-case proxy** of
`1.0 ng/µL` and note the rule. Do not treat this as a field EEC.

### NR4 — mg/mL surface sprays (monarch/Varroa paper)
Davis et al. 2021 used mg/mL leaf dips. These are orders of magnitude above
field EECs. We store a high-dose proxy (`2.1`–`5.0` ng/µL scale markers in the
CSV — see row notes) and rely on Abbott-corrected significance from the paper
rather than the absolute dose for the binary outcome.

### NR5 — NOEC / limit tests
When a paper reports a **no-observed-effect concentration** equal to the
maximum concentration tested, code `significant=false` at that dose.

### NR6 — Heterospecific ortholog constructs
Bachman et al. 2013 Tables 3–4 feed Snf7 ortholog dsRNAs from species X to a
model insect (WCR or CPB). We code `nontarget_species = X` (ortholog source)
and record the model-insect outcome, with notes clarifying the design. Match
counts are those reported vs the model target sequence.

### NR7 — Short dsRNA inactive despite local match
Bolognesi et al. 2012: dsRNA ≲ 60 bp is inactive orally in WCR even with a
contiguous local match. Rows retain the high local `max_contiguous_match_nt`
but `significant=false` — an important calibration miss for naive 21-nt heuristics
that ignore construct length.

### NR8 — Contiguous-match threshold probes
Bachman et al. 2020 Frontiers: single 19-nt and 20-nt matches inactive; single
21-nt match active at high dose. These rows deliberately populate both sides of
the industry 21-nt line.

### NR9 — Self-dsRNA with no oral response
Honey bee and monarch self-gene dsRNAs that produce **no** oral phenotype are
coded `significant=false` despite perfect self-match. Documents delivery /
physiological barriers, not sequence risk alone.

### NR10 — Acute aquatic 48 h
Daphnia acute assays (≤48 h) are retained as `duration_days=2` mortality rows.

### NR11 — EPA guideline limit tests (Ledprona a.i.)
EPA-HQ-OPP-2021-0271: for Ledprona technical, guideline NTO studies reported
endpoints **greater than the highest concentration tested**. Coded
`significant=false`. Formulated Calantha contact toxicity to some arthropods is
**not** mixed into these a.i. rows (different product identity) — see Haller
2025 field rows separately.

### NR12 — Field-relevant dose proxy
Where guideline limit ≫ field rate and no volumetric dose is published, store
`0.1 ng/µL` as a field-relevant proxy and state the rule in notes.

### NR13 — Target efficacy rows
Target-pest positive controls (CPB × ledprona, WCR × DvSnf7) are included so
the calibration plot has the high-match / high-effect quadrant populated.

### NR14 — Drosophila species screen
Whyard et al. 2009 genus-level specificity demo; match lengths taken from the
paper's description of shared 19–21 nt windows across species.

### NR15 — C. elegans soaking / feeding proxy
Classic worm RNAi rows use `exposure_route=diet` as a proxy for feeding/soaking
delivery. Phenotypic adversity (e.g. unc-22 twitching) → development endpoint
`significant=true`; GFP reporter silencing without organismal harm → `false`.

### NR16 — mg/L → ng/µL
`1 mg/L = 1 ng/µL`. Applied to Rodrigues et al. 2021 dsPSMB5 diet assays.

### NR17 — Bioinformatics-only / no exposure assay
Human transcriptome 21-mer hits noted in the EPA docket without a dietary
exposure bioassay are coded `significant=false`, `duration_days=0`,
`dose_ng_per_uL=0`, with this rule flagged so the hazard model can down-weight
or exclude them.

### NR18 — Molecular knockdown as adverse binary
Chen et al. 2021 (*RNA Biology*) and related off-target papers report
**transcript knockdown**, not always organismal mortality. When knockdown of a
named gene is reported as significant (typically ≫20% depletion with p<0.05),
we code `endpoint=development` and `significant=true`, with `effect_size` =
fractional knockdown. This populates calibration region A (effect at <21 nt
contiguous match) that oral mortality assays rarely reach. Rows carry this rule
explicitly so they can be stratified or dropped in sensitivity analyses.

### NR19 — Injection route
Chen et al. 2021 delivered dsRNA to *T. castaneum* larvae by methods that
include injection-capable laboratory RNAi. `exposure_route=injection` is
allowed in the CSV (in addition to diet/topical/spray) and must not be pooled
naively with dietary field-exposure rows without a route covariate.

## Primary sources (v0)

| study_id | Citation / docket | Role |
|---|---|---|
| bachman_2013 | Bachman et al. 2013, *Transgenic Research* | DvSnf7 spectrum + match table |
| bolognesi_2012 | Bolognesi et al. 2012, *PLoS ONE* | Mechanism / length / single-21-mer |
| bachman_2020 | Bachman et al. 2020, *Frontiers in Plant Science* | 19/20/21 nt activity probes |
| tan_2016 | Tan et al. 2016, *Environ. Toxicol. Chem.* | Honey bee × DvSnf7 |
| velez_2016 | Vélez et al. 2016, *Pest Manag. Sci.* | Honey bee × vATPase-A |
| pan_2017 | Pan et al. 2017, *Frontiers in Plant Science* | Monarch × vATPase-A |
| davis_2021 | Davis et al. 2021, *PLoS ONE* | Monarch × Varroa-active dsRNA |
| lim_2019_daphnia | Lim et al. 2019, *Entomological Research* | Daphnia × DvSnf7 |
| epa_ledprona_2023 | EPA-HQ-OPP-2021-0271 | Ledprona guideline NTO panel |
| rodrigues_2021 | Rodrigues et al. 2021, *Frontiers in Plant Science* | Ledprona / dsPSMB5 efficacy |
| haller_2025 | Haller et al. 2025, *Am. J. Potato Res.* | Field non-target arthropods |
| whyard_2009 | Whyard et al. 2009, *Insect Biochem. Mol. Biol.* | Drosophila specificity |
| baum_2007 | Baum et al. 2007, *Nature Biotech.* | WCR RNAi foundational |
| zhu_2011 | Zhu et al. 2011, *Pest Manag. Sci.* | CPB oral RNAi gene panel |
| chen_2021 | Chen et al. 2021, *RNA Biology* | Contiguous-match titration; region A |
| jafc_2023_ote | Zhang et al. 2023, *J. Agric. Food Chem.* | >15 nt contiguous OTE threshold |
| fire_1998 / timmons_2001 | Classic *C. elegans* RNAi | Taxonomic diversity / endpoint coding |

## Honesty limits (carry to the pitch slide)

- v0 is **low hundreds of rows at most**; this file ships the first ≥60.
- Study designs are heterogeneous; error bars on any fit will be wide.
- Several match lengths are `inferred` — recompute when sequences are public (Step 4).
- Formulation (Calantha) ≠ technical ledprona; do not collapse them.
- No wet-lab validation was performed for this corpus.
