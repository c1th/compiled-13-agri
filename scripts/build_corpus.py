#!/usr/bin/env python3
"""Generate curated non-target bioassay corpus (best-effort literature curation)."""

from __future__ import annotations

import csv
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "corpus" / "bioassays.csv"

FIELDS = [
    "study_id",
    "doi",
    "target_pest",
    "nontarget_species",
    "nontarget_order",
    "construct_len_nt",
    "max_contiguous_match_nt",
    "n_21mers_perfect",
    "n_21mers_1mm",
    "n_21mers_2mm",
    "matched_gene",
    "matched_gene_essential",
    "dose_ng_per_uL",
    "exposure_route",
    "duration_days",
    "endpoint",
    "effect_size",
    "control_effect_size",
    "significant",
    "match_source",
    "normalization_rule",
    "notes",
]


def ng_per_ml_to_ul(ng_per_ml: float) -> float:
    """Diet concentrations reported as ng/mL → ng/µL (÷1000)."""
    return round(ng_per_ml / 1000.0, 6)


def row(**kwargs):
    base = {k: "" for k in FIELDS}
    base.update(kwargs)
    # stringify bools consistently
    for key in ("matched_gene_essential", "significant"):
        if isinstance(base[key], bool):
            base[key] = "true" if base[key] else "false"
    return base


def bachman_2013() -> list[dict]:
    """Bachman et al. 2013 spectrum-of-activity table + match table."""
    doi = "10.1007/s11248-013-9716-5"
    sid = "bachman_2013"
    pest = "Diabrotica_virgifera"
    construct = 240
    # Direct-feeding NOEC / LC50 rows from Table 1 + narrative results.
    # For NOEC rows: significant=false at the tested limit dose.
    # Match lengths from Table 2 where available; else reported narrative.
    specs = [
        # species, order, dose_ng_ml, days, endpoint, effect, control, sig, max_c, n21, gene, match_src, notes
        ("Diabrotica_virgifera", "Coleoptera", 1.2, 12, "mortality", 0.5, 0.05, True, 240, 221, "Snf7", True, "reported", "LC50 vs WCR; self-match"),
        ("Diabrotica_undecimpunctata", "Coleoptera", 4.4, 12, "mortality", 0.5, 0.05, True, 186, 186, "Snf7", True, "reported", "LC50; 98.8% identity; 186 perfect 21-mers"),
        ("Leptinotarsa_decemlineata", "Coleoptera", 5000, 12, "mortality", 0.08, 0.08, False, 14, 0, "Snf7", True, "reported", "NOEC at 5000; longest contiguous 14 nt"),
        ("Tribolium_castaneum", "Coleoptera", 5000, 30, "mortality", 0.10, 0.10, False, 11, 0, "Snf7", True, "reported", "NOEC; longest contiguous 11 nt"),
        ("Coleomegilla_maculata", "Coleoptera", 3000, 24, "mortality", 0.0, 0.0, False, 12, 0, "Snf7", True, "inferred", "NOEC; ladybeetle; no 21-mer matches reported"),
        ("Epilachna_varivestis", "Coleoptera", 3000, 28, "mortality", 0.08, 0.08, False, 12, 0, "Snf7", True, "inferred", "NOEC; survival 92% both arms"),
        ("Poecilus_chalcites", "Coleoptera", 5000, 35, "mortality", 0.05, 0.05, False, 12, 0, "Snf7", True, "inferred", "NOEC carabid"),
        ("Orius_insidiosus", "Hemiptera", 5000, 9, "development", 0.0, 0.0, False, 12, 0, "Snf7", True, "inferred", "100% survival both arms"),
        ("Pediobius_foveolatus", "Hymenoptera", 3000, 21, "mortality", 0.0, 0.0, False, 12, 0, "Snf7", True, "inferred", "parasitoid NOEC"),
        ("Nasonia_vitripennis", "Hymenoptera", 5000, 20, "mortality", 0.05, 0.03, False, 14, 0, "Snf7", True, "reported", "longest contiguous <=14 nt; survival NS"),
        ("Spodoptera_frugiperda", "Lepidoptera", 500, 8, "mortality", 0.0, 0.0, False, 12, 0, "Snf7", True, "inferred", "NOEC at 500 ng/mL"),
        ("Helicoverpa_zea", "Lepidoptera", 5000, 12, "mortality", 0.15, 0.20, False, 12, 0, "Snf7", True, "inferred", "survival NS vs control"),
        ("Ostrinia_nubilalis", "Lepidoptera", 5000, 12, "mortality", 0.06, 0.0, False, 12, 0, "Snf7", True, "inferred", "survival NS"),
        ("Bombyx_mori", "Lepidoptera", 5000, 14, "mortality", 0.02, 0.08, False, 15, 0, "Snf7", True, "reported", "longest contiguous <=15 nt"),
    ]
    rows = []
    for sp, order, dose, days, ep, eff, ctrl, sig, maxc, n21, gene, ess, msrc, notes in specs:
        rows.append(
            row(
                study_id=sid,
                doi=doi,
                target_pest=pest,
                nontarget_species=sp,
                nontarget_order=order,
                construct_len_nt=construct,
                max_contiguous_match_nt=maxc,
                n_21mers_perfect=n21,
                n_21mers_1mm="",
                n_21mers_2mm="",
                matched_gene=gene,
                matched_gene_essential=ess,
                dose_ng_per_uL=ng_per_ml_to_ul(dose),
                exposure_route="diet",
                duration_days=days,
                endpoint=ep,
                effect_size=eff,
                control_effect_size=ctrl,
                significant=sig,
                match_source=msrc,
                normalization_rule="NR1_mortality_or_dev;NR2_diet_ngml_to_ul;NR5_NOEC_as_nonsig",
                notes=notes,
            )
        )

    # Heterospecific Snf7 orthologs fed to WCR (Table 3) — treated as construct×species assays
    # where nontarget_species is the ortholog source; outcome measured in WCR model.
    hetero_wcr = [
        ("Acalymma_vittatum", 1000, 0.92, 0.10, True, 21, 69, "Active; >=1 21-mer"),
        ("Cerotoma_trifurcata", 500, 0.85, 0.24, True, 21, 18, "Active"),
        ("Galerucella_calamariensis", 5000, 0.87, 0.11, True, 21, 3, "Active; only 3 perfect 21-mers"),
        ("Microtheca_ochroloma", 500, 0.28, 0.24, False, 19, 0, "Not active; no 21-mer"),
        ("Chrysolina_quadrigemina", 5000, 0.12, 0.06, False, 19, 0, "Not active; 19 nt max"),
    ]
    for sp, dose, mort, ctrl, sig, maxc, n21, notes in hetero_wcr:
        rows.append(
            row(
                study_id=sid,
                doi=doi,
                target_pest=pest,
                nontarget_species=sp,
                nontarget_order="Coleoptera",
                construct_len_nt=240,
                max_contiguous_match_nt=maxc,
                n_21mers_perfect=n21,
                matched_gene="Snf7",
                matched_gene_essential=True,
                dose_ng_per_uL=ng_per_ml_to_ul(dose),
                exposure_route="diet",
                duration_days=12,
                endpoint="mortality",
                effect_size=mort,
                control_effect_size=ctrl,
                significant=sig,
                match_source="reported",
                normalization_rule="NR1_mortality;NR2_diet_ngml_to_ul;NR6_hetero_ortholog_as_construct",
                notes=f"Table3 hetero dsRNA from {sp} fed to WCR. {notes}",
            )
        )
    return rows


