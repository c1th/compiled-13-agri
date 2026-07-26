// Procurement panel. Orders come straight from the field data: one line
// per treated product, quantity = sum of that group's zone volumes.
// POSTs to our own /api/purchase. If the request fails for ANY reason,
// fall back to a clearly-labeled mock confirmation after 800ms so the
// demo never dead-ends.

function initProcure(data) {
  const body = document.getElementById('procure-body');
  body.innerHTML = '';

  // On-hand stock from the pesticide shed (js/shed.js) nets down the order —
  // it never changes what or how much the plan prescribes.
  const shedItems = (typeof getShedInventory === 'function') ? getShedInventory() : [];
  const onHandFor = (key, name) => shedItems
    .filter((i) => i.catalog_id === key || i.name.toLowerCase() === name.toLowerCase())
    .reduce((sum, i) => sum + i.qty_gal, 0);

  const groups = Object.keys(data.treatments)
    .filter((k) => k !== 'none' && data.zones.some((z) => z.treatment_id === k))
    .map((key) => {
      const t = data.treatments[key];
      const zones = data.zones.filter((z) => z.treatment_id === key);
      const need = Math.ceil(zones.reduce((sum, z) => sum + z.volume_gal, 0));
      const have = onHandFor(key, t.name);
      return {
        key,
        name: t.name,
        color: t.color,
        zones: zones.length,
        need,
        have,
        qty: Math.max(0, Math.ceil(need - have))
      };
    });

  for (const g of groups) {
    const row = document.createElement('div');
    row.className = 'procure-row';
    const haveNote = g.have > 0
      ? ' &middot; <span class="num">' + Number(g.have.toFixed(1)) + '</span> gal in shed'
      : '';
    row.innerHTML =
      '<div class="procure-info">' +
        '<span class="legend-swatch" style="background:' + g.color + '"></span>' +
        '<span class="procure-name">' + g.name + '</span>' +
        '<span class="procure-qty"><span class="num">' + g.need + '</span> gal needed' + haveNote +
          ' &middot; <span class="num">' + g.zones + '</span> zones</span>' +
      '</div>' +
      (g.qty > 0
        ? '<button class="btn procure-order">Order <span class="num">' + g.qty + '</span> gal</button>'
        : '<span class="procure-covered">Covered from your shed &mdash; nothing to order</span>') +
      '<div class="procure-result"></div>';

    const orderBtn = row.querySelector('.procure-order');
    if (orderBtn) {
      orderBtn.addEventListener('click', () => placeOrder(row, g.name, g.qty));
    }
    body.appendChild(row);
  }
}

async function placeOrder(row, productQuery, quantityGal) {
  const btn = row.querySelector('.procure-order');
  const result = row.querySelector('.procure-result');
  const idleLabel = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = 'Sourcing…';
  result.innerHTML = '<div class="sourcing-note">Searching supplier catalog for ' +
    escapeText(productQuery) + '…</div>';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch('/api/purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_query: productQuery, quantity_gal: quantityGal }),
      signal: controller.signal
    });
    clearTimeout(timer);
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.reason || 'sourcing responded ' + res.status);
    renderListings(result, payload, quantityGal);
  } catch (err) {
    console.warn('[FieldLoop] supplier sourcing failed, showing local quote:', err);
    await new Promise((resolve) => setTimeout(resolve, 800));
    renderQuote(result, productQuery, quantityGal, err.message || 'supplier search unavailable');
  }

  btn.disabled = false;
  btn.innerHTML = idleLabel;
}

// Real supplier listings from Channel3: brand, live price, stock, buy link.
function renderListings(container, payload, quantityGal) {
  const products = payload.products || [];
  if (!products.length) {
    renderQuote(container, payload.query, quantityGal, 'no supplier listings matched');
    return;
  }

  const rows = products.map((p) => {
    const unit = p.unit_price == null ? null : money(p.unit_price);
    const line = p.line_total == null ? null : money(p.line_total);
    const inStock = String(p.availability || '').toLowerCase().indexOf('instock') >= 0;
    return '<div class="listing">' +
      (p.image ? '<img class="listing-img" src="' + escapeAttr(p.image) + '" alt="">' : '<span class="listing-img placeholder"></span>') +
      '<div class="listing-main">' +
        '<div class="listing-title">' + escapeText(p.title) + '</div>' +
        '<div class="listing-meta">' +
          (p.brand ? escapeText(p.brand) : 'Unbranded') +
          (p.vendor ? ' · ' + escapeText(p.vendor) : '') +
          ' · <span class="' + (inStock ? 'stock-in' : 'stock-out') + '">' +
            (inStock ? 'In stock' : 'Out of stock') + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="listing-price">' +
        '<div class="num">' + (unit || '—') + '</div>' +
        '<div class="listing-line num">' + (line ? line + ' for ' + quantityGal + ' gal' : '') + '</div>' +
      '</div>' +
      (p.url ? '<a class="btn listing-buy" href="' + escapeAttr(p.url) + '" target="_blank" rel="noopener">Buy</a>' : '') +
    '</div>';
  }).join('');

  container.innerHTML =
    '<div class="order-card">' +
      '<div class="order-head">' + products.length + ' supplier ' +
        (products.length === 1 ? 'listing' : 'listings') +
        '<span class="src-badge">Channel3</span>' +
      '</div>' +
      '<div class="listings">' + rows + '</div>' +
      '<div class="kv-row"><span>Reference</span><span class="num">' + escapeText(payload.order_id || '—') + '</span></div>' +
    '</div>';
}

// No live sourcing available — show what the plan calls for so the demo can
// continue, clearly marked as an estimate rather than a real listing.
function renderQuote(container, productQuery, quantityGal, why) {
  container.innerHTML =
    '<div class="order-card">' +
      '<div class="order-head">Estimated requirement' +
        '<span class="mock-badge">Not a live listing</span>' +
      '</div>' +
      '<div class="kv-row"><span>Product</span><span>' + escapeText(productQuery) + '</span></div>' +
      '<div class="kv-row"><span>Quantity</span><span class="num">' + quantityGal + ' gal</span></div>' +
      '<div class="kv-row"><span>Indicative cost</span><span class="num">' + money(quantityGal * 12.4) + '</span></div>' +
      '<div class="tb-why">' + escapeText(why) + '</div>' +
    '</div>';
}

function money(v) {
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeText(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return escapeText(s).replace(/"/g, '&quot;');
}
