// Analysis flow: drawn region -> POST /api/analyze (Claude on the server) ->
// FIELD-shaped plan prescribing the optimal biological per zone. On any
// failure a deterministic local mock plan is generated after 900ms so the
// demo never dead-ends. The plan feeds every panel and hands off to the drone
// page via sessionStorage.

function initAnalyze() {
  const btn = document.getElementById('run-analysis');
  const cta = document.getElementById('drone-cta');
  btn.onclick = runAnalysis;
  const existing = loadPlan();
  if (existing) {
    setAnalyzeStatus('Plan loaded (' + (existing.source === 'claude' ? 'Claude analysis' : 'mock analysis') + ') — ' + existing.zones.length + ' zones.');
    cta.hidden = false;
  } else {
    setAnalyzeStatus('Draw a region on the map, then run the analysis.');
    cta.hidden = true;
  }
}

async function runAnalysis() {
  const btn = document.getElementById('run-analysis');
  const bounds = getRegionBounds();
  const acres = regionAcres();

  btn.disabled = true;
  btn.textContent = 'Analyzing region…';
  setAnalyzeStatus('Diagnosing stress zones and prescribing treatments…');

  let plan = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bounds, total_acres: acres }),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error('analyze endpoint responded ' + res.status);
    plan = await res.json();
  } catch (err) {
    console.warn('[FieldLoop] live analysis failed, using local mock:', err);
    await new Promise((resolve) => setTimeout(resolve, 900));
    plan = mockAnalyze(bounds, acres);
  }

  sessionStorage.setItem('fieldloop_plan', JSON.stringify(plan));
  setData(plan);

  const products = Object.keys(plan.treatments).filter((k) => k !== 'none').length;
  setAnalyzeStatus((plan.source === 'claude' ? 'Analysis complete (Claude) — ' : 'Analysis complete (offline mock) — ') +
    plan.zones.length + ' zones, ' + products + ' product' + (products === 1 ? '' : 's') + ' prescribed.');
  document.getElementById('drone-cta').hidden = false;

  btn.disabled = false;
  btn.textContent = 'Run analysis';
}

function loadPlan() {
  try {
    const raw = sessionStorage.getItem('fieldloop_plan');
    return raw ? JSON.parse(raw) : null;
  } catch (_e) { return null; }
}

function setAnalyzeStatus(text) {
  const el = document.getElementById('analyze-status');
  if (el) el.textContent = text;
}

// Deterministic mock plan — seeded by the bounds so re-runs are stable.
// Prescribes from the same catalog the server uses; quantities are whatever
// the agronomy calls for, never capped by stock.
function mockAnalyze(bounds, totalAcres) {
  const [w, s, e, n] = bounds;
  let seed = Math.abs(Math.round((w + s + e + n) * 1e4)) || 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF;
    return seed / 0x7FFFFFFF;
  };

  const catalog = TREATMENT_CATALOG;
  const zoneCount = 13;
  const noSprayCount = 3;
  const zones = [];

  for (let i = 0; i < zoneCount; i++) {
    const x = 0.07 + rand() * 0.86;
    const y = 0.07 + rand() * 0.86;
    const noSpray = i >= zoneCount - noSprayCount;
    const severity = 0.45 + rand() * 0.5;
    const area = 0.7 + rand() * 1.7;
    const diagnosis = noSpray
      ? (rand() > 0.4 ? 'water_stress' : 'nitrogen_deficiency')
      : 'biotic_stress';
    // Rotate through the first three products so the map shows a real mix.
    const product = catalog[i % 3];
    zones.push({
      id: 'Z' + String(i + 1).padStart(2, '0'),
      x: Number(x.toFixed(3)),
      y: Number(y.toFixed(3)),
      lon: Number((w + x * (e - w)).toFixed(5)),
      lat: Number((n - y * (n - s)).toFixed(5)),
      severity: Number(severity.toFixed(2)),
      area_acres: Number(area.toFixed(1)),
      ndvi_anomaly: Number((-0.08 - rand() * 0.16).toFixed(2)),
      ndmi_anomaly: Number((diagnosis === 'water_stress' ? -0.15 - rand() * 0.1 : -0.02 + rand() * 0.05).toFixed(2)),
      diagnosis,
      treatment_id: noSpray ? 'none' : product.id,
      volume_gal: 0,
      priority: 0
    });
  }

  // Scale treated area to ~9% of the region, then derive volumes at the
  // optimal rate (heavier pressure gets a heavier rate).
  const treated = zones.filter((z) => z.treatment_id !== 'none');
  const scale = (totalAcres * 0.09) / treated.reduce((sum, z) => sum + z.area_acres, 0);
  const rates = Object.fromEntries(catalog.map((p) => [p.id, p.rate_gal_per_acre]));
  for (const z of treated) {
    z.area_acres = Number(Math.max(0.5, z.area_acres * scale).toFixed(1));
    const rate = (rates[z.treatment_id] || 1) * (z.severity > 0.8 ? 1.25 : 1);
    z.volume_gal = Number((z.area_acres * rate).toFixed(2));
  }
  zones.slice().sort((a, b) => b.severity - a.severity)
    .forEach((z, i) => { z.priority = i + 1; });

  const flagged = Number(treated.reduce((sum, z) => sum + z.area_acres, 0).toFixed(1));
  const pctFlagged = Number((flagged / totalAcres * 100).toFixed(1));

  const used = new Set(zones.map((z) => z.treatment_id));
  const treatments = {};
  for (const p of catalog) {
    if (!used.has(p.id)) continue;
    treatments[p.id] = { name: p.name, rate_gal_per_acre: p.rate_gal_per_acre, color: p.color };
  }
  treatments.none = { name: 'No treatment — irrigation issue', rate_gal_per_acre: 0, color: '#5A9BD4' };

  return {
    source: 'mock',
    meta: {
      name: 'Selected region',
      bounds,
      image: 'field.png',
      image_size: [1200, 800],
      date: new Date().toISOString().slice(0, 10)
    },
    summary: {
      total_acres: Math.round(totalAcres),
      flagged_acres: flagged,
      pct_flagged: pctFlagged,
      pct_reduction: Math.round(100 - pctFlagged),
      dollars_saved: Math.round((totalAcres - flagged) * 34)
    },
    treatments,
    zones,
    fleet: []
  };
}