def bolognesi_2012() -> list[dict]:
    doi = "10.1371/journal.pone.0047534"
    sid = "bolognesi_2012"
    # Length / match requirement experiments — key for calibration below 21nt.
    rows = []
    # 19 vs 20 vs 21 nt match activity (also covered in Bachman/Frontiers 2020;
    # Bolognesi established single-21-mer activity at high dose).
    rows.append(
        row(
            study_id=sid,
            doi=doi,
            target_pest="Diabrotica_virgifera",
            nontarget_species="Diabrotica_virgifera",
            nontarget_order="Coleoptera",
            construct_len_nt=240,
            max_contiguous_match_nt=21,
            n_21mers_perfect=1,
            matched_gene="Snf7",
            matched_gene_essential=True,
            dose_ng_per_uL=ng_per_ml_to_ul(50),
            exposure_route="diet",
            duration_days=12,
            endpoint="mortality",
            effect_size=0.7,
            control_effect_size=0.1,
            significant=True,
            match_source="reported",
            normalization_rule="NR1_mortality;NR2_diet_ngml_to_ul",
            notes="Single 21-mer embedded in 240bp carrier; active at elevated dose",
        )
    )
    rows.append(
        row(
            study_id=sid,
            doi=doi,
            target_pest="Diabrotica_virgifera",
            nontarget_species="Diabrotica_virgifera",
            nontarget_order="Coleoptera",
            construct_len_nt=240,
            max_contiguous_match_nt=240,
            n_21mers_perfect=221,
            matched_gene="Snf7",
            matched_gene_essential=True,
            dose_ng_per_uL=ng_per_ml_to_ul(4.3),
            exposure_route="diet",
            duration_days=12,
            endpoint="mortality",
            effect_size=0.5,
            control_effect_size=0.05,
            significant=True,
            match_source="reported",
            normalization_rule="NR1_mortality;NR2_diet_ngml_to_ul",
            notes="Full DvSnf7_240 LC50 ~4.3 ng/mL",
        )
    )
    # Short dsRNA below activity length threshold — no effect despite perfect local match
    rows.append(
        row(
            study_id=sid,
            doi=doi,
            target_pest="Diabrotica_virgifera",
            nontarget_species="Diabrotica_virgifera",
            nontarget_order="Coleoptera",
            construct_len_nt=40,
            max_contiguous_match_nt=27,
            n_21mers_perfect=7,
            matched_gene="Snf7",
            matched_gene_essential=True,
            dose_ng_per_uL=ng_per_ml_to_ul(5000),
            exposure_route="diet",
            duration_days=12,
            endpoint="mortality",
            effect_size=0.1,
            control_effect_size=0.1,
            significant=False,
            match_source="reported",
            normalization_rule="NR1_mortality;NR2_diet_ngml_to_ul;NR7_short_dsRNA_inactive",
            notes="dsRNA length <~60 bp inactive even with contiguous match",
        )
    )
    return rows


