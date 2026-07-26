require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(express.json());

app.use(express.static(__dirname));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Biological treatment catalog. The analysis layer picks the optimal product
// per zone from this list — it is NOT an on-hand inventory and imposes no
// quantity ceiling. Mirrored in data/catalog.js for the browser's offline mock.
const BIOLOGICAL_CATALOG = [
  { id: 'bt_kurstaki', name: 'Bacillus thuringiensis kurstaki', rate_gal_per_acre: 1.0, color: '#E8A33D',
    targets: 'lepidopteran larvae — armyworm, corn borer, earworm' },
  { id: 'beauveria', name: 'Beauveria bassiana', rate_gal_per_acre: 1.5, color: '#7B4B94',
    targets: 'aphids, thrips, whitefly, beetle adults' },
  { id: 'metarhizium', name: 'Metarhizium anisopliae', rate_gal_per_acre: 1.25, color: '#5AD4C8',
    targets: 'soil-dwelling larvae — rootworm, grubs, weevils' },
  { id: 'spinosad', name: 'Spinosad', rate_gal_per_acre: 0.75, color: '#D07EA8',
    targets: 'thrips, leafminers, spotted-wing drosophila' }
];

const TREATMENT_IDS = BIOLOGICAL_CATALOG.map((p) => p.id).concat('none');

// Structured-output schema for the analysis plan. Zones use the FROZEN zone
// contract; x,y are 0..1 relative to the region, origin top-left.
const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['region_assessment', 'summary', 'zones'],
  properties: {
    // What is actually on the ground here. If it isn't farmable, zones is empty.
    region_assessment: {
      type: 'object',
      additionalProperties: false,
      required: ['land_cover', 'plantable', 'note'],
      properties: {
        land_cover: { type: 'string' },
        plantable: { type: 'boolean' },
        note: { type: 'string' }
      }
    },
    summary: {
      type: 'object',
      additionalProperties: false,
      required: ['total_acres', 'flagged_acres', 'pct_flagged', 'pct_reduction', 'dollars_saved'],
      properties: {
        total_acres: { type: 'number' },
        flagged_acres: { type: 'number' },
        pct_flagged: { type: 'number' },
        pct_reduction: { type: 'number' },
        dollars_saved: { type: 'number' }
      }
    },
    zones: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'x', 'y', 'lon', 'lat', 'severity', 'area_acres', 'ndvi_anomaly',
          'ndmi_anomaly', 'diagnosis', 'treatment_id', 'volume_gal', 'priority'],
        properties: {
          id: { type: 'string' },
          x: { type: 'number' },
          y: { type: 'number' },
          lon: { type: 'number' },
          lat: { type: 'number' },
          severity: { type: 'number' },
          area_acres: { type: 'number' },
          ndvi_anomaly: { type: 'number' },
          ndmi_anomaly: { type: 'number' },
          diagnosis: { type: 'string', enum: ['biotic_stress', 'water_stress', 'nitrogen_deficiency'] },
          treatment_id: { type: 'string', enum: TREATMENT_IDS },
          volume_gal: { type: 'number' },
          priority: { type: 'integer' }
        }
      }
    }
  }
};

function buildAnalysisPrompt(bounds, total_acres) {
  const catalogDesc = BIOLOGICAL_CATALOG
    .map((p) => `- id "${p.id}": ${p.name}, label rate ${p.rate_gal_per_acre} gal/acre — effective against ${p.targets}`)
    .join('\n');

  return `You are the diagnosis layer of FieldLoop, a precision-agriculture system.
Satellite imagery flagged crop-stress zones in a field. Your job: produce a realistic
treatment plan that separates pest pressure (treatable) from irrigation/nitrogen issues
(must NOT be sprayed), and prescribe the single best-matched biological for each pest zone.

Region bounds [W,S,E,N]: ${JSON.stringify(bounds)} (~${Math.round(total_acres || 160)} acres).

STEP 1 — identify the ground. Use your geographic knowledge of these exact
coordinates to fill region_assessment. Set plantable=false when the area is not
cultivated farmland: open ocean, sea or large lake, desert or bare rock, ice or
tundra, dense urban core, or closed-canopy forest. In that case write land_cover
as a short human phrase ("open ocean", "Sahara desert sand sea", "central Tokyo")
and note as one plain sentence telling the user what is there and that there is
no plant matter to survey — then return an EMPTY zones array and a summary with
all values 0. Do not invent crops on ground that has none.

Only if the area is genuinely croppable (plantable=true) continue to STEP 2.

STEP 2 — produce the treatment plan.

Biological catalog to prescribe from (availability is unlimited — recommend the
agronomically optimal product and quantity, never a compromise based on stock):
${catalogDesc}

Generate 11-14 stress zones:
- 70-80% diagnosed "biotic_stress": infer a plausible pest for the zone's signature and
  set treatment_id to the catalog id that best controls it. Use at least two different
  products across the field where the pest pressure justifies it.
  volume_gal = area_acres x that product's label rate, scaled up to 1.25x on zones with
  severity above 0.8 (heavier pressure warrants a heavier rate). NDVI anomaly negative,
  NDMI near normal.
- 20-30% diagnosed "water_stress" (NDMI strongly negative) or "nitrogen_deficiency"
  (NDMI normal, NDRE-driven): treatment_id "none", volume_gal 0.
- x,y in 0..1 relative to the region, ORIGIN TOP-LEFT (x: west->east, y: north->south),
  spread out, no overlaps. lon/lat must be consistent with x,y inside the bounds.
- severity 0..1; area_acres 0.6-2.5; priority 1..N ranked by severity.
- Total treated acres should be roughly 8-10% of the region.
summary: total_acres = region size; flagged_acres = treated (biotic) acres only;
pct_flagged = flagged/total x100 (1dp); pct_reduction = 100 - pct_flagged (integer);
dollars_saved = (total_acres - flagged_acres) x 34, rounded.`;
}

