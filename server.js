require('dotenv').config();
const express = require('express');
const path = require('path');

// node-fetch v3 is ESM-only; this shim keeps server.js plain CommonJS.
const fetch = (...args) => import('node-fetch').then((m) => m.default(...args));

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Proxies the purchase to Channel3. The API key stays server-side only.
app.post('/api/purchase', async (req, res) => {
  const { product_query, quantity_gal } = req.body || {};
  const key = process.env.CHANNEL3_API_KEY;
  if (!key) {
    return res.status(503).json({ error: 'CHANNEL3_API_KEY not configured' });
  }
  try {
    const r = await fetch('https://api.trychannel3.com/v0/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({ query: product_query, limit: 1 })
    });
    if (!r.ok) throw new Error('Channel3 responded ' + r.status);
    const data = await r.json();
    const products = Array.isArray(data) ? data : data.products || data.results || [];
    const p = products[0];
    if (!p) throw new Error('Channel3 returned no products');
    const rawPrice = p.price && typeof p.price === 'object' ? p.price.price : p.price;
    res.json({
      ok: true,
      product: p.title || p.name || product_query,
      price: rawPrice != null ? rawPrice : null,
      order_id: 'FL-' + Date.now().toString(36).toUpperCase(),
      quantity_gal
    });
  } catch (err) {
    console.error('[purchase]', err.message);
    res.status(502).json({ error: 'purchase_failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`FieldLoop running at http://localhost:${PORT}`);
});