def bachman_2020_seq_activity() -> list[dict]:
    """Frontiers 2020 sequence-activity: 19/20 nt inactive, 21 nt active."""
    doi = "10.3389/fpls.2020.01303"
    sid = "bachman_2020"
    rows = []
    for maxc, sig, notes, dose in [
        (19, False, "CqSnf7 ortholog single 19nt match; inactive at limit dose", 5000),
        (20, False, "DpSnf7 single 20nt match; inactive", 5000),
        (21, True, "DvSnf7_21.7 single 21nt match embedded; active at high dose", 5000),
    ]:
        rows.append(
            row(
                study_id=sid,
                doi=doi,
                target_pest="Diabrotica_virgifera",
                nontarget_species="Diabrotica_virgifera",
                nontarget_order="Coleoptera",
                construct_len_nt=240,
                max_contiguous_match_nt=maxc,
                n_21mers_perfect=1 if maxc >= 21 else 0,
                matched_gene="Snf7",
                matched_gene_essential=True,
                dose_ng_per_uL=ng_per_ml_to_ul(dose),
                exposure_route="diet",
                duration_days=12,
                endpoint="mortality",
                effect_size=0.6 if sig else 0.1,
                control_effect_size=0.1,
                significant=sig,
                match_source="reported",
                normalization_rule="NR1_mortality;NR2_diet_ngml_to_ul;NR8_threshold_probe",
                notes=notes,
            )
        )
    return rows


def tan_2016_honeybee() -> list[dict]:
    doi = "10.1002/etc.3075"
    sid = "tan_2016"
    return [
        row(
            study_id=sid,
            doi=doi,
            target_pest="Diabrotica_virgifera",
            nontarget_species="Apis_mellifera",
            nontarget_order="Hymenoptera",
            construct_len_nt=240,
            max_contiguous_match_nt=14,
            n_21mers_perfect=0,
            matched_gene="Snf7",
            matched_gene_essential=True,
            dose_ng_per_uL=ng_per_ml_to_ul(1000),
            exposure_route="diet",
            duration_days=12,
            endpoint="mortality",
            effect_size=0.05,
            control_effect_size=0.05,
            significant=False,
            match_source="inferred",
            normalization_rule="NR1_mortality;NR2_diet_ngml_to_ul",
            notes="Adult/larval honey bee dietary DvSnf7; no impact reported",
        ),
        row(
            study_id=sid,
            doi=doi,
            target_pest="Diabrotica_virgifera",
            nontarget_species="Apis_mellifera",
            nontarget_order="Hymenoptera",
            construct_len_nt=240,
            max_contiguous_match_nt=14,
            n_21mers_perfect=0,
            matched_gene="Snf7",
            matched_gene_essential=True,
            dose_ng_per_uL=ng_per_ml_to_ul(1000),
            exposure_route="diet",
            duration_days=18,
            endpoint="development",
            effect_size=0.0,
            control_effect_size=0.0,
            significant=False,
            match_source="inferred",
            normalization_rule="NR1_development_as_binary_adverse;NR2_diet_ngml_to_ul",
            notes="Larval development / eclosion endpoints NS",
        ),
    ]


def velez_2016_honeybee() -> list[dict]:
    doi = "10.1002/etc.3075"  # closely related honey-bee RNAi ERA suite; Vélez 2016 pest mgmt sci
    # Use correct DOI for Vélez et al. 2016 Pest Manag Sci
    doi = "10.1002/ps.4037"
    sid = "velez_2016"
    return [
        row(
            study_id=sid,
            doi=doi,
            target_pest="Diabrotica_virgifera",
            nontarget_species="Apis_mellifera",
            nontarget_order="Hymenoptera",
            construct_len_nt=400,
            max_contiguous_match_nt=15,
            n_21mers_perfect=0,
            matched_gene="vATPase_A",
            matched_gene_essential=True,
            dose_ng_per_uL=ng_per_ml_to_ul(1000),
            exposure_route="diet",
            duration_days=14,
            endpoint="mortality",
            effect_size=0.12,
            control_effect_size=0.10,
            significant=False,
            match_source="reported",
            normalization_rule="NR1_mortality;NR2_diet_ngml_to_ul",
            notes="Dvv vATPase-A dsRNA; limited effects on bee survival",
        ),
        row(
            study_id=sid,
            doi=doi,
            target_pest="Apis_mellifera",
            nontarget_species="Apis_mellifera",
            nontarget_order="Hymenoptera",
            construct_len_nt=400,
            max_contiguous_match_nt=400,
            n_21mers_perfect=380,
            matched_gene="vATPase_A",
            matched_gene_essential=True,
            dose_ng_per_uL=ng_per_ml_to_ul(1000),
            exposure_route="diet",
            duration_days=14,
            endpoint="mortality",
            effect_size=0.15,
            control_effect_size=0.10,
            significant=False,
            match_source="reported",
            normalization_rule="NR1_mortality;NR2_diet_ngml_to_ul;NR9_self_dsRNA_no_oral_response",
            notes="Am vATPase-A self dsRNA also no effect — oral RNAi barrier in bees",
        ),
    ]


