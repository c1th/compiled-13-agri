// Drone fleet configuration and route planning, on the dashboard.
//
// Each drone carries exactly one product, launches from a point the grower
// picks on the map, and is bounded by tank volume and battery range. Routing
// itself belongs to js/swarm.js (planSwarmRoutes) — this file only collects
// the inputs, hands them over, and renders what comes back.

let fleet = [];
let fleetSeq = 0;
let lastRoutes = null;

function initFleet(data) {
  const saved = sessionStorage.getItem('fieldloop_fleet');
  if (!fleet.length && saved) {
    try { fleet = JSON.parse(saved); fleetSeq = fleet.length; } catch (_e) { fleet = []; }
  }
  if (!fleet.length) randomizeFleet(data, true);

  renderFleet(data);
  renderRoutes(lastRoutes, data);

  const addBtn = document.getElementById('add-drone');
  const randBtn = document.getElementById('randomize-fleet');
  const planBtn = document.getElementById('plan-routes');
  if (addBtn) addBtn.onclick = () => { addDrone(data); renderFleet(data); };
  if (randBtn) randBtn.onclick = () => { randomizeFleet(data); renderFleet(data); };
  if (planBtn) planBtn.onclick = () => planRoutes(data);
}

function treatableProducts(data) {
  return Object.keys(data.treatments || {})
    .filter((k) => k !== 'none' && data.zones.some((z) => z.treatment_id === k));
}

function addDrone(data, preset) {
  const products = treatableProducts(data);
  fleetSeq += 1;
  fleet.push(Object.assign({
    id: 'D' + fleetSeq,
    carries: products[(fleetSeq - 1) % Math.max(1, products.length)] || 'none',
    tank_gal: 5,
    battery_km: 12,
    x: 0.5,
    y: 0.5
  }, preset || {}));
  saveFleet();
}

// Demo fleet: launch points spread around the field edge, tanks and batteries
// varied, products spread across whatever the plan actually prescribes.
function randomizeFleet(data, quiet) {
  const products = treatableProducts(data);
  const count = Math.max(3, Math.min(6, products.length + 2));
  fleet = [];
  fleetSeq = 0;
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const edge = perimeterPoint(t + Math.random() * 0.06);
    fleetSeq += 1;
    fleet.push({
      id: 'D' + fleetSeq,
      carries: products.length ? products[i % products.length] : 'none',
      tank_gal: Number((3 + Math.random() * 5).toFixed(1)),
      battery_km: Number((8 + Math.random() * 14).toFixed(1)),
      x: edge.x,
      y: edge.y
    });
  }
  saveFleet();
  if (!quiet) lastRoutes = null;
}

// A point on the field perimeter at fraction t around it.
function perimeterPoint(t) {
  const u = ((t % 1) + 1) % 1;
  if (u < 0.25) return { x: u * 4, y: 0.02 };
  if (u < 0.5) return { x: 0.98, y: (u - 0.25) * 4 };
  if (u < 0.75) return { x: 1 - (u - 0.5) * 4, y: 0.98 };
  return { x: 0.02, y: 1 - (u - 0.75) * 4 };
}

function removeDrone(id, data) {
  fleet = fleet.filter((d) => d.id !== id);
  saveFleet();
  renderFleet(data);
}

function saveFleet() {
  sessionStorage.setItem('fieldloop_fleet', JSON.stringify(fleet));
}

function resetFleet() {
  fleet = [];
  fleetSeq = 0;
  lastRoutes = null;
  sessionStorage.removeItem('fieldloop_fleet');
}

// ---------- fleet editor ----------

