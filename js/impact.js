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
    body.innerHTML = '<span class="procure-empty">Run the analysis — impact figures appear once zones are diagnosed and per-zone volumes are derived.</span>';
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

  body.innerHTML =
    '<div class="impact-grid">' +
      tile('hero', fmt(savingsPct, 0) + '%', 'Pesticide use cut',
        fmt(galAvoided, 0) + ' gal not sprayed vs blanket-treating all ' +
        fmt(total, 0) + ' acres') +
      tile('', fmt(yieldSavedPct, 1) + '%', 'Yield loss averted',
        '≈ ' + fmt(savedAcresEq, 1) + ' acre-equivalents of harvest protected across ' +
        treated.length + ' treated zones') +
      tile('', fmt(prescribedGal, 1) + ' gal', 'Targeted spray volume',
        fmt(treatedAcres, 1) + ' acres treated at ' + fmt(avgRate, 2) + ' gal/ac average') +
      tile('', fmt(noSprayAcres, 1) + ' ac', 'Spared unnecessary chemicals',
        'stress there is water or nitrogen — diagnosed do-not-spray, so treatment would be wasted') +
    '</div>';

  function tile(kind, num, label, sub) {
    return '<div class="impact-tile' + (kind === 'hero' ? ' hero' : '') + '">' +
      '<div class="impact-num num">' + num + '</div>' +
      '<div class="impact-label">' + label + '</div>' +
      '<div class="impact-sub">' + sub + '</div>' +
    '</div>';
  }
}
