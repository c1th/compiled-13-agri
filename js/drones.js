// Drone operations page. Each drone is configured individually (origin,
// pesticide, tank volume). "Recommend assignments" maps treatable zones to
// drones (greedy nearest-first within tank capacity) and shows a static
// visualization: colored rings on assigned zones + per-drone manifests.
// The flight-path simulation itself is the swarm teammate's — see
// js/swarm-mount.js and README.md.

const DRONE_COLORS = ['#EC6B64', '#5AD4C8', '#D0A5E8', '#8FBF6F', '#F2D857', '#7FA8F5'];

let DRONE_DATA = null;
let drones = [];
let originPickIdx = null;
let lastAssignments = null;

function initDronesPage() {
  DRONE_DATA = (typeof FIELD !== 'undefined') ? FIELD : STUB;
  try {
    const savedPlan = sessionStorage.getItem('fieldloop_plan');
    if (savedPlan) DRONE_DATA = JSON.parse(savedPlan);
  } catch (_e) { /* keep FIELD */ }

  try { resetDronesPage(); } catch (err) {
    console.error('[FieldLoop] drones page failed to init:', err);
  }

  document.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'r' || e.key === 'R') resetDronesPage();
  });
}

function resetDronesPage() {
  const data = DRONE_DATA;
  lastAssignments = null;
  originPickIdx = null;

  document.getElementById('field-name').textContent = data.meta.name + ' · ' + data.meta.date;

  safeCall('map', () => { initFieldMap(data); renderDroneHomes(); });
  safeCall('legend', () => renderDroneLegend(data));
  safeCall('fleet', () => {
    drones = defaultFleet(data);
    renderDroneList();
  });
  safeCall('assignments', () => {
    document.getElementById('assignments-body').innerHTML =
      '<span class="procure-empty">Configure the fleet, then click &ldquo;Recommend assignments&rdquo;.</span>';
  });
  safeCall('swarm', () => initSwarmMount(data));

  setOriginHint('');
  document.getElementById('add-drone').onclick = addDrone;
  document.getElementById('recommend').onclick = recommendAssignments;
  document.getElementById('map-wrap').onclick = onMapClickForOrigin;
}

function safeCall(name, fn) {
  try { fn(); } catch (err) { console.error('[FieldLoop] drones/' + name + ' failed:', err); }
}

function treatableIds(data) {
  return Object.keys(data.treatments).filter((k) =>
    k !== 'none' && data.zones.some((z) => z.treatment_id === k));
}

function defaultFleet(data) {
  const ids = treatableIds(data);
  if (Array.isArray(data.fleet) && data.fleet.length) {
    return data.fleet.map((d, i) => ({
      id: d.id || 'DR-' + (i + 1),
      home: [d.home[0], d.home[1]],
      carries: ids.includes(d.carries) ? d.carries : ids[0],
      tank_gal: d.tank_gal || 6
    }));
  }
  return ids.slice(0, 2).map((tid, i) => ({
    id: 'DR-' + (i + 1),
    home: [0.04, 0.3 + i * 0.4],
    carries: tid,
    tank_gal: 6
  }));
}

function addDrone() {
  const ids = treatableIds(DRONE_DATA);
  drones.push({
    id: 'DR-' + (drones.length + 1),
    home: [0.04, 0.5],
    carries: ids[drones.length % ids.length],
    tank_gal: 6
  });
  renderDroneList();
  renderDroneHomes();
}

function droneColor(i) { return DRONE_COLORS[i % DRONE_COLORS.length]; }

