// FieldLoop dashboard bootstrap. Every panel init is isolated in try/catch —
// one broken panel must never blank the page. DATA is either the analysis
// plan (sessionStorage), the mock FIELD, or the STUB fallback.

let DATA = (typeof FIELD !== 'undefined') ? FIELD : STUB;
try {
  const savedPlan = sessionStorage.getItem('fieldloop_plan');
  if (savedPlan) DATA = JSON.parse(savedPlan);
} catch (_e) { /* fall through to FIELD */ }

// Each entry re-runs on "R" (reset for a second demo pass).
const PANEL_INITS = [];

function registerPanel(name, fn) {
  PANEL_INITS.push({ name, fn });
  safeInit(name, fn);
}

function safeInit(name, fn) {
  try {
    fn(DATA);
  } catch (err) {
    console.error('[FieldLoop] panel "' + name + '" failed to init:', err);
  }
}

// Re-render the data-driven panels without tearing down the live map (which
// would throw away the user's drawn regions and map view).
function refreshDataPanels() {
  for (const p of PANEL_INITS) {
    if (p.name === 'map') {
      try { renderZonesOnMap(DATA); renderMapLegend(DATA); } catch (err) {
        console.error('[FieldLoop] map refresh failed:', err);
      }
    } else {
      safeInit(p.name, p.fn);
    }
  }
}

// Swap in a new analysis plan.
function setData(plan) {
  DATA = plan;
  refreshDataPanels();
}

// Drop the current plan but keep the drawn region — used when the region
// changes, so stale zones and acreage don't linger over new ground.
function clearPlan() {
  sessionStorage.removeItem('fieldloop_plan');
  DATA = emptyPlan(typeof getRegionBounds === 'function' ? getRegionBounds() : DATA.meta.bounds);
  refreshDataPanels();
}

function emptyPlan(bounds) {
  return {
    source: 'empty',
    meta: {
      name: 'Selected region',
      bounds,
      image: 'field.png',
      image_size: [1200, 800],
      date: new Date().toISOString().slice(0, 10)
    },
    summary: { total_acres: 0, flagged_acres: 0, pct_flagged: 0, pct_reduction: 0, dollars_saved: 0 },
    treatments: { none: { name: 'No treatment — irrigation issue', rate_gal_per_acre: 0, color: '#5A9BD4' } },
    zones: [],
    fleet: []
  };
}

function resetAllPanels() {
  sessionStorage.removeItem('fieldloop_plan');
  DATA = (typeof FIELD !== 'undefined') ? FIELD : STUB;
  // Drop drawn regions and fleet too, so "R" really is a clean second run.
  if (typeof resetRegions === 'function') resetRegions();
  if (typeof resetFleet === 'function') resetFleet();
  if (typeof clearDroneRoutes === 'function') clearDroneRoutes();
  for (const p of PANEL_INITS) safeInit(p.name, p.fn);
}

document.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'r' || e.key === 'R') resetAllPanels();
});

if (typeof initTraceDock === 'function') initTraceDock();

registerPanel('map', initMapPanel);
registerPanel('breakdown', initBreakdown);
registerPanel('analyze', initAnalyze);
registerPanel('impact', initImpact);
registerPanel('fleet', initFleet);
registerPanel('procure', initProcure);
