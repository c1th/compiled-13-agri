// KPI row — reads FIELD.summary directly. Never recomputes.

function initKPI(data) {
  const s = data.summary;
  const m = data.meta;

  document.getElementById('field-name').textContent = m.name;
  document.getElementById('field-date').textContent = m.date;

  const cards = [
    { label: 'Total field', value: fmtNum(s.total_acres), unit: 'acres' },
    { label: 'Acres treated', value: fmtNum(s.flagged_acres), unit: 'acres', sub: fmtNum(s.pct_flagged) + '% of field' },
    { label: 'Pesticide reduction', value: fmtNum(s.pct_reduction) + '%', hero: true, sub: 'vs whole-field spray' },
    { label: 'Saved this pass', value: '$' + fmtNum(s.dollars_saved) }
  ];

  const row = document.getElementById('kpi-row');
  row.innerHTML = '';
  for (const c of cards) {
    const card = document.createElement('div');
    card.className = 'kpi-card' + (c.hero ? ' hero' : '');
    card.innerHTML =
      '<div class="kpi-label">' + c.label + '</div>' +
      '<div class="kpi-value">' + c.value +
        (c.unit ? '<span class="kpi-unit">' + c.unit + '</span>' : '') +
      '</div>' +
      (c.sub ? '<div class="kpi-sub num">' + c.sub + '</div>' : '');
    row.appendChild(card);
  }
}

function fmtNum(n) {
  return Number(n).toLocaleString('en-US');
}

// Treatment breakdown — groups zones by treatment_id. The do-not-spray
// group renders LAST and visually distinct: it is the proof we diagnose
// rather than just detect.

function initBreakdown(data) {
  const body = document.getElementById('breakdown-body');
  body.innerHTML = '';

  const keys = Object.keys(data.treatments)
    .filter((k) => data.zones.some((z) => z.treatment_id === k))
    .sort((a, b) => (a === 'none') - (b === 'none')); // 'none' always last

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
      '</div>' +
      (noSpray
        ? '<div class="tb-why">Stress explained by moisture-index anomaly / NDRE deficit &mdash; irrigation and fertility, not pests.</div>'
        : '');

    body.appendChild(group);
  }
}