function renderDroneList() {
  const list = document.getElementById('drone-list');
  list.innerHTML = '';
  const ids = treatableIds(DRONE_DATA);

  drones.forEach((d, i) => {
    const row = document.createElement('div');
    row.className = 'drone-row';
    const options = ids.map((tid) =>
      '<option value="' + tid + '"' + (tid === d.carries ? ' selected' : '') + '>' +
      DRONE_DATA.treatments[tid].name + '</option>').join('');
    row.innerHTML =
      '<span class="drone-chip" style="background:' + droneColor(i) + '"></span>' +
      '<span class="drone-id num">' + d.id + '</span>' +
      '<button class="btn drone-origin-btn" data-i="' + i + '">Set origin</button>' +
      '<span class="drone-origin num">(' + d.home[0].toFixed(2) + ', ' + d.home[1].toFixed(2) + ')</span>' +
      '<select class="inv-input drone-carries" data-i="' + i + '">' + options + '</select>' +
      '<input class="inv-input inv-num num drone-tank" data-i="' + i + '" type="number" step="0.5" min="1" value="' + d.tank_gal + '">' +
      '<span class="inv-unit">gal</span>' +
      '<button class="inv-remove" data-i="' + i + '" title="Remove">&times;</button>';
    list.appendChild(row);
  });

  list.querySelectorAll('.drone-origin-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      originPickIdx = Number(btn.dataset.i);
      setOriginHint('Click the map to place ' + drones[originPickIdx].id + '’s origin.');
    });
  });
  list.querySelectorAll('.drone-carries').forEach((sel) => {
    sel.addEventListener('change', () => { drones[Number(sel.dataset.i)].carries = sel.value; });
  });
  list.querySelectorAll('.drone-tank').forEach((input) => {
    input.addEventListener('change', () => {
      drones[Number(input.dataset.i)].tank_gal = Math.max(1, Number(input.value) || 6);
    });
  });
  list.querySelectorAll('.inv-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      drones.splice(Number(btn.dataset.i), 1);
      renderDroneList();
      renderDroneHomes();
    });
  });
}

function onMapClickForOrigin(evt) {
  if (originPickIdx === null) return;
  const wrap = document.getElementById('map-wrap');
  const rect = wrap.getBoundingClientRect();
  const x = Math.min(1, Math.max(0, (evt.clientX - rect.left) / rect.width));
  const y = Math.min(1, Math.max(0, (evt.clientY - rect.top) / rect.height));
  drones[originPickIdx].home = [Number(x.toFixed(3)), Number(y.toFixed(3))];
  originPickIdx = null;
  setOriginHint('');
  renderDroneList();
  renderDroneHomes();
}

function setOriginHint(text) {
  document.getElementById('origin-hint').textContent = text;
}

// Diamond markers at each drone's origin, in the drone's color.
function renderDroneHomes() {
  const wrap = document.getElementById('map-wrap');
  wrap.querySelectorAll('.drone-home').forEach((el) => el.remove());
  drones.forEach((d, i) => {
    const el = document.createElement('div');
    el.className = 'drone-home';
    el.style.left = (d.home[0] * 100) + '%';
    el.style.top = (d.home[1] * 100) + '%';
    el.style.background = droneColor(i);
    el.innerHTML = '<span class="drone-home-label num">' + d.id + '</span>';
    wrap.appendChild(el);
  });
}

// Greedy assignment: per drone, nearest matching zones until the tank runs out.
function recommendAssignments() {
  const data = DRONE_DATA;
  const assigned = new Set();
  const result = drones.map((d, i) => {
    let remaining = d.tank_gal;
    const zones = data.zones
      .filter((z) => z.treatment_id === d.carries && z.volume_gal > 0 && !assigned.has(z.id))
      .sort((a, b) => dist(d.home, a) - dist(d.home, b));
    const take = [];
    for (const z of zones) {
      if (z.volume_gal <= remaining) {
        take.push(z);
        assigned.add(z.id);
        remaining -= z.volume_gal;
      }
    }
    return { drone: d, color: droneColor(i), zones: take, used: d.tank_gal - remaining };
  });

  const unassigned = data.zones.filter((z) => z.treatment_id !== 'none' && z.volume_gal > 0 && !assigned.has(z.id));
  lastAssignments = { result, unassigned };
  renderAssignments();
  renderAssignmentRings();
  persistFleet();
}

