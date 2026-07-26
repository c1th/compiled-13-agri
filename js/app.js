// FieldLoop dashboard bootstrap. Every panel init is isolated in try/catch —
// one broken panel must never blank the page. DATA is either the analysis
// plan (sessionStorage), the mock FIELD, or the STUB fallback.

let DATA = (typeof FIELD !== 'undefined') ? FIELD : STUB;
try {
  const savedPlan = sessionStorage.getItem('fieldloop_plan');
  if (savedPlan) DATA = JSON.parse(savedPlan);
} catch (_e) { /* fall through to FIELD */ }

// Each entry re-runs on "R" (reset for a second demo pass) and on setData().
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

// Swap in a new analysis plan and re-render everything data-driven.
function setData(plan) {
  DATA = plan;
  for (const p of PANEL_INITS) {
    if (p.name === 'geemap') {
      // keep the live map; just refresh its zones + legend
      try { renderZonesOnMap(DATA); renderMapLegend(DATA); } catch (err) { console.error(err); }
    } else {
      safeInit(p.name, p.fn);
    }
  }
}

function resetAllPanels() {
  sessionStorage.removeItem('fieldloop_plan');
  DATA = (typeof FIELD !== 'undefined') ? FIELD : STUB;
  for (const p of PANEL_INITS) safeInit(p.name, p.fn);
}

document.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'r' || e.key === 'R') resetAllPanels();
});

registerPanel('kpi', initKPI);
registerPanel('geemap', initGeeMap);
registerPanel('breakdown', initBreakdown);
registerPanel('inventory', initInventory);
registerPanel('analyze', initAnalyze);
registerPanel('procure', initProcure);
