// Live analysis trace. Shows the grower what the system is actually reading
// and reasoning about while a survey runs, instead of a spinner.
//
// Every line here corresponds to real work: imagery tiles actually fetched,
// indices actually computed, the catalog actually sent, and the model's own
// summarised reasoning streamed back. Nothing is invented for show — if a step
// isn't really happening, it doesn't get a line.

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

function traceReset(title) {
  traceEl = document.getElementById('trace-log');
  const panel = document.getElementById('trace-panel');
  if (panel) panel.hidden = false;
  if (!traceEl) return;
  traceEl.innerHTML = '';
  thinkingEl = null;
  traceStart = Date.now();
  if (title) traceStep('model', title, '');
}

function traceElapsed() {
  return ((Date.now() - traceStart) / 1000).toFixed(1) + 's';
}

function traceStep(kind, label, detail) {
  if (!traceEl) traceEl = document.getElementById('trace-log');
  if (!traceEl) return;
  const panel = document.getElementById('trace-panel');
  if (panel && panel.hidden) { panel.hidden = false; traceStart = traceStart || Date.now(); }
  const k = TRACE_KINDS[kind] || TRACE_KINDS.check;
  const row = document.createElement('div');
  row.className = 'trace-row ' + k.cls;
  row.innerHTML =
    '<span class="trace-time num">' + traceElapsed() + '</span>' +
    '<span class="trace-tag num">' + k.tag + '</span>' +
    '<span class="trace-body"><strong>' + escapeHtml(label) + '</strong>' +
      (detail ? '<span class="trace-detail">' + escapeHtml(detail) + '</span>' : '') +
    '</span>';
  traceEl.appendChild(row);
  thinkingEl = null;           // a new step closes the current reasoning block
  traceEl.scrollTop = traceEl.scrollHeight;
}

// Model reasoning arrives as a stream of deltas; append into one growing block.
function traceThinking(text) {
  if (!traceEl) traceEl = document.getElementById('trace-log');
  if (!traceEl || !text) return;
  if (!thinkingEl) {
    const row = document.createElement('div');
    row.className = 'trace-row think';
    row.innerHTML =
      '<span class="trace-time num">' + traceElapsed() + '</span>' +
      '<span class="trace-tag num">THINKING</span>' +
      '<span class="trace-body"><span class="trace-think"></span></span>';
    traceEl.appendChild(row);
    thinkingEl = row.querySelector('.trace-think');
  }
  thinkingEl.textContent += text;
  traceEl.scrollTop = traceEl.scrollHeight;
}

function traceDone(summary) {
  traceStep('check', 'Finished in ' + traceElapsed(), summary || '');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Paced narration. The pipeline stages below are real, but they complete far
// faster than a human can read, so the trace is deliberately slowed to stay
// legible while a survey runs.
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
