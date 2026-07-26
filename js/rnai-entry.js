// Field-to-PENUMBRA handoff. The engine is considered wired only when a user
// can select field context here and arrive at safety.html with valid state.
const RNAI_CONTEXT_KEY = 'fieldloop_rnai_context';

function initRnaiEntry(data) {
  const body = document.getElementById('rnai-entry-body');
  if (!body || typeof RNAI_CATALOG === 'undefined') return;

  const treatable = (data.zones || []).filter((z) => z.treatment_id !== 'none');
  const saved = loadRnaiContext();
  const cropId = saved && RNAI_CATALOG.crops.some((c) => c.id === saved.crop_id)
    ? saved.crop_id : RNAI_CATALOG.crops[0].id;

  body.innerHTML =
    '<div class="rnai-entry-grid">' +
      '<label class="field-label">Crop<select id="rnai-crop" class="inv-input"></select></label>' +
      '<label class="field-label">Confirmed pest<select id="rnai-pest" class="inv-input"></select></label>' +
      '<div class="rnai-zone-count"><span class="num">' + treatable.length + '</span>' +
        ' mapped stress zones available for field confirmation</div>' +
      '<button id="rnai-open" class="btn btn-primary" disabled>Open PENUMBRA safety lab</button>' +
    '</div>' +
    '<label class="rnai-confirm"><input id="rnai-confirmed" type="checkbox"> ' +
      'I manually confirmed this pest in the mapped zones; unconfirmed zones remain do-not-spray.</label>' +
    '<p class="band-note rnai-honesty">Imagery finds scouting candidates; it cannot identify an insect. ' +
      'Choose the crop and pest only after field confirmation. Unconfirmed zones stay do-not-spray.</p>';

  const crop = document.getElementById('rnai-crop');
  const pest = document.getElementById('rnai-pest');
  crop.innerHTML = RNAI_CATALOG.crops.map((c) =>
    '<option value="' + c.id + '"' + (c.id === cropId ? ' selected' : '') + '>' + c.name + '</option>').join('');

  function renderPests(preferred) {
    const current = RNAI_CATALOG.crops.find((c) => c.id === crop.value);
    const list = RNAI_CATALOG.pests.filter((p) => current.pest_ids.includes(p.id));
    pest.innerHTML = list.map((p) =>
      '<option value="' + p.id + '"' + (p.id === preferred ? ' selected' : '') + '>' + p.name + '</option>').join('');
  }
  renderPests(saved && saved.pest_id);
  crop.onchange = () => renderPests(null);

  const open = document.getElementById('rnai-open');
  const confirmed = document.getElementById('rnai-confirmed');
  confirmed.onchange = () => { open.disabled = !confirmed.checked || !treatable.length; };
  open.onclick = () => {
    const bounds = data.meta && data.meta.bounds ? data.meta.bounds.slice() : [];
    const context = {
      version: 1,
      plan_fingerprint: planFingerprint(data),
      field_bounds: bounds,
      crop_id: crop.value,
      pest_id: pest.value,
      confirmed_zone_ids: treatable.map((z) => z.id),
      confirmation_method: 'manual',
      application_route: 'foliar',
      evidence_version: RNAI_CATALOG.version,
      field_name: data.meta && data.meta.name,
      field_date: data.meta && data.meta.date
    };
    sessionStorage.setItem(RNAI_CONTEXT_KEY, JSON.stringify(context));
    window.location.href = 'safety.html';
  };
}

function planFingerprint(data) {
  const raw = JSON.stringify({
    bounds: data.meta && data.meta.bounds,
    date: data.meta && data.meta.date,
    zones: (data.zones || []).map((z) => z.id)
  });
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 'fl-' + (h >>> 0).toString(16);
}

function loadRnaiContext() {
  try {
    const raw = sessionStorage.getItem(RNAI_CONTEXT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_err) {
    return null;
  }
}