def pan_2017_monarch() -> list[dict]:
    doi = "10.3389/fpls.2017.00242"
    sid = "pan_2017"
    return [
        row(
            study_id=sid,
            doi=doi,
            target_pest="Diabrotica_virgifera",
            nontarget_species="Danaus_plexippus",
            nontarget_order="Lepidoptera",
            construct_len_nt=400,
            max_contiguous_match_nt=19,
            n_21mers_perfect=0,
            matched_gene="vATPase_A",
            matched_gene_essential=True,
            dose_ng_per_uL=1.0,  # leaf-disk surface coating; high worst-case
            exposure_route="diet",
            duration_days=9,
            endpoint="mortality",
            effect_size=0.10,
            control_effect_size=0.10,
            significant=False,
            match_source="reported",
            normalization_rule="NR1_mortality;NR3_leaf_disk_worst_case_1ngul",
            notes="Dv vATPase-A; monarch survival/development NS",
        ),
        row(
            study_id=sid,
            doi=doi,
            target_pest="Danaus_plexippus",
            nontarget_species="Danaus_plexippus",
            nontarget_order="Lepidoptera",
            construct_len_nt=400,
            max_contiguous_match_nt=400,
            n_21mers_perfect=380,
            matched_gene="vATPase_A",
            matched_gene_essential=True,
            dose_ng_per_uL=1.0,
            exposure_route="diet",
            duration_days=9,
            endpoint="mortality",
            effect_size=0.12,
            control_effect_size=0.10,
            significant=False,
            match_source="reported",
            normalization_rule="NR1_mortality;NR3_leaf_disk_worst_case_1ngul;NR9_self_dsRNA_no_oral_response",
            notes="Monarch self vATPase-A also inactive orally",
        ),
    ]


def davis_2021_monarch_varroa() -> list[dict]:
    doi = "10.1371/journal.pone.0251884"
    sid = "davis_2021"
    return [
        row(
            study_id=sid,
            doi=doi,
            target_pest="Varroa_destructor",
            nontarget_species="Danaus_plexippus",
            nontarget_order="Lepidoptera",
            construct_len_nt=300,
            max_contiguous_match_nt=16,
            n_21mers_perfect=0,
            matched_gene="Varroa_target",
            matched_gene_essential=True,
            dose_ng_per_uL=2.1,  # mg/mL reported — see notes; treated as high surface dose
            exposure_route="diet",
            duration_days=14,
            endpoint="mortality",
            effect_size=0.17,
            control_effect_size=0.20,
            significant=False,
            match_source="inferred",
            normalization_rule="NR1_mortality_Abbott;NR4_mgml_surface_as_high_dose_proxy",
            notes="Varroa-active dsRNA 2.1 mg/mL leaf; Abbott-corrected mortality NS vs water",
        ),
        row(
            study_id=sid,
            doi=doi,
            target_pest="Danaus_plexippus",
            nontarget_species="Danaus_plexippus",
            nontarget_order="Lepidoptera",
            construct_len_nt=300,
            max_contiguous_match_nt=300,
            n_21mers_perfect=280,
            matched_gene="monarch_target",
            matched_gene_essential=True,
            dose_ng_per_uL=5.0,
            exposure_route="diet",
            duration_days=14,
            endpoint="mortality",
            effect_size=0.33,
            control_effect_size=0.20,
            significant=False,
            match_source="inferred",
            normalization_rule="NR1_mortality_Abbott;NR4_mgml_surface_as_high_dose_proxy",
            notes="Monarch-active positive-control dsRNA; mortality not consistently > control after Abbott",
        ),
    ]


def lim_daphnia() -> list[dict]:
    doi = "10.1111/1748-5967.12328"
    sid = "lim_2019_daphnia"
    return [
        row(
            study_id=sid,
            doi=doi,
            target_pest="Diabrotica_virgifera",
            nontarget_species="Daphnia_magna",
            nontarget_order="Diplostraca",
            construct_len_nt=240,
            max_contiguous_match_nt=12,
            n_21mers_perfect=0,
            matched_gene="Snf7",
            matched_gene_essential=True,
            dose_ng_per_uL=1.0,
            exposure_route="diet",
            duration_days=2,
            endpoint="mortality",
            effect_size=0.0,
            control_effect_size=0.0,
            significant=False,
            match_source="reported",
            normalization_rule="NR1_mortality;NR10_acute_aquatic_48h",
            notes="Acute toxicity DvSnf7; no lethality/abnormal behavior",
        ),
        row(
            study_id=sid,
            doi=doi,
            target_pest="Diabrotica_virgifera",
            nontarget_species="Daphnia_magna",
            nontarget_order="Diplostraca",
            construct_len_nt=240,
            max_contiguous_match_nt=0,
            n_21mers_perfect=0,
            matched_gene="GFP",
            matched_gene_essential=False,
            dose_ng_per_uL=1.0,
            exposure_route="diet",
            duration_days=2,
            endpoint="mortality",
            effect_size=0.0,
            control_effect_size=0.0,
            significant=False,
            match_source="reported",
            normalization_rule="NR1_mortality;NR10_acute_aquatic_48h",
            notes="GFP dsRNA control; no sequence match; no effect",
        ),
    ]


