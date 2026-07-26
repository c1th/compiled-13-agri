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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`FieldLoop running at http://localhost:${PORT}`);
});