function renderFleet(data) {
  const body = document.getElementById('fleet-body');
  if (!body) return;
  const products = treatableProducts(data);

  if (!products.length) {
    body.innerHTML = '<span class="procure-empty">Run the analysis first — drones carry the products it prescribes.</span>';
    return;
  }

  body.innerHTML =
    '<div class="fleet-head-row">' +
      '<span>Drone</span><span>Carries</span><span>Tank</span><span>Battery</span><span>Launch point</span><span></span>' +
    '</div>' +
    fleet.map((d) => droneRowHtml(d, data, products)).join('');

  body.querySelectorAll('[data-field]').forEach((input) => {
    input.addEventListener('change', () => {
      const drone = fleet.find((x) => x.id === input.dataset.id);
      if (!drone) return;
      const f = input.dataset.field;
      drone[f] = f === 'carries' ? input.value : Math.max(0.1, Number(input.value) || 0);
      saveFleet();
    });
  });
  body.querySelectorAll('.pick-origin').forEach((btn) => {
    btn.addEventListener('click', () => pickOrigin(btn.dataset.id, data));
  });
  body.querySelectorAll('.drone-remove').forEach((btn) => {
    btn.addEventListener('click', () => removeDrone(btn.dataset.id, data));
  });
}

function droneRowHtml(d, data, products) {
  const t = data.treatments[d.carries];
  const color = t ? t.color : '#8B98A5';
  return '<div class="fleet-row">' +
    '<span class="drone-id"><span class="legend-swatch" style="background:' + color + '"></span>' + d.id + '</span>' +
    '<select class="inv-input" data-id="' + d.id + '" data-field="carries">' +
      products.map((k) =>
        '<option value="' + k + '"' + (k === d.carries ? ' selected' : '') + '>' +
        data.treatments[k].name + '</option>').join('') +
    '</select>' +
    '<span class="fleet-num"><input class="inv-input inv-num num" type="number" min="0.5" step="0.5" ' +
      'data-id="' + d.id + '" data-field="tank_gal" value="' + d.tank_gal + '"><span class="inv-unit">gal</span></span>' +
    '<span class="fleet-num"><input class="inv-input inv-num num" type="number" min="1" step="0.5" ' +
      'data-id="' + d.id + '" data-field="battery_km" value="' + d.battery_km + '"><span class="inv-unit">km</span></span>' +
    '<button class="btn pick-origin" data-id="' + d.id + '">' +
      'Set on map <span class="num origin-xy">' + d.x.toFixed(2) + ', ' + d.y.toFixed(2) + '</span></button>' +
    '<button class="inv-remove drone-remove" data-id="' + d.id + '" title="Remove drone">&times;</button>' +
  '</div>';
}

function pickOrigin(id, data) {
  if (typeof armOriginPick !== 'function') return;
  armOriginPick((lat, lon) => {
    const drone = fleet.find((x) => x.id === id);
    if (!drone) return;
    const pos = latLngToField(lat, lon);
    drone.x = pos.x;
    drone.y = pos.y;
    saveFleet();
    renderFleet(data);
  });
}

// ---------- route planning ----------