// Write the configured roster back into the plan's `fleet` (frozen contract
// shape). The swarm module reads data.fleet, so this is what makes the
// hand-off real rather than an empty array.
function persistFleet() {
  DRONE_DATA.fleet = drones.map((d) => ({
    id: d.id,
    home: [d.home[0], d.home[1]],
    carries: d.carries,
    tank_gal: d.tank_gal
  }));
  try {
    sessionStorage.setItem('fieldloop_plan', JSON.stringify(DRONE_DATA));
  } catch (err) {
    console.warn('[FieldLoop] could not persist fleet:', err);
  }
}

function dist(home, zone) {
  const dx = home[0] - zone.x, dy = home[1] - zone.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function renderAssignments() {
  const body = document.getElementById('assignments-body');
  const { result, unassigned } = lastAssignments;
  body.innerHTML = '';

  for (const r of result) {
    const pct = Math.round((r.used / r.drone.tank_gal) * 100);
    const zoneList = r.zones.length
      ? r.zones.map((z) => '<span class="assign-zone num">' + z.id + ' &middot; ' + z.volume_gal.toFixed(1) + ' gal</span>').join('')
      : '<span class="procure-empty">No matching zones in range of this tank.</span>';
    const card = document.createElement('div');
    card.className = 'assign-card';
    card.innerHTML =
      '<div class="assign-head">' +
        '<span class="drone-chip" style="background:' + r.color + '"></span>' +
        '<span class="drone-id num">' + r.drone.id + '</span>' +
        '<span class="assign-product">' + DRONE_DATA.treatments[r.drone.carries].name + '</span>' +
        '<span class="assign-usage num">' + r.used.toFixed(1) + ' / ' + r.drone.tank_gal.toFixed(1) + ' gal</span>' +
      '</div>' +
      '<div class="util-bar"><div class="util-bar-fill" style="width:' + pct + '%; background:' + r.color + '"></div></div>' +
      '<div class="assign-zones">' + zoneList + '</div>';
    body.appendChild(card);
  }

  if (unassigned.length) {
    const warn = document.createElement('div');
    warn.className = 'assign-unassigned';
    warn.innerHTML = '<strong>' + unassigned.length + ' zone' + (unassigned.length === 1 ? '' : 's') +
      ' unassigned</strong> (tank capacity or no drone carries the product): ' +
      unassigned.map((z) => z.id).join(', ') + '. Add a drone or increase tank volume.';
    body.appendChild(warn);
  }
}

// Static visualization only: colored ring per assigned zone. No flight paths —
// the swarm sim owns those.
function renderAssignmentRings() {
  const wrap = document.getElementById('map-wrap');
  wrap.querySelectorAll('.assign-ring').forEach((el) => el.remove());
  for (const r of lastAssignments.result) {
    for (const z of r.zones) {
      const d = Math.round(18 + z.area_acres * 10) + 10;
      const ring = document.createElement('div');
      ring.className = 'assign-ring';
      ring.style.left = (z.x * 100) + '%';
      ring.style.top = (z.y * 100) + '%';
      ring.style.width = d + 'px';
      ring.style.height = d + 'px';
      ring.style.borderColor = r.color;
      wrap.appendChild(ring);
    }
  }
}

function renderDroneLegend(data) {
  const legend = document.getElementById('map-legend');
  legend.innerHTML = '';
  for (const key of Object.keys(data.treatments)) {
    const t = data.treatments[key];
    if (key !== 'none' && !data.zones.some((z) => z.treatment_id === key)) continue;
    const item = document.createElement('span');
    item.className = 'legend-item';
    const swatchClass = key === 'none' ? 'legend-swatch nospray' : 'legend-swatch';
    item.innerHTML = '<span class="' + swatchClass + '" style="' +
      (key === 'none' ? 'border-color:' + t.color : 'background:' + t.color) + '"></span>' + t.name;
    legend.appendChild(item);
  }
}