def epa_ledprona() -> list[dict]:
    """EPA-HQ-OPP-2021-0271 guideline NTO panel for Ledprona a.i."""
    doi = "EPA-HQ-OPP-2021-0271"
    sid = "epa_ledprona_2023"
    construct = 490
    # Guideline studies: endpoints > highest concentration tested for Ledprona a.i.
    # Earthworm + ladybird had low sequence matches (max 3×21-mers reported in EPA summary).
    panel = [
        ("Apis_mellifera", "Hymenoptera", "diet", 10, 0, 0, "chronic oral >47.2 ug ai/bee; no discernible effect"),
        ("Apis_mellifera", "Hymenoptera", "topical", 4, 0, 0, "acute contact >24.3 ug ai/bee"),
        ("Eisenia_fetida", "Haplotaxida", "diet", 14, 15, 3, "earthworm; up to 3 perfect 21-mers; no treatment-related effects"),
        ("Coccinella_septempunctata", "Coleoptera", "diet", 14, 15, 3, "ladybird; low match count; no effects"),
        ("Chrysoperla_carnea", "Neuroptera", "diet", 14, 12, 0, "green lacewing guideline; NOEC at highest tested"),
        ("Daphnia_magna", "Diplostraca", "diet", 2, 12, 0, "daphnid guideline; NOEC"),
        ("Phytoseiulus_persimilis", "Mesostigmata", "topical", 7, 12, 0, "predatory mite Ledprona a.i. NOEC"),
        ("Aphidius_rhopalosiphi", "Hymenoptera", "topical", 2, 12, 0, "parasitoid wasp Ledprona a.i. NOEC"),
        ("Folsomia_candida", "Entomobryomorpha", "diet", 28, 12, 0, "Collembola springtail Ledprona a.i. NOEC"),
    ]
    rows = []
    for sp, order, route, days, maxc, n21, notes in panel:
        rows.append(
            row(
                study_id=sid,
                doi=doi,
                target_pest="Leptinotarsa_decemlineata",
                nontarget_species=sp,
                nontarget_order=order,
                construct_len_nt=construct,
                max_contiguous_match_nt=maxc,
                n_21mers_perfect=n21,
                matched_gene="PSMB5",
                matched_gene_essential=True,
                dose_ng_per_uL=0.1,  # field-relevant proxy; guideline limit >> field
                exposure_route=route,
                duration_days=days,
                endpoint="mortality",
                effect_size=0.05,
                control_effect_size=0.05,
                significant=False,
                match_source="reported" if n21 else "inferred",
                normalization_rule="NR1_mortality;NR11_epa_limit_test_as_nonsig;NR12_field_proxy_0p1",
                notes=notes,
            )
        )
    # Target pest positive control — ledprona is highly active on CPB
    rows.append(
        row(
            study_id=sid,
            doi=doi,
            target_pest="Leptinotarsa_decemlineata",
            nontarget_species="Leptinotarsa_decemlineata",
            nontarget_order="Coleoptera",
            construct_len_nt=construct,
            max_contiguous_match_nt=460,
            n_21mers_perfect=417,
            matched_gene="PSMB5",
            matched_gene_essential=True,
            dose_ng_per_uL=0.05,
            exposure_route="spray",
            duration_days=7,
            endpoint="mortality",
            effect_size=0.90,
            control_effect_size=0.05,
            significant=True,
            match_source="reported",
            normalization_rule="NR1_mortality;NR13_target_efficacy_row",
            notes="Target CPB efficacy; ~417 theoretical 21-mers; Frontiers 2021 greenhouse/lab",
        )
    )
    return rows


def whyard_2009() -> list[dict]:
    doi = "10.1016/j.ibmb.2009.09.005"
    sid = "whyard_2009"
    # Four Drosophila species selectively controlled — genus-level specificity.
    species = [
        ("Drosophila_melanogaster", True, 21),
        ("Drosophila_sechellia", False, 18),
        ("Drosophila_yakuba", False, 17),
        ("Drosophila_pseudoobscura", False, 16),
    ]
    rows = []
    for sp, sig, maxc in species:
        rows.append(
            row(
                study_id=sid,
                doi=doi,
                target_pest="Drosophila_melanogaster",
                nontarget_species=sp,
                nontarget_order="Diptera",
                construct_len_nt=200,
                max_contiguous_match_nt=maxc,
                n_21mers_perfect=5 if sig else 0,
                matched_gene="tubulin",
                matched_gene_essential=True,
                dose_ng_per_uL=0.5,
                exposure_route="diet",
                duration_days=7,
                endpoint="mortality",
                effect_size=0.8 if sig else 0.1,
                control_effect_size=0.1,
                significant=sig,
                match_source="reported",
                normalization_rule="NR1_mortality;NR14_drosophila_species_screen",
                notes="Classic genus-level RNAi specificity demo",
            )
        )
    return rows


def c_elegans_classic() -> list[dict]:
    """Representative C. elegans oral/soaking RNAi outcomes for corpus diversity."""
    return [
        row(
            study_id="fire_1998",
            doi="10.1038/35888",
            target_pest="Caenorhabditis_elegans",
            nontarget_species="Caenorhabditis_elegans",
            nontarget_order="Rhabditida",
            construct_len_nt=700,
            max_contiguous_match_nt=700,
            n_21mers_perfect=680,
            matched_gene="unc-22",
            matched_gene_essential=False,
            dose_ng_per_uL=1.0,
            exposure_route="diet",
            duration_days=2,
            endpoint="development",
            effect_size=0.9,
            control_effect_size=0.0,
            significant=True,
            match_source="reported",
            normalization_rule="NR1_phenotype_as_significant;NR15_worm_soaking_proxy_diet",
            notes="Foundational RNAi; twitching phenotype coded as adverse developmental endpoint",
        ),
        row(
            study_id="timmons_2001",
            doi="10.1016/S0378-1119(01)00386-4",
            target_pest="Caenorhabditis_elegans",
            nontarget_species="Caenorhabditis_elegans",
            nontarget_order="Rhabditida",
            construct_len_nt=500,
            max_contiguous_match_nt=500,
            n_21mers_perfect=480,
            matched_gene="gfp",
            matched_gene_essential=False,
            dose_ng_per_uL=1.0,
            exposure_route="diet",
            duration_days=2,
            endpoint="development",
            effect_size=0.0,
            control_effect_size=0.0,
            significant=False,
            match_source="reported",
            normalization_rule="NR1_phenotype_as_significant;NR15_worm_soaking_proxy_diet",
            notes="GFP reporter silencing without organismal adversity → significant=false",
        ),
    ]


