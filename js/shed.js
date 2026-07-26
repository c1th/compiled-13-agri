// Pesticide shed — what the grower already has on hand. Crop-aware: picking a
// crop (manually, or via the AI crop-intel call) surfaces the products
// commonly kept for that crop's pest complex, each one click from the shed.
//
// The shed NEVER constrains the prescription — the analysis layer still
// recommends the agronomically optimal product and quantity. Stock only nets
// down what procurement suggests ordering (see procure.js).

const SHED_KEY = 'fieldloop_shed';

// { crop_id, crop_label, crop_source, items: [{ name, qty_gal, type, catalog_id }] }
function loadShed() {
  try {
    const raw = localStorage.getItem(SHED_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_e) { /* corrupted — start fresh */ }
  return { crop_id: '', crop_label: '', crop_source: '', items: [] };
}

function saveShed(shed) {
  try { localStorage.setItem(SHED_KEY, JSON.stringify(shed)); } catch (_e) { /* quota — non-fatal */ }
}

// Called by resetAllPanels on "R" so a second demo run starts clean.
function resetShed() {
  try { localStorage.removeItem(SHED_KEY); } catch (_e) { /* ignore */ }
}

// procure.js reads this to net order quantities against stock.
function getShedInventory() {
  return loadShed().items;
}

// AI suggestions from /api/crop-intel replace the local DB list for the
// session; kept in memory only so a reload falls back to the local DB.
let aiSuggestions = null;

function initShed(data) {
  const body = document.getElementById('shed-body');
  if (!body) return;
  const shed = loadShed();
  body.innerHTML = '';

  // --- Crop picker row ---
  const bar = document.createElement('div');
  bar.className = 'shed-bar';
  bar.innerHTML =
    '<label class="field-label" for="shed-crop">Crop</label>' +
    '<select id="shed-crop" class="inv-input shed-crop-select">' +
      '<option value="">Pick your crop…</option>' +
      CROP_DB.map((c) => '<option value="' + c.id + '"' +
        (shed.crop_id === c.id ? ' selected' : '') + '>' + c.name + '</option>').join('') +
    '</select>' +
    '<button id="shed-detect" class="btn" type="button">Identify crop from region (AI)</button>' +
    '<span id="shed-status" class="shed-status">' +
      (shed.crop_source ? shed.crop_source : '') + '</span>';
  body.appendChild(bar);

  // --- Suggestions for the chosen crop ---
  const sugWrap = document.createElement('div');
  sugWrap.id = 'shed-suggestions';
  body.appendChild(sugWrap);

  // --- Free-text add row (datalist covers every product we know about) ---
  const allNames = new Set();
  for (const c of CROP_DB) for (const p of c.products) allNames.add(p.name);
  const addRow = document.createElement('form');
  addRow.className = 'shed-add-row';
  addRow.innerHTML =
    '<input id="shed-name" class="inv-input shed-name-input" list="shed-products" ' +
      'placeholder="Product name (pick a suggestion or type your own)">' +
    '<datalist id="shed-products">' +
      Array.from(allNames).sort().map((n) => '<option value="' + n + '">').join('') +
    '</datalist>' +
    '<input id="shed-qty" class="inv-input inv-num" type="number" min="0" step="0.5" placeholder="gal">' +
    '<span class="inv-unit">gal</span>' +
    '<button class="btn" type="submit">Add to shed</button>';
  addRow.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('shed-name').value.trim();
    const qty = Number(document.getElementById('shed-qty').value);
    if (!name || !(qty > 0)) return;
    addToShed(name, qty, guessProductMeta(name));
  });
  body.appendChild(addRow);

  // --- The shed contents ---
  const list = document.createElement('div');
  list.id = 'shed-list';
  body.appendChild(list);

  const note = document.createElement('p');
  note.className = 'band-note shed-note';
  note.textContent = 'Stock never changes the prescription — the plan always uses the optimal product. What you have on hand is subtracted from the procurement order.';
  body.appendChild(note);

  document.getElementById('shed-crop').addEventListener('change', (e) => {
    const s = loadShed();
    const crop = CROP_DB.find((c) => c.id === e.target.value);
    s.crop_id = e.target.value;
    s.crop_label = crop ? crop.name : '';
    s.crop_source = crop ? 'Selected manually' : '';
    aiSuggestions = null;
    saveShed(s);
    setShedStatus(s.crop_source);
    renderSuggestions();
  });
  document.getElementById('shed-detect').addEventListener('click', detectCropAI);

  renderSuggestions();
  renderShedList(data);
}