async function planRoutes(data) {
  const btn = document.getElementById('plan-routes');
  if (typeof planSwarmRoutes !== 'function') {
    return;
  }
  const treated = data.zones.filter((z) => z.treatment_id !== 'none');
  if (!treated.length) {
    return;
  }
  if (!fleet.length) {
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Planning…';

  traceReset('Route optimisation started');
  await traceBeat('source', 'Fleet manifest loaded',
    fleet.length + ' airframes · ' +
    fleet.reduce((s, d) => s + d.tank_gal, 0).toFixed(1) + ' gal combined payload · ' +
    fleet.reduce((s, d) => s + d.battery_km, 0).toFixed(1) + ' km combined endurance');
  await traceBeat('source', 'Target set resolved',
    treated.length + ' treatable zones · ' +
    treated.reduce((s, z) => s + z.volume_gal, 0).toFixed(1) + ' gal total demand');
  await traceBeat('compute', 'Haversine cost matrix built',
    'great-circle distances over WGS84 · normalised field coordinates → km');
  await traceBeat('compute', 'Evaluating routing strategies',
    'greedy-nearest · priority-first · spatial partition · payload and endurance constrained');

  let result = null;
  try {
    result = planSwarmRoutes(Object.assign({}, data, { fleet: fleet.slice() }), fleet.slice());
  } catch (err) {
    console.error('[FieldLoop] routing failed:', err);
    traceStep('warn', 'Routing failed', err.message || 'unknown error');
    btn.disabled = false;
    btn.textContent = 'Calculate drone routes';
    return;
  }

  const m = result.metrics || {};
  await traceBeat('check', 'Strategy selected: ' + result.strategy,
    'best of ' + Object.keys(result.alternatives || {}).length + ' candidates by coverage-per-km score');
  await traceBeat('compute', 'Flight paths resolved',
    result.drones.reduce((s, d) => s + d.route.length, 0) + ' waypoints · ' +
    result.drones.reduce((s, d) => s + d.distance_km, 0).toFixed(1) + ' km total flown');

  lastRoutes = result;
  renderRoutes(result, data);
  if (typeof drawDroneRoutes === 'function') drawDroneRoutes(result);

  const covered = result.drones.reduce((s, d) => s + d.route.length, 0);
  traceDone(covered + ' of ' + treated.length + ' zones assigned · strategy ' + result.strategy);

  btn.disabled = false;
  btn.textContent = 'Recalculate routes';
}

function renderRoutes(result, data) {
  const body = document.getElementById('routes-body');
  if (!body) return;
  if (!result) {
    body.innerHTML = '<span class="procure-empty">Configure the fleet, then calculate routes.</span>';
    return;
  }

  const palette = (typeof SWARM_COLORS !== 'undefined' && SWARM_COLORS.length)
    ? SWARM_COLORS
    : ['#5AD4C8', '#EC6B64', '#D0A5E8', '#8FBF6F', '#F2D857', '#7FA8F5'];

  const cards = result.drones.map((d, i) => {
    const color = palette[i % palette.length];
    const t = data.treatments[d.carries];
    const tankPct = Math.min(100, Math.round((d.gal_used / d.tank_gal) * 100));
    const battPct = Math.min(100, Math.round((d.battery_used_km / d.battery_km) * 100));
    return '<div class="assign-card">' +
      '<div class="assign-head">' +
        '<span class="drone-chip" style="background:' + color + '"></span>' +
        '<span class="drone-id">' + d.id + '</span>' +
        '<span class="assign-product">' + (t ? t.name : d.carries) + '</span>' +
        '<span class="assign-usage num">' + d.route.length + ' stops</span>' +
      '</div>' +
      meterHtml('Payload', d.gal_used.toFixed(2) + ' / ' + d.tank_gal + ' gal', tankPct, color) +
      meterHtml('Battery', d.battery_used_km.toFixed(1) + ' / ' + d.battery_km + ' km', battPct, color) +
      '<div class="assign-zones">' +
        (d.route.length
          ? d.route.map((s, idx) =>
              '<span class="assign-zone"><span class="num">' + (idx + 1) + '</span> ' + s.zone_id + '</span>').join('')
          : '<span class="assign-usage">Idle — no zones assigned</span>') +
      '</div>' +
    '</div>';
  }).join('');

  const un = result.uncovered || {};
  const unList = [].concat(un.out_of_range || [], un.insufficient_payload || [], un.unassigned || []);
  const uncovered = unList.length
    ? '<div class="assign-unassigned"><strong>' + unList.length + ' zone' +
      (unList.length === 1 ? '' : 's') + ' not covered</strong> — ' +
      'add a drone, a bigger tank, or more battery range to reach them.</div>'
    : '';

  const m = result.metrics || {};
  body.innerHTML =
    '<div class="routes-summary num">' +
      'Strategy <strong>' + result.strategy + '</strong>' +
      ' · ' + result.drones.reduce((s, d) => s + d.distance_km, 0).toFixed(1) + ' km flown' +
      ' · ' + result.drones.reduce((s, d) => s + d.gal_used, 0).toFixed(1) + ' gal applied' +
      (m.coverage != null ? ' · ' + Math.round(m.coverage * 100) + '% coverage' : '') +
    '</div>' +
    '<div class="assignments-body">' + cards + uncovered + '</div>';
}

function meterHtml(label, value, pct, color) {
  return '<div class="meter-row">' +
    '<span class="meter-label">' + label + '</span>' +
    '<span class="meter-value num">' + value + '</span>' +
    '<span class="util-bar"><span class="util-bar-fill" style="width:' + pct + '%;background:' + color + '"></span></span>' +
  '</div>';
}