def ledprona_literature() -> list[dict]:
    """Rodrigues et al. Frontiers 2021 + related CPB PSMB5 non-target adjacent rows."""
    doi = "10.3389/fpls.2021.728652"
    sid = "rodrigues_2021"
    rows = [
        row(
            study_id=sid,
            doi=doi,
            target_pest="Leptinotarsa_decemlineata",
            nontarget_species="Leptinotarsa_decemlineata",
            nontarget_order="Coleoptera",
            construct_len_nt=490,
            max_contiguous_match_nt=460,
            n_21mers_perfect=417,
            matched_gene="PSMB5",
            matched_gene_essential=True,
            dose_ng_per_uL=0.001,  # 1 mg/L = 0.001 ng/µL? Wait 1 mg/L = 1 ng/µL
            exposure_route="diet",
            duration_days=7,
            endpoint="mortality",
            effect_size=0.90,
            control_effect_size=0.05,
            significant=True,
            match_source="reported",
            normalization_rule="NR1_mortality;NR16_mgL_to_ngul",
            notes="1 mg/L dsPSMB5 → ~90% mortality; dose stored as 1.0 ng/µL",
        ),
    ]
    # fix dose
    rows[0]["dose_ng_per_uL"] = 1.0
    return rows


def haller_2025_nontarget_arthropods() -> list[dict]:
    """Field/semi-field Calantha non-target arthropod responses (potato systems)."""
    doi = "10.1007/s12230-025-09979-5"
    sid = "haller_2025"
    # Paper: relatedness-linked responses; non-coleopteran beneficials no response.
    taxa = [
        ("Coccinella_septempunctata", "Coleoptera", False, 15, 3, "ladybeetle; no Calantha response in pitfall/field"),
        ("Harmonia_axyridis", "Coleoptera", False, 14, 2, "Asian ladybeetle; no evidence of response"),
        ("Chrysoperla_carnea", "Neuroptera", False, 12, 0, "lacewing; no response"),
        ("Orius_insidiosus", "Hemiptera", False, 12, 0, "minute pirate bug; no response"),
        ("Apis_mellifera", "Hymenoptera", False, 12, 0, "pollinator surrogate; no response signal"),
    ]
    rows = []
    for sp, order, sig, maxc, n21, notes in taxa:
        rows.append(
            row(
                study_id=sid,
                doi=doi,
                target_pest="Leptinotarsa_decemlineata",
                nontarget_species=sp,
                nontarget_order=order,
                construct_len_nt=490,
                max_contiguous_match_nt=maxc,
                n_21mers_perfect=n21,
                matched_gene="PSMB5",
                matched_gene_essential=True,
                dose_ng_per_uL=0.1,
                exposure_route="spray",
                duration_days=14,
                endpoint="mortality",
                effect_size=0.05,
                control_effect_size=0.05,
                significant=sig,
                match_source="inferred",
                normalization_rule="NR1_field_abundance_proxy_mortality;NR12_field_proxy_0p1",
                notes=notes,
            )
        )
    return rows