function setShedStatus(text) {
  const el = document.getElementById('shed-status');
  if (el) el.textContent = text || '';
}

// Match a typed name back to crop-DB / catalog metadata when possible.
function guessProductMeta(name) {
  const lower = name.toLowerCase();
  for (const c of CROP_DB) {
    for (const p of c.products) {
      if (p.name.toLowerCase() === lower) return { type: p.type, catalog_id: p.catalog_id || null };
    }
  }
  const cat = (typeof TREATMENT_CATALOG !== 'undefined' ? TREATMENT_CATALOG : [])
    .find((p) => p.name.toLowerCase() === lower);
  return { type: cat ? 'biological' : '', catalog_id: cat ? cat.id : null };
}

function addToShed(name, qty, meta) {
  const shed = loadShed();
  const existing = shed.items.find((i) => i.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    existing.qty_gal = Number((existing.qty_gal + qty).toFixed(1));
  } else {
    shed.items.push({ name, qty_gal: Number(qty.toFixed(1)),
      type: (meta && meta.type) || '', catalog_id: (meta && meta.catalog_id) || null });
  }
  saveShed(shed);
  const nameEl = document.getElementById('shed-name');
  const qtyEl = document.getElementById('shed-qty');
  if (nameEl) nameEl.value = '';
  if (qtyEl) qtyEl.value = '';
  renderShedList(currentPlanData());
  // Order quantities net against stock, so refresh procurement too.
  try { if (typeof initProcure === 'function') initProcure(currentPlanData()); } catch (_e) { /* non-fatal */ }
}

function removeFromShed(name) {
  const shed = loadShed();
  shed.items = shed.items.filter((i) => i.name !== name);
  saveShed(shed);
  renderShedList(currentPlanData());
  try { if (typeof initProcure === 'function') initProcure(currentPlanData()); } catch (_e) { /* non-fatal */ }
}

// The live plan the rest of the dashboard is showing (app.js owns DATA).
function currentPlanData() {
  return (typeof DATA !== 'undefined') ? DATA : { treatments: {}, zones: [] };
}

function renderSuggestions() {
  const wrap = document.getElementById('shed-suggestions');
  if (!wrap) return;
  const shed = loadShed();
  const crop = CROP_DB.find((c) => c.id === shed.crop_id);
  const products = aiSuggestions || (crop ? crop.products : null);

  if (!products) {
    wrap.innerHTML = '<p class="band-note">Pick a crop (or let the AI identify it from your drawn region) to see the products growers commonly keep for it.</p>';
    return;
  }

  const pests = aiSuggestions ? (aiSuggestions.pests || []) : crop.pests;
  wrap.innerHTML =
    '<div class="shed-sug-head">Common products for <strong>' +
      (shed.crop_label || 'this crop') + '</strong>' +
      (pests.length ? ' <span class="shed-pests">· typical pests: ' + pests.join(', ') + '</span>' : '') +
    '</div>' +
    '<div class="shed-sug-list">' +
      products.map((p, i) =>
        '<div class="shed-sug">' +
          '<span class="sug-type ' + (p.type === 'biological' ? 'bio' : 'conv') + '">' +
            (p.type === 'biological' ? 'BIO' : 'CONV') + '</span>' +
          '<span class="sug-name">' + p.name + '</span>' +
          '<span class="sug-targets">' + (p.targets || '') + '</span>' +
          '<button class="btn sug-add" data-i="' + i + '" type="button">+ Add</button>' +
        '</div>').join('') +
    '</div>';

  wrap.querySelectorAll('.sug-add').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = products[Number(btn.dataset.i)];
      addToShed(p.name, 5, { type: p.type, catalog_id: p.catalog_id || null });
    });
  });
}

// AI suggestions carry a pests list alongside the array entries.
function setAISuggestions(products, pests) {
  aiSuggestions = products;
  aiSuggestions.pests = pests || [];
}

