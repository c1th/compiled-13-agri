// FieldLoop app bootstrap. Every panel init is isolated in try/catch —
// one broken panel must never blank the page.

const DATA = (typeof FIELD !== 'undefined') ? FIELD : STUB;

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

function resetAllPanels() {
  for (const p of PANEL_INITS) safeInit(p.name, p.fn);
}

document.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'r' || e.key === 'R') resetAllPanels();
});

registerPanel('kpi', initKPI);
registerPanel('field-map', initFieldMap);
registerPanel('breakdown', initBreakdown);
registerPanel('agronomist', initAgronomist);