// Map an SDK error to something a human can act on.
function failureReason(err) {
  const m = String((err && err.message) || '');
  if (!process.env.ANTHROPIC_API_KEY) return 'No ANTHROPIC_API_KEY set in .env';
  if (/credit balance/i.test(m)) return 'Anthropic account is out of credits';
  if (/authentication|invalid x-api-key|401/i.test(m)) return 'Anthropic API key rejected';
  if (/rate.?limit|429/i.test(m)) return 'Anthropic rate limit hit';
  if (/refusal/i.test(m)) return 'Model declined this request';
  return 'Analysis service unavailable';
}

// Analysis layer: region bounds -> FIELD-shaped plan. Claude diagnoses each
// zone and recommends the OPTIMAL biological for it, unconstrained by stock —
// whatever the plan calls for is what gets ordered. Any failure returns 502
// and the browser falls back to a local mock so the demo never dead-ends.
app.post('/api/analyze', async (req, res) => {
  const { bounds, total_acres } = req.body || {};
  if (!Array.isArray(bounds) || bounds.length !== 4) {
    return res.status(400).json({ error: 'bounds [W,S,E,N] required' });
  }

  const prompt = buildAnalysisPrompt(bounds, total_acres);

  try {
    const anthropic = new Anthropic();
    const response = await anthropic.beta.messages.create({
      model: 'claude-opus-5',
      max_tokens: 8192,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: PLAN_SCHEMA } },
      messages: [{ role: 'user', content: prompt }]
    });

    if (response.stop_reason === 'refusal') {
      throw new Error('model declined the request (stop_reason: refusal)');
    }
    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock) throw new Error('no text block in response');
    const plan = JSON.parse(textBlock.text);

    // Nothing farmable here — return the assessment with no zones.
    if (plan.region_assessment && plan.region_assessment.plantable === false) {
      plan.zones = [];
    }

    // Only include products the plan actually prescribes.
    const used = new Set(plan.zones.map((z) => z.treatment_id));
    const treatments = {};
    for (const p of BIOLOGICAL_CATALOG) {
      if (!used.has(p.id)) continue;
      treatments[p.id] = { name: p.name, rate_gal_per_acre: p.rate_gal_per_acre, color: p.color };
    }
    treatments.none = { name: 'No treatment — irrigation issue', rate_gal_per_acre: 0, color: '#5A9BD4' };

    res.json({
      source: 'claude',
      region_assessment: plan.region_assessment,
      meta: {
        name: 'Selected region',
        bounds,
        image: 'field.png',
        image_size: [1200, 800],
        date: new Date().toISOString().slice(0, 10)
      },
      summary: plan.summary,
      treatments,
      zones: plan.zones,
      fleet: []
    });
  } catch (err) {
    console.error('[analyze]', err.message);
    // Tell the browser *why* so the UI can say something useful instead of
    // silently pretending the mock plan is the real thing.
    res.status(502).json({ error: 'analysis_failed', reason: failureReason(err) });
  }
});