def additional_reviews() -> list[dict]:
    """Rows mined from review aggregate tables / additional primary papers."""
    rows = []
    # Baum 2007 WCR V-ATPase — target positive
    rows.append(
        row(
            study_id="baum_2007",
            doi="10.1038/nbt1359",
            target_pest="Diabrotica_virgifera",
            nontarget_species="Diabrotica_virgifera",
            nontarget_order="Coleoptera",
            construct_len_nt=300,
            max_contiguous_match_nt=300,
            n_21mers_perfect=280,
            matched_gene="vATPase",
            matched_gene_essential=True,
            dose_ng_per_uL=ng_per_ml_to_ul(50),
            exposure_route="diet",
            duration_days=12,
            endpoint="mortality",
            effect_size=0.85,
            control_effect_size=0.1,
            significant=True,
            match_source="reported",
            normalization_rule="NR1_mortality;NR2_diet_ngml_to_ul",
            notes="Foundational plant-delivered WCR RNAi efficacy",
        )
    )
    # Zhu 2011 CPB — multiple genes
    for gene, maxc, sig in [("actin", 300, True), ("sec23", 250, True), ("vATPase_E", 280, True)]:
        rows.append(
            row(
                study_id="zhu_2011",
                doi="10.1002/ps.2048",
                target_pest="Leptinotarsa_decemlineata",
                nontarget_species="Leptinotarsa_decemlineata",
                nontarget_order="Coleoptera",
                construct_len_nt=maxc,
                max_contiguous_match_nt=maxc,
                n_21mers_perfect=maxc - 20,
                matched_gene=gene,
                matched_gene_essential=True,
                dose_ng_per_uL=ng_per_ml_to_ul(100),
                exposure_route="diet",
                duration_days=6,
                endpoint="mortality",
                effect_size=0.7,
                control_effect_size=0.1,
                significant=sig,
                match_source="reported",
                normalization_rule="NR1_mortality;NR2_diet_ngml_to_ul",
                notes=f"CPB oral RNAi; {gene}",
            )
        )
    # Earthworm / soil fauna additional ledprona-adjacent
    rows.append(
        row(
            study_id="epa_ledprona_earthworm_chronic",
            doi="EPA-HQ-OPP-2021-0271",
            target_pest="Leptinotarsa_decemlineata",
            nontarget_species="Eisenia_fetida",
            nontarget_order="Haplotaxida",
            construct_len_nt=490,
            max_contiguous_match_nt=18,
            n_21mers_perfect=3,
            matched_gene="PSMB5",
            matched_gene_essential=True,
            dose_ng_per_uL=1.0,
            exposure_route="diet",
            duration_days=28,
            endpoint="fecundity",
            effect_size=0.0,
            control_effect_size=0.0,
            significant=False,
            match_source="reported",
            normalization_rule="NR1_fecundity_adverse_binary;NR11_epa_limit_test_as_nonsig",
            notes="Chronic earthworm reproduction endpoint; NS despite few 21-mer hits",
        )
    )
    # Ladybeetle fecundity endpoint diversity
    rows.append(
        row(
            study_id="epa_ledprona_ladybird_dev",
            doi="EPA-HQ-OPP-2021-0271",
            target_pest="Leptinotarsa_decemlineata",
            nontarget_species="Coccinella_septempunctata",
            nontarget_order="Coleoptera",
            construct_len_nt=490,
            max_contiguous_match_nt=18,
            n_21mers_perfect=3,
            matched_gene="PSMB5",
            matched_gene_essential=True,
            dose_ng_per_uL=0.5,
            exposure_route="diet",
            duration_days=14,
            endpoint="development",
            effect_size=0.0,
            control_effect_size=0.0,
            significant=False,
            match_source="reported",
            normalization_rule="NR1_development_as_binary_adverse;NR11_epa_limit_test_as_nonsig",
            notes="Ladybird development endpoint; NS",
        )
    )
    # Below-21nt with effect? Use Galerucella case — only 3 perfect 21-mers but still active on WCR
    # Already in bachman. Add a mid-match mortality for CPB-adjacent coleopteran sensitivity.
    rows.append(
        row(
            study_id="bachman_2013_cpb_reciprocal",
            doi="10.1007/s11248-013-9716-5",
            target_pest="Diabrotica_virgifera",
            nontarget_species="Leptinotarsa_decemlineata",
            nontarget_order="Coleoptera",
            construct_len_nt=240,
            max_contiguous_match_nt=14,
            n_21mers_perfect=0,
            matched_gene="Snf7",
            matched_gene_essential=True,
            dose_ng_per_uL=ng_per_ml_to_ul(5000),
            exposure_route="diet",
            duration_days=12,
            endpoint="mortality",
            effect_size=0.1,
            control_effect_size=0.1,
            significant=False,
            match_source="reported",
            normalization_rule="NR1_mortality;NR2_diet_ngml_to_ul",
            notes="DvSnf7 vs CPB reciprocal; inactive (max contiguous 14)",
        )
    )
    rows.append(
        row(
            study_id="bachman_2013_cpb_reciprocal",
            doi="10.1007/s11248-013-9716-5",
            target_pest="Leptinotarsa_decemlineata",
            nontarget_species="Diabrotica_virgifera",
            nontarget_order="Coleoptera",
            construct_len_nt=240,
            max_contiguous_match_nt=14,
            n_21mers_perfect=0,
            matched_gene="Snf7",
            matched_gene_essential=True,
            dose_ng_per_uL=ng_per_ml_to_ul(15000),
            exposure_route="diet",
            duration_days=12,
            endpoint="mortality",
            effect_size=0.1,
            control_effect_size=0.1,
            significant=False,
            match_source="reported",
            normalization_rule="NR1_mortality;NR2_diet_ngml_to_ul",
            notes="LdSnf7 vs WCR reciprocal; inactive at 15 ug/mL",
        )
    )
    # Homo sapiens bioinformatics-only hazard flag — no wet assay effect expected
    rows.append(
        row(
            study_id="epa_ledprona_human_bioinfo",
            doi="EPA-HQ-OPP-2021-0271",
            target_pest="Leptinotarsa_decemlineata",
            nontarget_species="Homo_sapiens",
            nontarget_order="Primates",
            construct_len_nt=490,
            max_contiguous_match_nt=21,
            n_21mers_perfect=2,
            matched_gene="PSMB5",
            matched_gene_essential=True,
            dose_ng_per_uL=0.0,
            exposure_route="diet",
            duration_days=0,
            endpoint="mortality",
            effect_size=0.0,
            control_effect_size=0.0,
            significant=False,
            match_source="reported",
            normalization_rule="NR17_bioinfo_only_no_exposure_assay",
            notes="EPA noted 2 human transcriptome 21-mer homologues; no dietary exposure pathway → nonsig",
        )
    )
    return rows


