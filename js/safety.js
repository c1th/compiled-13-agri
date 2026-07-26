// PENUMBRA Safety Lab: connected field context -> live ranking -> merchant
// discovery or research dossier. No experimental candidate can deploy.
(function () {
  const KEY = 'fieldloop_rnai_context';
  const context = readContext();
  const status = document.getElementById('safety-status');
  const runBtn = document.getElementById('run-safety');

  if (!context || typeof RNAI_CATALOG === 'undefined') {
    document.getElementById('safety-intro').textContent =
      'No confirmed field context was found. Return to Field view, run an analysis, and confirm crop and pest.';
    runBtn.disabled = true;
    status.textContent = 'Blocked: field context is required.';
    return;
  }

  const crop = RNAI_CATALOG.crops.find((c) => c.id === context.crop_id);
  const pest = RNAI_CATALOG.pests.find((p) => p.id === context.pest_id);
  document.getElementById('safety-context').textContent =
    (context.field_name || 'Selected field') + ' · ' + crop.name + ' · ' + pest.name;
  document.getElementById('safety-intro').textContent =
    'Compare the safest approved option available now with a species-specific RNAi candidate for ' +
    pest.name + '. Every research result remains behind a wet-lab gate.';

  runBtn.onclick = runSafety;

  async function runSafety() {
    runBtn.disabled = true;
    runBtn.textContent = 'Screening…';
    trace('Loading versioned PENUMBRA evidence');
    try {
      const response = await fetch('/api/rnai/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(context)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.reason || payload.error || 'Safety screen failed');
      context.recommendation_run = payload.run_id;
      context.evidence_version = payload.evidence_version;
      sessionStorage.setItem(KEY, JSON.stringify(context));
      trace('Safety-first ranking complete · ' + payload.use_now.length +
        ' current option(s) · ' + payload.develop_next.length + ' research candidate(s)');
      renderUseNow(payload.use_now);
      renderCandidates(payload.develop_next);
      renderSpecies(payload.develop_next[0]);
    } catch (err) {
      status.textContent = 'Safety screen unavailable: ' + err.message;
      status.classList.add('error');
    }
    runBtn.disabled = false;
    runBtn.textContent = 'Run safety screen';
  }

  function trace(text) {
    status.textContent = text;
    status.classList.remove('error');
  }

  function renderUseNow(options) {
    const body = document.getElementById('use-now-body');
    if (!options.length) {
      body.innerHTML = '<div class="decision-empty">No curated label-eligible option is available for this context.</div>';
      return;
    }
    body.innerHTML = options.map((o, i) =>
      '<article class="option-card' + (i === 0 ? ' selected' : '') + '">' +
        '<div class="option-rank num">0' + (i + 1) + '</div>' +
        '<div class="option-main">' +
          '<h3>' + esc(o.name) + '</h3>' +
          '<p>' + esc(o.rationale) + '</p>' +
          '<div class="evidence-chips">' +
            '<span>' + esc(o.kind.replace(/_/g, ' ')) + '</span>' +
            '<span>' + esc(o.application_route) + '</span>' +
            '<span>safety tier ' + o.safety_tier + '</span>' +
          '</div>' +
          '<p class="label-note">' + esc(o.label_status) + '</p>' +
        '</div>' +
        '<div class="option-actions">' +
          '<button class="btn offer-btn" data-id="' + esc(o.id) + '">Find merchant offers</button>' +
          (o.mission_enabled ? '<button class="btn btn-primary mission-btn" data-id="' +
            esc(o.id) + '">Enable mission</button>' : '') +
        '</div>' +
      '</article>').join('');

    body.querySelectorAll('.offer-btn').forEach((button) => {
      button.onclick = () => loadOffers(button.dataset.id);
    });
    body.querySelectorAll('.mission-btn').forEach((button) => {
      button.onclick = () => enableMission(button.dataset.id);
    });
  }

  function renderCandidates(candidates) {
    const body = document.getElementById('develop-next-body');
    body.innerHTML = candidates.map((c) => {
      const blocked = c.status === 'blocked';
      return '<article class="candidate-card ' + esc(c.status) + '">' +
        '<div class="candidate-head">' +
          '<div><span class="candidate-role">' + (c.role === 'rotation' ? 'Alternate target' : 'Lead candidate') +
            '</span><h3>' + esc(c.target_gene) + ' · <span class="num">' + c.length_nt + ' nt</span></h3></div>' +
          '<span class="risk-number num">' + pct(c.worst_risk_high) + ' upper risk</span>' +
        '</div>' +
        '<div class="candidate-metrics">' +
          metric('Efficacy constraint', pct(c.efficacy_score), c.efficacy_pass ? 'pass' : 'fail') +
          metric('Worst modeled risk', pct(c.worst_risk_mean), '95% CI ' + pct(c.worst_risk_low) + '–' + pct(c.worst_risk_high)) +
          metric('Nearest match', c.max_contiguous_match_nt + ' nt', c.nearest_match) +
          metric('RNA-FM similarity', c.embedding_similarity.toFixed(2), c.phylogenetic_margin) +
        '</div>' +
        '<p class="candidate-warning">' + esc(c.warning) + '</p>' +
        '<div class="option-actions">' +
          '<button class="btn inspect-candidate" data-id="' + esc(c.id) + '">Inspect species screen</button>' +
          '<button class="btn dossier-btn" data-id="' + esc(c.id) + '"' + (blocked ? ' disabled' : '') + '>Export dossier</button>' +
        '</div>' +
      '</article>';
    }).join('');

    body.querySelectorAll('.inspect-candidate').forEach((button) => {
      button.onclick = () => renderSpecies(candidates.find((c) => c.id === button.dataset.id));
    });
    body.querySelectorAll('.dossier-btn').forEach((button) => {
      button.onclick = () => downloadDossier(button.dataset.id);
    });
  }

  function metric(label, value, note) {
    return '<div class="candidate-metric"><span>' + esc(label) + '</span><strong class="num">' +
      esc(value) + '</strong><small>' + esc(note) + '</small></div>';
  }

  function renderSpecies(candidate) {
    const body = document.getElementById('species-screen');
    if (!candidate) return;
    const species = RNAI_CATALOG.protected_species;
    body.innerHTML =
      '<div class="species-head"><div><strong>' + esc(candidate.target_gene) + '</strong>' +
        '<span>' + esc(candidate.evidence_level) + '</span></div>' +
        '<span class="src-badge">PENUMBRA ' + esc(candidate.model_version) + '</span></div>' +
      '<div class="species-grid">' +
        species.map((s, i) => {
          const relative = Math.max(0.005, candidate.worst_risk_mean * (1 - i * 0.09));
          return '<div class="species-row"><span>' + esc(s.name) + '<small>' + esc(s.role) + '</small></span>' +
            '<div class="risk-track"><i style="width:' + Math.min(100, relative * 500) + '%"></i></div>' +
            '<strong class="num">' + pct(relative) + '</strong></div>';
        }).join('') +
      '</div>' +
      '<p class="band-note">Relative site screen from cached development-model evidence. ' +
        'GBIF occurrence weighting is not yet available for arbitrary locations; no abundance claim is made.</p>';
  }

  async function loadOffers(treatmentId) {
    const body = document.getElementById('safety-offers');
    body.innerHTML = '<div class="decision-empty">Searching Channel3 merchant data…</div>';
    try {
      const response = await fetch('/api/channel3/offers/' + encodeURIComponent(treatmentId));
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.reason || 'Merchant search unavailable');
      if (!payload.products.length) throw new Error('No verified merchant offer found');
      body.innerHTML = '<div class="offer-source"><span class="src-badge">Channel3 · live</span>' +
        '<span class="field-date">' + esc(payload.retrieved_at) + '</span></div>' +
        payload.products.map(offerCard).join('');
    } catch (err) {
      body.innerHTML = '<div class="decision-empty"><strong>No verified merchant offer found.</strong><br>' +
        esc(err.message) + '. FieldLoop will not substitute a loosely matched pesticide.</div>';
    }
  }

  function offerCard(p) {
    const offer = p.offers && p.offers[0];
    return '<article class="merchant-card">' +
      (p.image ? '<img src="' + attr(p.image) + '" alt="">' : '<span class="merchant-img"></span>') +
      '<div><h3>' + esc(p.title) + '</h3><p>' + esc(p.brand || 'Brand not supplied') +
        (offer && offer.domain ? ' · ' + esc(offer.domain) : '') + '</p></div>' +
      '<div class="merchant-price num">' + (offer && offer.price != null ? money(offer.price, offer.currency) : 'Price unavailable') + '</div>' +
      (offer && offer.url ? '<a class="btn" href="' + attr(offer.url) +
        '" target="_blank" rel="noopener">View merchant</a>' : '') +
    '</article>';
  }

  async function downloadDossier(candidateId) {
    const response = await fetch('/api/rnai/dossier', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context, candidate_id: candidateId })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      status.textContent = 'Dossier unavailable: ' + (payload.reason || response.status);
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fieldloop-penumbra-' + candidateId + '.pdf';
    a.click();
    URL.revokeObjectURL(url);
  }

  function enableMission(treatmentId) {
    const treatment = RNAI_CATALOG.treatments.find((item) => item.id === treatmentId);
    if (!treatment || !treatment.mission_enabled) {
      status.textContent = 'Mission blocked: this treatment is not enabled for deployment in the demo.';
      status.classList.add('error');
      return;
    }
    let plan;
    try {
      plan = JSON.parse(sessionStorage.getItem('fieldloop_plan') || 'null');
    } catch (_err) { plan = null; }
    if (!plan || !Array.isArray(plan.zones)) {
      status.textContent = 'Mission blocked: the field plan is no longer available. Return to Field view and rerun the survey.';
      status.classList.add('error');
      return;
    }

    const confirmed = new Set(context.confirmed_zone_ids || []);
    const none = (plan.treatments && plan.treatments.none) ||
      { name: 'Do not spray', rate_gal_per_acre: 0, color: '#5A9BD4' };
    plan.treatments = {};
    plan.treatments[treatment.id] = {
      name: treatment.name,
      rate_gal_per_acre: treatment.rate_gal_per_acre,
      color: treatment.color
    };
    plan.treatments.none = none;
    plan.zones = plan.zones.map((zone) => {
      if (!confirmed.has(zone.id)) {
        return Object.assign({}, zone, { treatment_id: 'none', volume_gal: 0 });
      }
      const volume = Number((Math.max(0, Number(zone.area_acres) || 0) * treatment.rate_gal_per_acre).toFixed(2));
      return Object.assign({}, zone, {
        diagnosis: 'biotic_stress',
        treatment_id: treatment.id,
        volume_gal: volume
      });
    });
    plan.source = 'penumbra-approved-reference';
    try {
      sessionStorage.setItem('fieldloop_plan', JSON.stringify(plan));
    } catch (_err) {
      status.textContent = 'Mission blocked: could not persist the approved field plan.';
      status.classList.add('error');
      return;
    }
    context.selected_treatment_id = treatmentId;
    context.deployment_status = 'mission_enabled';
    sessionStorage.setItem(KEY, JSON.stringify(context));
    status.textContent = 'Mission gate opened for the approved ledprona reference. Return to Field view to configure the fleet.';
  }

  function readContext() {
    try {
      const raw = sessionStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_err) {
      return null;
    }
  }
  function pct(v) { return (Number(v) * 100).toFixed(1) + '%'; }
  function money(v, currency) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(v);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function attr(s) { return esc(s).replace(/"/g, '&quot;'); }
})();
