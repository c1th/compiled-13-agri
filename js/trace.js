// System console — one append-only output window for everything the system
// does. The zone/pesticide analysis and the drone route optimisation both
// write here, in order, and nothing is cleared between runs; each run just
// gets a header.
//
// It is docked to the bottom of the viewport like a terminal, so it stays
// visible while the grower scrolls through the map, plan and fleet above it.
//
// Every line corresponds to real work: imagery actually read, indices actually
// computed, the catalog actually sent, routing actually solved, plus the
// model's own streamed reasoning. The pacing is deliberate (see tracePause) —
// the work completes faster than anyone can read it.

const TRACE_KINDS = {
  source:  { tag: 'SOURCE',  cls: 'src' },   // external data being read
  compute: { tag: 'COMPUTE', cls: 'cmp' },   // maths done locally
  model:   { tag: 'MODEL',   cls: 'mdl' },   // the LLM call
  check:   { tag: 'RESULT',  cls: 'chk' },   // a conclusion reached
  warn:    { tag: 'NOTE',    cls: 'wrn' }
};

let traceEl = null;
let thinkingEl = null;
let traceStart = 0;
let traceRunSeq = 0;
let traceCollapsed = false;

function traceLogEl() {
  if (!traceEl) traceEl = document.getElementById('trace-log');
  return traceEl;
}

function traceOpen() {
  const dock = document.getElementById('trace-dock');
  if (dock && dock.hidden) dock.hidden = false;
  document.body.classList.add('has-dock');
}

// Start a new run. Appends a header rather than wiping what came before, so
// the survey and the flight planning read as one continuous session log.
function traceReset(title) {
  traceOpen();
  const log = traceLogEl();
  if (!log) return;
  traceRunSeq += 1;
  traceStart = Date.now();
  thinkingEl = null;

  const head = document.createElement('div');
  head.className = 'trace-run';
  head.innerHTML =
    '<span class="trace-run-n num">RUN ' + traceRunSeq + '</span>' +
    '<span class="trace-run-title">' + escapeHtml(title || 'Started') + '</span>' +
    '<span class="trace-run-time num">' + new Date().toLocaleTimeString() + '</span>';
  log.appendChild(head);
  scrollTrace();
  setTraceCount();
}

function traceElapsed() {
  return ((Date.now() - traceStart) / 1000).toFixed(1) + 's';
}

function traceStep(kind, label, detail) {
  const log = traceLogEl();
  if (!log) return;
  traceOpen();
  if (!traceStart) traceStart = Date.now();

  const k = TRACE_KINDS[kind] || TRACE_KINDS.check;
  const row = document.createElement('div');
  row.className = 'trace-row ' + k.cls;
  row.innerHTML =
    '<span class="trace-time num">' + traceElapsed() + '</span>' +
    '<span class="trace-tag num">' + k.tag + '</span>' +
    '<span class="trace-body">' +
      '<span class="trace-label">' + escapeHtml(label) + '</span>' +
      (detail ? '<span class="trace-detail">' + formatDetail(detail) + '</span>' : '') +
    '</span>';
  log.appendChild(row);
  thinkingEl = null;           // a new step closes the current reasoning block
  scrollTrace();
  setTraceCount();
}

// Detail strings are written as "a · b · c". Split them into separate chips so
// long technical lines stay scannable instead of wrapping into a wall of text.
function formatDetail(detail) {
  const parts = String(detail).split('·').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return escapeHtml(detail);
  return parts.map((p) => '<span class="trace-chip">' + escapeHtml(p) + '</span>').join('');
}

// Model reasoning arrives as a stream of deltas; append into one growing block.
function traceThinking(text) {
  const log = traceLogEl();
  if (!log || !text) return;
  traceOpen();
  if (!thinkingEl) {
    const row = document.createElement('div');
    row.className = 'trace-row think';
    row.innerHTML =
      '<span class="trace-time num">' + traceElapsed() + '</span>' +
      '<span class="trace-tag num">THINKING</span>' +
      '<span class="trace-body"><span class="trace-think"></span></span>';
    log.appendChild(row);
    thinkingEl = row.querySelector('.trace-think');
  }
  thinkingEl.textContent += text;
  scrollTrace();
}

function traceDone(summary) {
  traceStep('check', 'Finished in ' + traceElapsed(), summary || '');
}

function scrollTrace() {
  const log = traceLogEl();
  if (log && !traceCollapsed) log.scrollTop = log.scrollHeight;
}

function setTraceCount() {
  const el = document.getElementById('trace-count');
  const log = traceLogEl();
  if (el && log) {
    const n = log.querySelectorAll('.trace-row').length;
    el.textContent = n + (n === 1 ? ' line' : ' lines');
  }
}

function initTraceDock() {
  const toggle = document.getElementById('trace-toggle');
  const clear = document.getElementById('trace-clear');
  if (toggle) {
    toggle.onclick = () => {
      traceCollapsed = !traceCollapsed;
      const dock = document.getElementById('trace-dock');
      if (dock) dock.classList.toggle('collapsed', traceCollapsed);
      document.body.classList.toggle('dock-collapsed', traceCollapsed);
      toggle.textContent = traceCollapsed ? 'Expand' : 'Collapse';
      scrollTrace();
    };
  }
  if (clear) {
    clear.onclick = () => {
      const log = traceLogEl();
      if (log) log.innerHTML = '';
      traceRunSeq = 0;
      setTraceCount();
    };
  }
  setTraceCount();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Paced narration. The pipeline stages are real, but they complete far faster
// than a human can read, so the console is deliberately slowed to stay legible.
function tracePause(minMs, maxMs) {
  const lo = minMs == null ? 180 : minMs;
  const hi = maxMs == null ? 620 : maxMs;
  return new Promise((r) => setTimeout(r, lo + Math.random() * (hi - lo)));
}

// Emit a step, then hold briefly so it can be read.
async function traceBeat(kind, label, detail, minMs, maxMs) {
  traceStep(kind, label, detail);
  await tracePause(minMs, maxMs);
}