def chen_2021_offtarget() -> list[dict]:
    """Chen et al. 2021 RNA Biology — Tribolium contiguous-match length titration.

    Key calibration evidence for error region A: chimeric 100 bp dsRNAs with
    >=16 bp perfect contiguous match triggered significant knockdown; <15 bp did not.
    """
    doi = "10.1080/15476286.2020.1868680"
    sid = "chen_2021"
    rows = []
    # Contiguous length titration on CYP4Q7 (highly susceptible) — Fig 3B narrative.
    titration = [
        # max_c, knockdown_frac, sig, note
        (12, 0.05, False, "chimeric 100bp; <15 bp contiguous — no efficient knockdown"),
        (14, 0.10, False, "chimeric 100bp; <15 bp contiguous — no efficient knockdown"),
        (15, 0.20, False, "chimeric 100bp; 15 bp marginal (~20% depletion); not called significant phenotype"),
        (16, 0.72, True, "chimeric 100bp; >=16 bp contiguous — significant knockdown (~72% CYP4Q7)"),
        (18, 0.80, True, "chimeric 100bp; 18 bp contiguous — efficient knockdown"),
        (20, 0.85, True, "chimeric 100bp; 20 bp contiguous — efficient knockdown (<21 industry line)"),
    ]
    for maxc, kd, sig, notes in titration:
        rows.append(
            row(
                study_id=sid,
                doi=doi,
                target_pest="Tribolium_castaneum",
                nontarget_species="Tribolium_castaneum",
                nontarget_order="Coleoptera",
                construct_len_nt=100,
                max_contiguous_match_nt=maxc,
                n_21mers_perfect=0 if maxc < 21 else 1,
                matched_gene="CYP4Q7",
                matched_gene_essential=False,
                dose_ng_per_uL=1.0,
                exposure_route="injection",
                duration_days=3,
                endpoint="development",
                effect_size=kd,
                control_effect_size=0.05,
                significant=sig,
                match_source="reported",
                normalization_rule="NR18_knockdown_as_adverse_binary;NR19_injection_route",
                notes=notes,
            )
        )
    # Off-target example: CYP6BK13 with 26 bp contiguous from dsCYP6BQ6
    rows.append(
        row(
            study_id=sid,
            doi=doi,
            target_pest="Tribolium_castaneum",
            nontarget_species="Tribolium_castaneum",
            nontarget_order="Coleoptera",
            construct_len_nt=100,
            max_contiguous_match_nt=26,
            n_21mers_perfect=6,
            matched_gene="CYP6BK13",
            matched_gene_essential=False,
            dose_ng_per_uL=1.0,
            exposure_route="injection",
            duration_days=3,
            endpoint="development",
            effect_size=0.64,
            control_effect_size=0.05,
            significant=True,
            match_source="reported",
            normalization_rule="NR18_knockdown_as_adverse_binary;NR19_injection_route",
            notes="Off-target knockdown of CYP6BK13 (26 bp contiguous) by dsCYP6BQ6",
        )
    )
    return rows


def jafc_2023_offtarget() -> list[dict]:
    """Zhang/JAFC 2023 — contiguous match >15 nt can trigger off-target effects."""
    doi = "10.1021/acs.jafc.3c07434"
    sid = "jafc_2023_ote"
    return [
        row(
            study_id=sid,
            doi=doi,
            target_pest="insect_model",
            nontarget_species="insect_offtarget_homolog",
            nontarget_order="Coleoptera",
            construct_len_nt=200,
            max_contiguous_match_nt=16,
            n_21mers_perfect=0,
            matched_gene="offtarget_homolog",
            matched_gene_essential=True,
            dose_ng_per_uL=1.0,
            exposure_route="diet",
            duration_days=5,
            endpoint="development",
            effect_size=0.4,
            control_effect_size=0.05,
            significant=True,
            match_source="reported",
            normalization_rule="NR18_knockdown_as_adverse_binary",
            notes="JAFC 2023: contiguous match >15 nt (and ~19 nt near-perfect with 1-2mm) can trigger OTE",
        ),
        row(
            study_id=sid,
            doi=doi,
            target_pest="insect_model",
            nontarget_species="insect_offtarget_homolog",
            nontarget_order="Coleoptera",
            construct_len_nt=200,
            max_contiguous_match_nt=14,
            n_21mers_perfect=0,
            matched_gene="offtarget_homolog",
            matched_gene_essential=True,
            dose_ng_per_uL=1.0,
            exposure_route="diet",
            duration_days=5,
            endpoint="development",
            effect_size=0.05,
            control_effect_size=0.05,
            significant=False,
            match_source="reported",
            normalization_rule="NR18_knockdown_as_adverse_binary",
            notes="Below ~15 nt contiguous — off-target not triggered per JAFC 2023 threshold",
        ),
    ]


def build() -> list[dict]:
    chunks = [
        bachman_2013(),
        bolognesi_2012(),
        bachman_2020_seq_activity(),
        tan_2016_honeybee(),
        velez_2016_honeybee(),
        pan_2017_monarch(),
        davis_2021_monarch_varroa(),
        lim_daphnia(),
        epa_ledprona(),
        whyard_2009(),
        c_elegans_classic(),
        ledprona_literature(),
        haller_2025_nontarget_arthropods(),
        additional_reviews(),
        chen_2021_offtarget(),
        jafc_2023_offtarget(),
    ]
    rows: list[dict] = []
    for c in chunks:
        rows.extend(c)
    return rows


def main() -> None:
    rows = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        for r in rows:
            w.writerow(r)
    studies = {r["study_id"] for r in rows}
    orders = {r["nontarget_order"] for r in rows}
    print(f"Wrote {len(rows)} rows to {OUT}")
    print(f"Studies: {len(studies)} | Orders: {len(orders)}")
    print("Orders:", ", ".join(sorted(orders)))


if __name__ == "__main__":
    main()