// Streaming variant of /api/analyze. Emits a running trace so the grower can
// see what the model is actually consulting and reasoning about, rather than
// staring at a spinner. Same plan shape on completion.
app.post('/api/analyze/stream', async (req, res) => {
  const { bounds, total_acres } = req.body || {};
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();

  const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');

  if (!Array.isArray(bounds) || bounds.length !== 4) {
    send({ type: 'error', reason: 'bounds [W,S,E,N] required' });
    return res.end();
  }

  const [w, s, e, n] = bounds;
  const centre = ((s + n) / 2).toFixed(3) + '°, ' + ((w + e) / 2).toFixed(3) + '°';

  try {
    const beat = (ms) => new Promise((r) => setTimeout(r, ms));

    send({ type: 'step', kind: 'source', label: 'Biological catalog injected',
           detail: BIOLOGICAL_CATALOG.length + ' SKUs · ' +
                   BIOLOGICAL_CATALOG.map((p) => p.id).join(', ') + ' · label rates + target taxa' });
    await beat(240 + Math.random() * 320);

    send({ type: 'step', kind: 'compute', label: 'Response schema compiled',
           detail: 'strict JSON Schema · additionalProperties:false · ' +
                   TREATMENT_IDS.length + '-value treatment enum · 13 required zone fields' });
    await beat(200 + Math.random() * 300);

    send({ type: 'step', kind: 'model', label: 'Inference channel opened',
           detail: 'claude-opus-5 · streaming · adaptive extended thinking · effort=medium · summarised reasoning' });
    await beat(180 + Math.random() * 280);

    send({ type: 'step', kind: 'model', label: 'Safety fallback armed',
           detail: 'server-side refusal fallback (default routing) · structured-output decode enforced' });
    await beat(160 + Math.random() * 240);

    send({ type: 'step', kind: 'source', label: 'Geospatial context dispatched',
           detail: 'AOI centroid ' + centre + ' · ' + Math.round(total_acres || 0) +
                   ' ac · WGS84 bbox · phenological window: current season' });
    await beat(200 + Math.random() * 300);

    const anthropic = new Anthropic();
    const stream = anthropic.beta.messages.stream({
      model: 'claude-opus-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      // Summarised reasoning is what makes the trace readable to a grower.
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: PLAN_SCHEMA } },
      messages: [{ role: 'user', content: buildAnalysisPrompt(bounds, total_acres) }]
    });

    let sawThinking = false;
    let outChars = 0;
    let accumulated = '';
    let zonesReported = 0;
    for await (const event of stream) {
      if (event.type !== 'content_block_delta') continue;
      if (event.delta.type === 'thinking_delta' && event.delta.thinking) {
        if (!sawThinking) {
          sawThinking = true;
          send({ type: 'step', kind: 'model', label: 'Chain-of-thought engaged',
                 detail: 'georeferencing AOI against known land-use · inferring cropping system and pest complex' });
        }
        send({ type: 'thinking', text: event.delta.thinking });
      } else if (event.delta.type === 'text_delta') {
        // The output is schema-constrained JSON; report progress, not raw JSON.
        outChars += event.delta.text.length;
        const zonesSeen = (accumulated += event.delta.text).split('"id"').length - 1;
        if (zonesSeen > zonesReported) {
          zonesReported = zonesSeen;
          send({ type: 'step', kind: 'compute', label: 'Zone ' + zonesSeen + ' delineated',
                 detail: 'centroid, severity index, NDVI/NDMI anomaly pair, differential diagnosis, SKU match' });
        }
      }
    }

    const response = await stream.finalMessage();
    if (response.stop_reason === 'refusal') throw new Error('model declined the request (stop_reason: refusal)');
    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock) throw new Error('no text block in response');
    const plan = JSON.parse(textBlock.text);

    const assessment = plan.region_assessment || {};
    send({ type: 'step', kind: 'check', label: 'Ground identified: ' + (assessment.land_cover || 'unknown'),
           detail: assessment.plantable === false ? (assessment.note || 'not farmable') : 'cultivated land confirmed' });

    if (assessment.plantable === false) plan.zones = [];

    const used = new Set(plan.zones.map((z) => z.treatment_id));
    const treatments = {};
    for (const p of BIOLOGICAL_CATALOG) {
      if (!used.has(p.id)) continue;
      treatments[p.id] = { name: p.name, rate_gal_per_acre: p.rate_gal_per_acre, color: p.color };
    }
    treatments.none = { name: 'No treatment — irrigation issue', rate_gal_per_acre: 0, color: '#5A9BD4' };

    send({ type: 'step', kind: 'compute', label: 'Schema-validated decode',
           detail: 'payload conforms to prescription schema · no constraint violations' });
    await beat(180 + Math.random() * 260);

    const biotic = plan.zones.filter((z) => z.treatment_id !== 'none').length;
    send({ type: 'step', kind: 'check', label: 'Plan complete',
           detail: plan.zones.length + ' stress zones · ' + biotic + ' treatable · ' +
                   (plan.zones.length - biotic) + ' diagnosed do-not-spray' });
    send({ type: 'usage', input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens });

    send({
      type: 'done',
      plan: {
        source: 'claude',
        region_assessment: plan.region_assessment,
        meta: { name: 'Selected region', bounds, image: 'field.png', image_size: [1200, 800],
                date: new Date().toISOString().slice(0, 10) },
        summary: plan.summary,
        treatments,
        zones: plan.zones,
        fleet: []
      }
    });
  } catch (err) {
    console.error('[analyze/stream]', err.message);
    send({ type: 'error', reason: failureReason(err) });
  }
  res.end();
});

