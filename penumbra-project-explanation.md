# Project: PENUMBRA

The zone between "clearly safe" and "clearly harmful" — where every RNAi construct is currently designed against an unvalidated specificity threshold.

**One sentence:** Every sprayable-RNAi product is designed against an unvalidated specificity threshold — 21nt contiguous match, chosen because that's what people use. We build the calibrated empirical model of cross-species RNAi risk, using both raw sequence homology and learned sequence representations, and show that the heuristic is wrong in both directions.

**The claim:** Risk = hazard × exposure. Hazard is fitted from the published non-target bioassay corpus, using engineered match-profile features *and* frozen embeddings from a pretrained RNA language model, so the model can catch cases where sequences look different by exact-match counting but behave similarly in the space the RNAi machinery actually cares about. Exposure is site-specific. Nobody has fit the hazard side this way.

**The demo:** two moments where our model disagrees with the standard screen — once permissively (you discarded a working design), once restrictively (you shipped one you shouldn't have).

## Architecture

| Module | Does | Model | Status | Owner |
|---|---|---|---|---|
| M0 Corpus | Curated table of published non-target dsRNA assays: match profile, dose, species, outcome | — (LLM-assisted first-pass extraction, human-reviewed) | The asset. Start before the hackathon. | Bio person |
| M1 Hazard | Fit match-profile + embedding-similarity → effect probability with uncertainty | Logistic regression (features include a frozen RNA-FM embedding-similarity term) | The thesis | ML person |
| M2 Exposure | GBIF occurrence + season + application route → per-species exposure weight | — | Supporting | Backend |
| M3 Design | Construct assembly, k-mer screen, efficacy scoring, embedding-based near-miss flagging | Bloom filter (exact/near-exact) + RNA-FM embedding pass (structural near-misses) | Commodity — reimplement fast, don't polish | Algorithms |
| M4 Surface | Calibration plot, disagreement view, risk report | — | Sells it | Frontend |

M3 is deliberately unambitious on the exact-match side. That space is crowded — dsRNAEngineer, dsRNAmax, dsRIP, si-Fi21, OfftargetFinder all live there. You're building the layer those tools call, not competing with them. The embedding pass is the one addition worth the time, because it's what lets M1 catch the cases those tools structurally can't see (below).

## Model & architecture specification

**Why a foundation model belongs here at all.** The entire thesis is that a fixed nucleotide-match threshold misses functionally relevant near-misses and over-penalizes functionally irrelevant matches. Raw k-mer/mismatch counting can only ever measure *edit distance*. A pretrained RNA language model gives you a second, independent signal — learned sequence similarity in a space shaped by real RNA structure and function — which is exactly the kind of feature that turns up disagreements with the 21nt heuristic instead of just re-deriving it.

**Backbone: RNA-FM, frozen, no fine-tuning.**
- RNA-FM is pretrained on ~23M non-coding RNA sequences and produces 640-dimensional per-nucleotide embeddings; it's already the standard embedding source in recent siRNA efficacy/off-target tools (OligoFormer, AttSiOff) that fuse it with thermodynamic features rather than relying on either alone.
- Use it purely as a frozen feature extractor: embed the construct's antisense strand and the matched region in each non-target transcript, then compute a similarity feature (cosine or L2 distance in embedding space) to feed into the M1 logistic regression alongside `max_contiguous_match_nt`, `n_21mers_perfect`, etc.
- Do **not** fine-tune it. With a corpus in the low hundreds of rows, fine-tuning a 100M+ parameter model will overfit before it learns anything, and a recent efficiency study found frozen genomic-LM embeddings combined with simple sequence features matched or exceeded fine-tuned performance on comparable-scale tasks, at roughly an order of magnitude lower compute and carbon cost. Frozen embeddings plus a regularized logistic head is the right complexity level for this corpus size, and it's consistent with the doc's own instinct to resist adding interactions to the hazard model.
- Compute cost: a forward pass on a 21–30nt sequence is sub-second on CPU. Embedding the full corpus (low hundreds of sequences) plus demo constructs and non-target regions is a one-time job measured in minutes, not hours — cache the results to disk exactly like the GBIF responses and Bloom filters, so nothing needs to hit the model live during the demo.

**Upgrade path if any GPU is available: RiNALMo.** Trained on a larger corpus (~36M RNA sequences) and shown in recent work (OligoGraph, building on it for siRNA efficacy prediction) to generalize better than RNA-FM specifically on inter-family / unseen-sequence transfer — which is the exact regime PENUMBRA lives in, since the whole point is scoring constructs against non-target species that weren't in the training data. If venue hardware allows, swap RiNALMo in for the embedding step; if not, RNA-FM on CPU is a safe default and the architecture doesn't change, only the checkpoint.

**Not recommended for this build: fine-tuned or large general genomic LMs (Nucleotide Transformer, DNABERT-2, HyenaDNA, Evo).** These are strong models, but they're pretrained on DNA, not RNA-specific structure/function, and the ones large enough to matter don't buy you anything over RNA-FM/RiNALMo at this task and cost more compute and setup time. DNABERT-2 (117M params, byte-pair tokenization, runs on consumer GPU) is worth keeping in your back pocket only if you end up needing to embed longer flanking genomic context around a non-target hit rather than just the matched window — treat that as a cut-list item, not a core dependency.

**Corpus-building accelerant.** The labor-intensive part of this project is normalizing heterogeneous bioassay reports into the corpus schema, not modeling. A cheap, low-latency LLM (a small/fast tier model via API, not a local foundation model) can do first-pass structured extraction from paper abstracts and methods sections — proposed rows, not accepted ones. Every LLM-extracted row still goes through the same human-reviewed `normalization_rule` provenance step as a manually entered one. This doesn't change the epistemics of the project, it just compresses the time-consuming part of building the asset that's actually yours.

## Demo script (3 minutes)

**(25s)** "Every RNAi product on earth is screened against a 21-nucleotide match threshold. Here's the paper that set it — and here's the authors saying, in print, that the acceptable degree of homology was unknown. The whole field is designed against a guess."

**(35s)** Calibration plot. Published non-target outcomes on one axis, match profile on the other, the 21nt line drawn through it. Point at the misses on both sides. "This is what the guess costs."

**(45s)** Beat 1 — the unlock. A construct fails the conventional screen. Your model shows the match sits where calibrated dose-response — informed by both raw homology and learned sequence similarity — says effect is negligible at field exposure, CI included. "Your current tool threw away a working design."

**(40s)** Beat 2 — the catch. A construct passes the standard screen cleanly on exact-match count, but the embedding similarity to a locally present pollinator's transcript is high despite low raw homology. Drop the pin on a real field. "And it missed one — not because the sequences look alike by letter count, but because they behave alike."

**(20s)** Export the dossier. "This is what you hand a regulator. Not a threshold — a number with a confidence interval and a citation."

**(15s)** Honesty slide.

## The honesty slide

Say it before anyone asks: no wet lab, in silico only, and the corpus is small — low hundreds of published studies, heterogeneous in design, wide error bars on v0. The embedding feature is frozen and unvalidated against wet-lab ground truth beyond what's already in the published assays it's trained to correlate with — it's an additional signal, not a solved problem. Then the counter: a calibrated model with quantified uncertainty is strictly more defensible than an uncalibrated threshold with none, and the corpus is an asset that compounds — public literature now, registrant-contributed proprietary assay data later. Also name the bottleneck you aren't solving: formulation and delivery are wet-lab problems, and the EU still has no approval pathway for RNAi sprays.

## Pitch deck (7 slides)

1. Sprayable RNAi is real and registered — ledprona, applied at under a tenth of typical chemical rates, days-scale environmental persistence
2. Its entire value proposition is a specificity claim
3. That claim rests on an unvalidated threshold — with the quote
4. Demo: the calibration plot and two disagreements
5. Risk = hazard × exposure. We fit hazard — using both exact homology and learned sequence similarity. Nobody has fit either well, let alone both.
6. Wedge → moat: layer under existing design tools; the corpus plus the embedding-augmented hazard fit is the defensible asset, not the orchestration
7. Generalization: microbial biopesticides, peptides, and botanicals all need non-target data packages — hundreds of companies, same evidence problem

## Risk register

| Risk | Mitigation |
|---|---|
| Corpus too thin to fit anything | Golden cases hardcoded; show the raw scatter even if the model is weak — the miscalibration is visible without a fit |
| No good disagreement exists | Build `compare/` by hour 10 so you find out early enough to pivot the beat |
| "Isn't this dsRNAEngineer?" | You're the layer it calls. Integration slide ready. Concede M3 immediately and cheerfully |
| "Your error bars are huge" | Yes — and that's still more than a threshold with no error bars at all |
| "Isn't the embedding feature just a black box you can't defend?" | It's frozen, off-the-shelf, and reported with an ablation showing what it adds over raw match count alone — not tuned to make the story work |
| Venue wifi dies | Offline-first from hour zero. GBIF cached, embedding checkpoint pre-downloaded and cached, all corpus/demo sequences pre-embedded |

**Cut order:** Bayesian posteriors → dossier styling → image ID front door → React (→ Streamlit) → live embedding calls for audience-submitted sequences (precomputed golden cases still work) → exposure module (demo Beat 1 only).

## Definition of done

- [ ] Corpus in-repo, ≥60 rows, provenance documented
- [ ] Calibration plot from real data with the 21nt line on it
- [ ] Both disagreement beats render reliably
- [ ] Every prediction ships with an interval
- [ ] Hazard model reports an ablation: performance with vs. without the embedding-similarity feature
- [ ] Exported dossier in regulator-facing language, citing the embedding model checkpoint used
- [ ] Honesty slide written and rehearsed
- [ ] Backup video + backup laptop
- [ ] Pitched 5× under time

---

## Feedback (carried forward, still applies)

The idea has one genuinely novel piece and a lot of well-trodden ground wrapped around it, and it's worth separating those cleanly before deciding how much startup weight to put on it.

The off-target screening machinery — k-mer/Bloom-filter matching against a non-target transcriptome library, thermodynamic asymmetry scoring, accessibility via ViennaRNA — is not new, and the ag-specific version is actively populated: dsRIP, si-Fi/si-Fi21, OfftargetFinder, and dsRNAEngineer (Trends in Biotechnology, Feb 2025) already do this. The embedding-augmented hazard model doesn't change that assessment of M3 — it changes M1, which is where the actual thesis lives. Adding RNA-FM/RiNALMo similarity as a hazard feature is a genuine, still-narrow improvement: it's the kind of feature that could plausibly surface disagreements the pure-homology tools can't, because it's measuring something (learned functional similarity) they don't measure at all. It is not, on its own, a moat — it's an off-the-shelf embedding model anyone in this space could bolt on in an afternoon once they see the demo. The moat is still the corpus and the calibration against real non-target bioassay data, not the presence of a foundation model in the pipeline.

The one piece that appears to be a real gap, independent of the modeling choice, is the site-specific ecological weighting via GBIF — nobody seems to have built a tool that dynamically queries occurrence data and reweights a construct's risk per site. That's the wedge. The foundation-model embedding is a genuine improvement to hazard estimation, not a second wedge — don't let the pitch imply otherwise, or a technically literate judge will (correctly) note that embedding models are commodity infrastructure in 2026.

The bigger structural problem for "startup," as opposed to "demo," is unchanged: the field's actual bottleneck is delivery and regulatory pathway, not design turnaround time or hazard-estimate precision. A tool that compresses design and risk-screening time is valuable to the small set of companies that already have RNAi products in the pipeline, but they likely have in-house bioinformatics capability for a version of this already. This reads more like a feature that gets you acquired or licensed by an existing RNAi biologicals company than an independent venture with its own market — the embedding upgrade doesn't change that calculus, it just makes the feature better.
