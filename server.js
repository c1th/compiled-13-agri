require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(express.json());

// js/config.js holds local Earth Engine credentials and is gitignored, so a
// fresh clone won't have it. Serve a blank config instead of 404ing — a clean
// load must have no console errors. Registered before express.static so this
// wins when the file is absent.
app.get('/js/config.js', (_req, res) => {
  const local = path.join(__dirname, 'js', 'config.js');
  if (fs.existsSync(local)) return res.sendFile(local);
  res.type('application/javascript')
    .send('// No js/config.js — copy js/config.example.js to enable Earth Engine.\n' +
          'window.FIELDLOOP_CONFIG = { EE_CLIENT_ID: "", EE_PROJECT: "" };\n');
});

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
  required: ['summary', 'zones'],
  properties: {
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

// Analysis layer: region bounds -> FIELD-shaped plan. Claude diagnoses each
// zone and recommends the OPTIMAL biological for it, unconstrained by stock —
// whatever the plan calls for is what gets ordered. Any failure returns 502
// and the browser falls back to a local mock so the demo never dead-ends.
app.post('/api/analyze', async (req, res) => {
  const { bounds, total_acres } = req.body || {};
  if (!Array.isArray(bounds) || bounds.length !== 4) {
    return res.status(400).json({ error: 'bounds [W,S,E,N] required' });
  }

  const catalogDesc = BIOLOGICAL_CATALOG
    .map((p) => `- id "${p.id}": ${p.name}, label rate ${p.rate_gal_per_acre} gal/acre — effective against ${p.targets}`)
    .join('\n');

  const prompt = `You are the diagnosis layer of FieldLoop, a precision-agriculture system.
Satellite imagery flagged crop-stress zones in a field. Your job: produce a realistic
treatment plan that separates pest pressure (treatable) from irrigation/nitrogen issues
(must NOT be sprayed), and prescribe the single best-matched biological for each pest zone.

Region bounds [W,S,E,N]: ${JSON.stringify(bounds)} (~${Math.round(total_acres || 160)} acres of row crops, Iowa, late July).

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
    res.status(502).json({ error: 'analysis_failed' });
  }
});

// Order confirmation endpoint. Fully local — no external supplier API.
app.post('/api/purchase', (req, res) => {
  const { product_query, quantity_gal } = req.body || {};
  if (!product_query || !quantity_gal) {
    return res.status(400).json({ error: 'product_query and quantity_gal required' });
  }
  res.json({
    ok: true,
    product: product_query,
    price: Number((quantity_gal * 12.4).toFixed(2)),
    order_id: 'FL-' + Date.now().toString(36).toUpperCase(),
    quantity_gal
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`FieldLoop running at http://localhost:${PORT}`);
});
