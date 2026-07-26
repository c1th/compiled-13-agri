require('dotenv').config();
const express = require('express');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

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
          treatment_id: { type: 'string' },
          volume_gal: { type: 'number' },
          priority: { type: 'integer' }
        }
      }
    }
  }
};

// Analysis layer: region bounds + pesticide inventory -> FIELD-shaped plan.
// Claude generates the zone diagnosis; any failure returns 502 and the
// browser falls back to a local mock so the demo never dead-ends.
app.post('/api/analyze', async (req, res) => {
  const { bounds, total_acres, inventory } = req.body || {};
  if (!Array.isArray(bounds) || bounds.length !== 4 || !Array.isArray(inventory) || inventory.length === 0) {
    return res.status(400).json({ error: 'bounds [W,S,E,N] and non-empty inventory required' });
  }

  const inventoryDesc = inventory
    .map((p) => `- id "${p.id}": ${p.name}, ${p.rate} gal/acre, ${p.gallons} gal on hand`)
    .join('\n');

  const prompt = `You are the diagnosis layer of FieldLoop, a precision-agriculture system.
Satellite imagery flagged crop-stress zones in a field. Your job: produce a realistic
treatment plan that separates pest pressure (treatable) from irrigation/nitrogen issues
(must NOT be sprayed).

Region bounds [W,S,E,N]: ${JSON.stringify(bounds)} (~${Math.round(total_acres || 160)} acres of row crops, Iowa, late July).
Pesticide inventory (biologicals) available:
${inventoryDesc}

Generate 11-14 stress zones:
- 70-80% diagnosed "biotic_stress": assign a treatment_id from the inventory ids above,
  volume_gal = area_acres x that product's rate. NDVI anomaly negative, NDMI near normal.
- 20-30% diagnosed "water_stress" (NDMI strongly negative) or "nitrogen_deficiency"
  (NDMI normal, NDRE-driven): treatment_id "none", volume_gal 0.
- x,y in 0..1 relative to the region, ORIGIN TOP-LEFT (x: west->east, y: north->south),
  spread out, no overlaps. lon/lat must be consistent with x,y inside the bounds.
- severity 0..1; area_acres 0.6-2.5; priority 1..N ranked by severity.
- Total treated acres should be roughly 8-10% of the region.
summary: total_acres = region size; flagged_acres = treated (biotic) acres only;
pct_flagged = flagged/total x100 (1dp); pct_reduction = 100 - pct_flagged (integer);
dollars_saved = (total_acres - flagged_acres) x 34, rounded.
Do not exceed on-hand gallons for any product.`;

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

    const treatments = {};
    for (const p of inventory) {
      treatments[p.id] = { name: p.name, rate_gal_per_acre: p.rate, color: p.color };
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
