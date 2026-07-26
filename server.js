require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
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
