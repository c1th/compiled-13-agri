// Swarm route planning — pure logic, no DOM. Takes the same `data` shape
// every other panel gets (FIELD or STUB from data/zones.js / stub-zones.js)
// and returns a plan object other panels/teammates can render however they like.
//
// data.fleet is the frozen contract's drone roster: { id, home:[x,y], carries, tank_gal }.
// It has no battery/range field, so battery_km is synthesized here per drone
// (randomized unless a drone already carries one) — that's the piece this
// module actually adds on top of the contract.

function randRange(min, max) { return min + Math.random() * (max - min); }
function choice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function randomPerimeterPoint() {
  const side = Math.floor(Math.random() * 4);
  const t = Math.random();
  if (side === 0) return { x: t, y: 0 };
  if (side === 1) return { x: 1, y: t };
  if (side === 2) return { x: 1 - t, y: 1 };
  return { x: 0, y: 1 - t };
}

// Real fleet + synthesized battery. Never overwrites a field the contract
// already provides — only fills in what's missing (battery_km).
function loadFleet(data) {
  return data.fleet.map(d => ({
    id: d.id,
    carries: d.carries,
    tank_gal: d.tank_gal,
    battery_km: d.battery_km != null ? d.battery_km : +randRange(5, 20).toFixed(2),
    x: d.home[0],
    y: d.home[1]
  }));
}

// For stress-testing with more drones than the fixed roster provides.
// treatment types are pulled from data.treatments (excluding "none", which
// means "no spray needed" rather than a real product).
function generateSyntheticFleet(n, data) {
  const types = Object.keys(data.treatments).filter(k => k !== "none");
  return Array.from({ length: n }, (_, i) => {
    const p = randomPerimeterPoint();
    return {
      id: "SYN-" + (i + 1),
      carries: choice(types),
      tank_gal: +randRange(3, 8).toFixed(2),
      battery_km: +randRange(5, 20).toFixed(2),
      x: p.x, y: p.y
    };
  });
}

function makeDistanceKm(bounds) {
  const [lonW, latS, lonE, latN] = bounds;
  const kmPerDegLat = 111.0;
  const kmPerDegLon = 111.32 * Math.cos((latS + latN) / 2 * Math.PI / 180);
  const spanKmX = (lonE - lonW) * kmPerDegLon;
  const spanKmY = (latN - latS) * kmPerDegLat;
  return function distanceKm(a, b) {
    const dx = (a.x - b.x) * spanKmX;
    const dy = (a.y - b.y) * spanKmY;
    return Math.hypot(dx, dy);
  };
}

function cloneWorkingSet(fleet, zones) {
  return {
    drones: fleet.map(d => ({ ...d, remainingGal: d.tank_gal, remainingKm: d.battery_km, cursor: { x: d.x, y: d.y }, path: [] })),
    zones: zones.filter(z => z.treatment_id !== "none").map(z => ({ ...z, assigned: false }))
  };
}

function eligible(drone, zone, distanceKm) {
  if (drone.carries !== zone.treatment_id) return false;
  if (zone.volume_gal > drone.remainingGal) return false;
  const legKm = distanceKm(drone.cursor, zone);
  if (legKm > drone.remainingKm) return false;
  return true;
}

function assign(drone, zone, distanceKm) {
  const legKm = distanceKm(drone.cursor, zone);
  drone.path.push(zone);
  drone.remainingGal -= zone.volume_gal;
  drone.remainingKm -= legKm;
  drone.cursor = { x: zone.x, y: zone.y };
  zone.assigned = true;
}

// Strategy 1: global greedy nearest-pair. Minimizes total travel; can let a
// low-priority zone "steal" a drone from a high-priority one just because
// it's closer.
function strategyGreedyNearest(drones, zones, distanceKm) {
  let progress = true;
  while (progress) {
    progress = false;
    let best = null;
    for (const d of drones) {
      for (const z of zones) {
        if (z.assigned) continue;
        if (!eligible(d, z, distanceKm)) continue;
        const dist = distanceKm(d.cursor, z);
        if (!best || dist < best.dist) best = { d, z, dist };
      }
    }
    if (best) { assign(best.d, best.z, distanceKm); progress = true; }
  }
}

// Strategy 2: priority-first. Zones are already ranked by the upstream
// pipeline (data.zones[].priority, 1 = most urgent) — honor that ranking
// instead of re-deriving urgency from severity ourselves. Guarantees the
// most urgent zones are claimed before any drone runs dry.
function strategyPriorityFirst(drones, zones, distanceKm) {
  const ordered = zones.slice().sort((a, b) => a.priority - b.priority);
  for (const z of ordered) {
    if (z.assigned) continue;
    let best = null;
    for (const d of drones) {
      if (!eligible(d, z, distanceKm)) continue;
      const dist = distanceKm(d.cursor, z);
      if (!best || dist < best.dist) best = { d, dist };
    }
    if (best) assign(best.d, z, distanceKm);
  }
}

