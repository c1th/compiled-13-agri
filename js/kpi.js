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
