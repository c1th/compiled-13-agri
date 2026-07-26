// Recommended treatment distribution — groups zones by prescribed product.
// This is the optimal plan, not a stock allocation: quantities are whatever
// the agronomy calls for. The do-not-spray group renders LAST and visually
// distinct: it is the proof we diagnose rather than just detect.

function initBreakdown(data) {
  const body = document.getElementById('breakdown-body');
  if (!body) return;
  body.innerHTML = '';

  const keys = Object.keys(data.treatments)
    .filter((k) => data.zones.some((z) => z.treatment_id === k))
    .sort((a, b) => (a === 'none') - (b === 'none')); // 'none' always last

  if (!keys.length) {
    // If regions were surveyed and found barren, say so rather than showing a
    // generic prompt — the user needs to know why there is nothing here.
    const barren = (data.regions || []).filter((r) => r.assessment && r.assessment.plantable === false);
    if (barren.length) {
      body.innerHTML = '<div class="tb-group nospray">' +
        '<div class="tb-head"><span class="tb-name">No plantable crop found</span></div>' +
        barren.map((r) =>
          '<div class="tb-why"><strong>' + r.label + '</strong> — ' +
          (r.assessment.land_cover || 'not farmland') + '. ' + (r.assessment.note || '') + '</div>'
        ).join('') +
        '<div class="tb-why">Move the region over cultivated farmland and run the analysis again.</div>' +
        '</div>';
      return;
    }
    body.innerHTML = '<span class="empty-note">Draw a region on the map, then run the analysis.</span>';
    return;
  }

  for (const key of keys) {
    const t = data.treatments[key];
    const zones = data.zones.filter((z) => z.treatment_id === key);
    const acres = zones.reduce((sum, z) => sum + z.area_acres, 0);
    const gallons = zones.reduce((sum, z) => sum + z.volume_gal, 0);
    const noSpray = key === 'none';

    const group = document.createElement('div');
    group.className = 'tb-group' + (noSpray ? ' nospray' : '');

    const swatch = noSpray
      ? '<span class="legend-swatch nospray" style="border-color:' + t.color + '"></span>'
      : '<span class="legend-swatch" style="background:' + t.color + '"></span>';

    group.innerHTML =
      '<div class="tb-head">' + swatch +
        '<span class="tb-name">' + (noSpray ? 'Diagnosed &mdash; no spray needed' : t.name) + '</span>' +
        '<span class="tb-count num">' + zones.length + ' zone' + (zones.length === 1 ? '' : 's') + '</span>' +
      '</div>' +
      '<div class="tb-stats">' +
        '<span><span class="num">' + acres.toFixed(1) + '</span> acres</span>' +
        '<span><span class="num">' + gallons.toFixed(1) + '</span> gal</span>' +
        (noSpray ? '' : '<span><span class="num">' + (gallons / acres).toFixed(2) + '</span> gal/ac avg</span>') +
      '</div>' +
      (noSpray
        ? '<div class="tb-why">Stress explained by moisture-index anomaly / NDRE deficit &mdash; irrigation and fertility, not pests.</div>'
        : '');

    body.appendChild(group);
  }
}