// Strategy 3: spatial partition. Each zone is first claimed by whichever
// drone started (home position) closest to it, then each drone visits its
// own claims in nearest-neighbor order. Keeps drones in their own patch of
// field; overflow (tank/battery exceeded) falls back to greedy assignment.
function strategyPartition(drones, zones, distanceKm) {
  const launch = drones.map(d => ({ x: d.x, y: d.y }));
  const byDrone = drones.map(() => []);
  for (const z of zones) {
    let bestIdx = -1, bestDist = Infinity;
    drones.forEach((d, i) => {
      if (d.carries !== z.treatment_id) return;
      const dist = distanceKm(launch[i], z);
      if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    });
    if (bestIdx >= 0) byDrone[bestIdx].push(z);
  }
  drones.forEach((d, i) => {
    const remaining = byDrone[i].slice();
    while (remaining.length) {
      let bestIdx = -1, bestDist = Infinity;
      remaining.forEach((z, j) => {
        if (!eligible(d, z, distanceKm)) return;
        const dist = distanceKm(d.cursor, z);
        if (dist < bestDist) { bestDist = dist; bestIdx = j; }
      });
      if (bestIdx < 0) break;
      assign(d, remaining[bestIdx], distanceKm);
      remaining.splice(bestIdx, 1);
    }
  });
  strategyGreedyNearest(drones, zones, distanceKm); // overflow fallback
}

const STRATEGIES = {
  "greedy-nearest": strategyGreedyNearest,
  "priority-first": strategyPriorityFirst,
  "partition-nearest": strategyPartition
};

function scoreResult(drones, zones) {
  const treated = zones.filter(z => z.assigned);
  const treatedAcres = treated.reduce((s, z) => s + z.area_acres, 0);
  const severityWeightedAcres = treated.reduce((s, z) => s + z.area_acres * z.severity, 0);
  const totalDistanceKm = drones.reduce((s, d) => s + (d.battery_km - d.remainingKm), 0);
  const totalGalUsed = drones.reduce((s, d) => s + (d.tank_gal - d.remainingGal), 0);
  const uncovered = zones.filter(z => !z.assigned);
  const score = severityWeightedAcres - 0.05 * totalDistanceKm - 0.5 * uncovered.length;
  return {
    treatedCount: treated.length,
    treatableCount: zones.length,
    treatedAcres: +treatedAcres.toFixed(2),
    totalGalUsed: +totalGalUsed.toFixed(2),
    severityWeightedAcres: +severityWeightedAcres.toFixed(2),
    totalDistanceKm: +totalDistanceKm.toFixed(2),
    uncoveredCount: uncovered.length,
    pctCovered: zones.length ? +((treated.length / zones.length) * 100).toFixed(1) : 100,
    score: +score.toFixed(3)
  };
}

function classifyUncovered(zones, drones) {
  const activeTypes = new Set(drones.map(d => d.carries));
  return zones.filter(z => !z.assigned).map(z => ({
    zone_id: z.id,
    reason: activeTypes.has(z.treatment_id) ? "fleet_exhausted" : "no_drone_carries_treatment"
  }));
}

// Main entry point. Runs all strategies against identical cloned state,
// picks the highest-scoring one, and returns a plain object ready to hand
// to another panel/teammate — no DOM, no globals mutated.
function planSwarmRoutes(data, fleetOverride) {
  const fleet = fleetOverride || loadFleet(data);
  const distanceKm = makeDistanceKm(data.meta.bounds);
  const runs = {};
  for (const [name, fn] of Object.entries(STRATEGIES)) {
    const working = cloneWorkingSet(fleet, data.zones);
    fn(working.drones, working.zones, distanceKm);
    runs[name] = working;
  }
  const alternatives = {};
  for (const name of Object.keys(runs)) alternatives[name] = scoreResult(runs[name].drones, runs[name].zones);
  const bestName = Object.entries(alternatives).sort((a, b) => b[1].score - a[1].score)[0][0];
  const best = runs[bestName];

  return {
    strategy: bestName,
    generated_at: new Date().toISOString(),
    field: data.meta.name,
    drones: best.drones.map(d => ({
      id: d.id,
      carries: d.carries,
      tank_gal: d.tank_gal,
      gal_used: +(d.tank_gal - d.remainingGal).toFixed(2),
      gal_remaining: +d.remainingGal.toFixed(2),
      battery_km: d.battery_km,
      battery_used_km: +(d.battery_km - d.remainingKm).toFixed(2),
      battery_remaining_km: +d.remainingKm.toFixed(2),
      distance_km: +(d.battery_km - d.remainingKm).toFixed(2),
      route: d.path.map(z => ({
        zone_id: z.id, x: z.x, y: z.y, lon: z.lon, lat: z.lat,
        severity: z.severity, area_acres: z.area_acres, volume_gal: z.volume_gal, priority: z.priority
      }))
    })),
    uncovered: classifyUncovered(best.zones, best.drones),
    metrics: alternatives[bestName],
    alternatives
  };
}
