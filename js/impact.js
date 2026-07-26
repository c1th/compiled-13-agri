// Field impact — appears once the analysis has diagnosed zones and derived
// application volumes. Every number is computed from the plan itself: on a
// live run the per-zone severities, areas and volumes are model output, so
// these figures are grounded in the actual survey rather than canned copy.
//
// Modeling constants are declared here and the panel's small print names the
// basis — keep it honest about what is measured vs what is modeled.

// Fraction of a zone's yield expected lost if its pest pressure goes
// untreated: 12% at the detection threshold rising to 40% at severity 1.0,
// inside the 10-40% range reported for uncontrolled row-crop infestations.
const IMPACT_LOSS_MIN = 0.12;
const IMPACT_LOSS_SPAN = 0.28;
// Field efficacy of a well-timed biological application (published 60-90%).
const IMPACT_EFFICACY = 0.78;

function initImpact(data) {
  const body = document.getElementById('impact-body');
  if (!body) return;

  const zones = (data && data.zones) || [];
  const treated = zones.filter((z) => z.treatment_id !== 'none');
  if (!treated.length) {
    body.innerHTML = '<span class="empty-note">Run the analysis — impact figures appear once zones are diagnosed and per-zone volumes are derived.</span>';
    return;
  }

  const total = data.summary.total_acres || 0;
  const treatedAcres = treated.reduce((s, z) => s + z.area_acres, 0);
  const prescribedGal = treated.reduce((s, z) => s + z.volume_gal, 0);
  const noSprayAcres = zones.filter((z) => z.treatment_id === 'none')
    .reduce((s, z) => s + z.area_acres, 0);

  // Blanket-spray counterfactual: the whole field at the plan's average rate.
  const avgRate = treatedAcres > 0 ? prescribedGal / treatedAcres : 0;
  const blanketGal = total * avgRate;
  const galAvoided = Math.max(0, blanketGal - prescribedGal);
  const savingsPct = data.summary.pct_reduction || 0;

  // Yield protected: per-zone expected loss if untreated, discounted by
  // treatment efficacy, expressed against the whole surveyed field.
  const savedAcresEq = treated.reduce((s, z) =>
    s + z.area_acres * (IMPACT_LOSS_MIN + IMPACT_LOSS_SPAN * Math.min(1, z.severity)) * IMPACT_EFFICACY, 0);
  const yieldSavedPct = total > 0 ? (savedAcresEq / total) * 100 : 0;

  const live = data.source === 'claude';
  const fmt = (v, dp) => Number(v).toLocaleString('en-US', {
    minimumFractionDigits: dp, maximumFractionDigits: dp
  });

  const treatedPct = total > 0 ? (treatedAcres / total) * 100 : 0;

  body.innerHTML =
    '<div class="impact-hero">' +
      '<div class="impact-hero-num num">' + fmt(savingsPct, 0) + '<span>%</span></div>' +
      '<div class="impact-hero-side">' +
        '<div class="impact-hero-label">Pesticide use cut</div>' +
        '<div class="impact-bar">' +
          '<div class="impact-bar-fill" style="width:' + Math.min(100, Math.max(2, treatedPct)).toFixed(1) + '%"></div>' +
        '</div>' +
        '<div class="impact-bar-legend">' +
          '<span class="num">' + fmt(treatedAcres, 0) + ' ac</span> sprayed' +
          '<span class="impact-legend-gap"></span>' +
          '<span class="num">' + fmt(total, 0) + ' ac</span> field' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="impact-rows">' +
      row(fmt(galAvoided, 0), 'gal', 'Chemical avoided', 'vs blanket-spraying the whole field') +
      row(fmt(prescribedGal, 1), 'gal', 'Volume prescribed',
        fmt(avgRate, 2) + ' gal/ac across ' + treated.length + ' zone' + (treated.length === 1 ? '' : 's')) +
      row(fmt(yieldSavedPct, 1), '%', 'Yield loss averted',
        '≈ ' + fmt(savedAcresEq, 1) + ' acre-equivalents of harvest protected') +
      row(fmt(noSprayAcres, 1), 'ac', 'Diagnosed, not sprayed', 'water or nitrogen stress — spraying would be wasted') +
    '</div>' +
    (live ? '' : '<div class="impact-flag">Simulated plan</div>');

  function row(num, unit, label, sub) {
    return '<div class="impact-row">' +
      '<div class="impact-row-val"><span class="num">' + num + '</span>' +
        '<span class="impact-unit">' + unit + '</span></div>' +
      '<div class="impact-row-text">' +
        '<div class="impact-row-label">' + label + '</div>' +
        '<div class="impact-row-sub">' + sub + '</div>' +
      '</div>' +
    '</div>';
  }
}