function renderShedList(data) {
  const list = document.getElementById('shed-list');
  if (!list) return;
  const shed = loadShed();

  if (!shed.items.length) {
    list.innerHTML = '<span class="procure-empty">Shed is empty — add the pesticides you already have.</span>';
    return;
  }

  // What does the current plan need of each on-hand product?
  const needByProduct = {};
  for (const key of Object.keys((data && data.treatments) || {})) {
    if (key === 'none') continue;
    const zones = (data.zones || []).filter((z) => z.treatment_id === key);
    if (zones.length) {
      needByProduct[key] = Math.ceil(zones.reduce((s, z) => s + z.volume_gal, 0));
    }
  }

  list.innerHTML = shed.items.map((item) => {
    const catColor = item.catalog_id && data && data.treatments && data.treatments[item.catalog_id]
      ? data.treatments[item.catalog_id].color : null;
    const need = item.catalog_id != null ? needByProduct[item.catalog_id] : undefined;
    let coverage = '';
    if (need !== undefined) {
      coverage = item.qty_gal >= need
        ? '<span class="shed-cover ok">covers the plan’s ' + need + ' gal</span>'
        : '<span class="shed-cover short">plan needs ' + need + ' gal — short ' +
            Math.ceil(need - item.qty_gal) + ' gal</span>';
    }
    return '<div class="shed-row">' +
      '<span class="legend-swatch" style="background:' + (catColor || '#8B98A5') + '"></span>' +
      '<span class="shed-item-name">' + item.name + '</span>' +
      (item.type ? '<span class="sug-type ' + (item.type === 'biological' ? 'bio' : 'conv') + '">' +
        (item.type === 'biological' ? 'BIO' : 'CONV') + '</span>' : '') +
      '<span class="shed-item-qty num">' + item.qty_gal + ' gal</span>' +
      coverage +
      '<button class="inv-remove" title="Remove" type="button" data-name="' +
        item.name.replace(/"/g, '&quot;') + '">&times;</button>' +
    '</div>';
  }).join('');

  list.querySelectorAll('.inv-remove').forEach((btn) => {
    btn.addEventListener('click', () => removeFromShed(btn.dataset.name));
  });
}

// --- AI crop identification -------------------------------------------------
// Asks the server (Claude) what is most likely grown at the drawn region's
// coordinates and for a tailored product list. Falls back to a clearly
// labeled latitude-band heuristic so the demo works offline.

async function detectCropAI() {
  const btn = document.getElementById('shed-detect');
  const regions = (typeof getRegions === 'function') ? getRegions() : [];
  if (!regions.length) {
    setShedStatus('Draw a region on the map first — the AI reads the crop from its coordinates.');
    return;
  }
  const bounds = (typeof getRegionBounds === 'function') ? getRegionBounds() : regions[0].bounds;

  btn.disabled = true;
  btn.textContent = 'Identifying…';
  setShedStatus('Asking the model what grows here…');

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    const res = await fetch('/api/crop-intel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bounds }),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.reason || 'crop-intel responded ' + res.status);
    }
    const intel = await res.json();
    applyCropIntel(intel, 'AI · ' + Math.round((intel.confidence || 0) * 100) + '% confident — ' +
      (intel.region_note || ''));
  } catch (err) {
    console.warn('[FieldLoop] crop-intel failed, using offline heuristic:', err);
    const guess = offlineCropGuess(bounds);
    applyCropIntel(guess, 'Offline estimate from latitude band (' +
      (err.message || 'AI unavailable') + ') — verify the crop.');
  }

  btn.disabled = false;
  btn.textContent = 'Identify crop from region (AI)';
}

function applyCropIntel(intel, statusText) {
  const shed = loadShed();
  // Snap to a known crop id when the AI names one we have locally.
  const match = CROP_DB.find((c) =>
    c.name.toLowerCase().includes((intel.crop || '').toLowerCase()) ||
    (intel.crop || '').toLowerCase().includes(c.id));
  shed.crop_id = match ? match.id : '';
  shed.crop_label = intel.crop || (match ? match.name : '');
  shed.crop_source = statusText;
  saveShed(shed);

  const sel = document.getElementById('shed-crop');
  if (sel) sel.value = shed.crop_id;
  if (intel.products && intel.products.length) {
    setAISuggestions(intel.products.map((p) => ({
      name: p.name, type: p.type, targets: p.targets,
      catalog_id: guessProductMeta(p.name).catalog_id
    })), intel.pests);
  } else {
    aiSuggestions = null;
  }
  setShedStatus(statusText);
  renderSuggestions();
}

// Deterministic, clearly-labeled fallback: pick the dominant crop of the
// latitude band. Crude on purpose — it exists so the flow works offline.
function offlineCropGuess(bounds) {
  const lat = Math.abs((bounds[1] + bounds[3]) / 2);
  let id = 'wheat';
  if (lat < 15) id = 'rice';
  else if (lat < 30) id = 'cotton';
  else if (lat < 45) id = 'corn';
  const crop = CROP_DB.find((c) => c.id === id);
  return {
    crop: crop.name,
    confidence: 0,
    region_note: 'latitude-band heuristic',
    pests: crop.pests,
    products: crop.products.map((p) => ({ name: p.name, type: p.type, targets: p.targets }))
  };
}