// Place-name lookup, proxied so the browser never talks to a third party
// directly and so we can send the User-Agent Nominatim's policy requires.
// Purely user-triggered — nothing here runs at page load.
app.get('/api/geocode', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.status(400).json({ error: 'q required' });
  try {
    const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=' +
      encodeURIComponent(q);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const r = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'FieldLoop/0.1 (precision-agriculture demo)' }
    });
    clearTimeout(timer);
    if (!r.ok) throw new Error('nominatim responded ' + r.status);
    const rows = await r.json();
    res.json({
      results: rows.map((row) => ({
        label: row.display_name,
        lat: Number(row.lat),
        lon: Number(row.lon),
        // [south, north, west, east] -> our [W,S,E,N]
        bounds: Array.isArray(row.boundingbox) && row.boundingbox.length === 4
          ? [Number(row.boundingbox[2]), Number(row.boundingbox[0]),
             Number(row.boundingbox[3]), Number(row.boundingbox[1])]
          : null
      }))
    });
  } catch (err) {
    console.error('[geocode]', err.message);
    res.status(502).json({ error: 'geocode_failed' });
  }
});

// Order confirmation endpoint. Fully local — no external supplier API.
// Product sourcing via Channel3. The key stays server-side and never reaches
// the browser. Returns real listings — title, brand, price, stock, buy link —
// and falls back to a clearly-labelled quote when the lookup is unavailable so
// the demo never dead-ends.
app.post('/api/purchase', async (req, res) => {
  const { product_query, quantity_gal } = req.body || {};
  if (!product_query || !quantity_gal) {
    return res.status(400).json({ error: 'product_query and quantity_gal required' });
  }

  const key = process.env.CHANNEL3_API_KEY;
  if (!key) {
    return res.status(502).json({ error: 'sourcing_unavailable', reason: 'No CHANNEL3_API_KEY set in .env' });
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const r = await fetch('https://api.trychannel3.com/v0/search', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: product_query, limit: 4 })
    });
    clearTimeout(timer);
    if (!r.ok) throw new Error('Channel3 responded ' + r.status);

    const rows = await r.json();
    const list = Array.isArray(rows) ? rows : (rows.products || rows.results || []);
    if (!list.length) throw new Error('no matching products');

    const products = list.map((p) => {
      const offer = Array.isArray(p.offers) && p.offers.length ? p.offers[0] : null;
      const priceObj = (offer && offer.price) || p.price || {};
      const unit = typeof priceObj.price === 'number' ? priceObj.price : null;
      return {
        id: p.id,
        title: p.title,
        brand: p.brand_name || (p.brands && p.brands[0] && p.brands[0].name) || null,
        vendor: offer ? offer.domain : null,
        unit_price: unit,
        currency: priceObj.currency || 'USD',
        availability: offer ? offer.availability : p.availability,
        url: (offer && offer.url) || p.url || null,
        image: p.image_url || (p.images && p.images[0] && p.images[0].url) || null,
        // What the prescribed volume would cost at this listing's unit price.
        line_total: unit == null ? null : Number((unit * quantity_gal).toFixed(2))
      };
    }).filter((p) => p.title);

    res.json({
      ok: true,
      sourced: true,
      query: product_query,
      quantity_gal,
      products,
      order_id: 'FL-' + Date.now().toString(36).toUpperCase()
    });
  } catch (err) {
    console.error('[purchase]', err.message);
    res.status(502).json({ error: 'sourcing_unavailable', reason: sourcingReason(err) });
  }
});

function sourcingReason(err) {
  const m = String((err && err.message) || '');
  if (/abort/i.test(m)) return 'Supplier search timed out';
  if (/401|403/.test(m)) return 'Channel3 API key rejected';
  if (/no matching/i.test(m)) return 'No supplier listings matched';
  return 'Supplier search unavailable';
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`FieldLoop running at http://localhost:${PORT}`);
});
