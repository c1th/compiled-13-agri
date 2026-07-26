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
  const regionList = getRegions();

  btn.disabled = true;
  btn.textContent = 'Analyzing…';

  lastFallbackReason = null;
  const parts = [];
  for (let i = 0; i < regionList.length; i++) {
    const region = regionList[i];
    // Earth Engine already measured this ground and found nothing growing —
    // don't ask the analysis layer to invent crops on it.
    if (region.probe && region.probe.plantable === false) {
      parts.push({ region, plan: barrenPlan(region) });
      continue;
    }
    setAnalyzeStatus('Surveying ' + region.label + ' (' + (i + 1) + ' of ' + regionList.length + ')…');
    parts.push({ region, plan: await analyzeRegion(region) });
  }

  const plan = mergePlans(parts, getRegionBounds());
  sessionStorage.setItem('fieldloop_plan', JSON.stringify(plan));
  setData(plan);
  reportAnalysis(plan, parts);
  document.getElementById('drone-cta').hidden = plan.zones.length === 0;

  btn.disabled = false;
  btn.textContent = 'Run analysis';
}

// A region Earth Engine measured as having no crop canopy: no zones, and the
// reason carried through so the UI can explain itself.
function barrenPlan(region) {
  return {
    source: 'earth-engine',
    region_assessment: {
      land_cover: region.probe.cover,
      plantable: false,
      note: region.label + ': ' + region.probe.note
    },
    summary: { total_acres: 0, flagged_acres: 0, pct_flagged: 0, pct_reduction: 0, dollars_saved: 0 },
    treatments: {},
    zones: []
  };
}

// One region → one plan. Falls back to the local mock so a failure in one
// region never sinks the whole survey.
async function analyzeRegion(region) {
  const acres = acresOf(region.bounds);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bounds: region.bounds, total_acres: acres }),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) {
      let reason = 'analyze endpoint responded ' + res.status;
      try {
        const body = await res.json();
        if (body && body.reason) reason = body.reason;
      } catch (_e) { /* keep the status-code reason */ }
      throw new Error(reason);
    }
    return await res.json();
  } catch (err) {
    console.warn('[FieldLoop] live analysis failed for ' + region.label + ', using local mock:', err);
    lastFallbackReason = err.message || 'analysis unavailable';
    await new Promise((resolve) => setTimeout(resolve, 900));
    return mockAnalyze(region.bounds, acres);
  }
}

// Why the last run fell back to the mock, so the UI can say so plainly.
let lastFallbackReason = null;

// Combine per-region plans into one FIELD-shaped plan. Zone x/y are recomputed
// against the union extent so the frozen contract still holds downstream
// (0..1, origin top-left) no matter how many regions were surveyed.
function mergePlans(parts, union) {
  const [w, s, e, n] = union;
  const zones = [];
  const treatments = {
    none: { name: 'No treatment — irrigation issue', rate_gal_per_acre: 0, color: '#5A9BD4' }
  };
  let totalAcres = 0;
  let anyClaude = false;

  for (const part of parts) {
    const plan = part.plan;
    totalAcres += acresOf(part.region.bounds);
    if (plan.source === 'claude') anyClaude = true;
    for (const key of Object.keys(plan.treatments || {})) {
      if (key !== 'none') treatments[key] = plan.treatments[key];
    }
    for (const z of (plan.zones || [])) {
      const zone = Object.assign({}, z);
      zone.id = parts.length > 1 ? part.region.label + '-' + z.id : z.id;
      zone.region_id = part.region.id;
      zone.x = e === w ? 0.5 : (z.lon - w) / (e - w);
      zone.y = n === s ? 0.5 : (n - z.lat) / (n - s);
      zones.push(zone);
    }
  }

  // Global priority ordering across every region.
  zones.slice().sort((a, b) => b.severity - a.severity)
    .forEach((z, i) => { z.priority = i + 1; });

  const flagged = Number(zones
    .filter((z) => z.treatment_id !== 'none')
    .reduce((sum, z) => sum + z.area_acres, 0).toFixed(1));
  const pctFlagged = totalAcres > 0 ? Number((flagged / totalAcres * 100).toFixed(1)) : 0;

  // Drop products no surviving zone actually uses.
  const used = new Set(zones.map((z) => z.treatment_id));
  for (const key of Object.keys(treatments)) {
    if (key !== 'none' && !used.has(key)) delete treatments[key];
  }

  return {
    source: anyClaude ? 'claude' : 'mock',
    regions: parts.map((p) => ({
      id: p.region.id,
      label: p.region.label,
      bounds: p.region.bounds,
      acres: Math.round(acresOf(p.region.bounds)),
      assessment: p.plan.region_assessment || null,
      zone_count: (p.plan.zones || []).length
    })),
    meta: {
      name: parts.length > 1 ? parts.length + ' regions' : 'Selected region',
      bounds: union,
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

function reportAnalysis(plan, parts) {
  const skipped = (plan.regions || []).filter((r) => r.zone_count === 0);
  const products = Object.keys(plan.treatments).filter((k) => k !== 'none').length;
  const src = plan.source === 'claude' ? 'Claude' : 'offline mock';

  if (!plan.zones.length) {
    const why = skipped.map((r) => r.assessment && r.assessment.note).filter(Boolean)[0];
    setAnalyzeStatus(why || 'No plantable crop detected in the selected area — nothing to treat.');
    return;
  }

  let msg = 'Surveyed ' + parts.length + (parts.length === 1 ? ' region' : ' regions') +
    ' (' + src + ') — ' + plan.zones.length + ' zones, ' +
    products + ' product' + (products === 1 ? '' : 's') + ' prescribed.';
  if (lastFallbackReason) {
    msg += ' Live analysis unavailable (' + lastFallbackReason + '), so this is simulated data.';
  }
  if (skipped.length) {
    msg += ' ' + skipped.map((r) => r.label).join(', ') +
      (skipped.length === 1 ? ' had' : ' had') + ' no plantable crop and was skipped.';
  }
  setAnalyzeStatus(msg);
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
