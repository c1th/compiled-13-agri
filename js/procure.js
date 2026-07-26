// Procurement panel. Orders come straight from the field data: one line
// per treated product, quantity = sum of that group's zone volumes.
// POSTs to our own /api/purchase. If the request fails for ANY reason,
// fall back to a clearly-labeled mock confirmation after 800ms so the
// demo never dead-ends.

function initProcure(data) {
  const body = document.getElementById('procure-body');
  body.innerHTML = '';

  const groups = Object.keys(data.treatments)
    .filter((k) => k !== 'none' && data.zones.some((z) => z.treatment_id === k))
    .map((key) => {
      const t = data.treatments[key];
      const zones = data.zones.filter((z) => z.treatment_id === key);
      return {
        key,
        name: t.name,
        color: t.color,
        zones: zones.length,
        qty: Math.ceil(zones.reduce((sum, z) => sum + z.volume_gal, 0))
      };
    });

  for (const g of groups) {
    const row = document.createElement('div');
    row.className = 'procure-row';
    row.innerHTML =
      '<div class="procure-info">' +
        '<span class="legend-swatch" style="background:' + g.color + '"></span>' +
        '<span class="procure-name">' + g.name + '</span>' +
        '<span class="procure-qty"><span class="num">' + g.qty + '</span> gal &middot; <span class="num">' +
          g.zones + '</span> zones</span>' +
      '</div>' +
      '<button class="btn procure-order">Order treatment</button>' +
      '<div class="procure-result"></div>';

    row.querySelector('.procure-order').addEventListener('click', () => {
      placeOrder(row, g.name, g.qty);
    });
    body.appendChild(row);
  }
}

async function placeOrder(row, productQuery, quantityGal) {
  const btn = row.querySelector('.procure-order');
  const result = row.querySelector('.procure-result');
  btn.disabled = true;
  btn.textContent = 'Ordering…';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch('/api/purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_query: productQuery, quantity_gal: quantityGal }),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error('purchase endpoint responded ' + res.status);
    const order = await res.json();
    renderOrder(result, order, false);
  } catch (err) {
    console.warn('[FieldLoop] purchase call failed, using mock confirmation:', err);
    await new Promise((resolve) => setTimeout(resolve, 800));
    renderOrder(result, {
      product: productQuery,
      price: Number((quantityGal * 12.4).toFixed(2)),
      order_id: 'FL-MOCK-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
      quantity_gal: quantityGal
    }, true);
  }

  btn.disabled = false;
  btn.textContent = 'Order treatment';
}

function renderOrder(container, order, isMock) {
  const price = order.price != null
    ? '$' + Number(order.price).toLocaleString('en-US', { minimumFractionDigits: 2 })
    : 'Quoted at checkout';
  container.innerHTML =
    '<div class="order-card">' +
      '<div class="order-head">Order confirmed' +
        (isMock ? '<span class="mock-badge">Simulated &mdash; offline mode</span>' : '') +
      '</div>' +
      '<div class="kv-row"><span>Product</span><span>' + order.product + '</span></div>' +
      '<div class="kv-row"><span>Quantity</span><span class="num">' + order.quantity_gal + ' gal</span></div>' +
      '<div class="kv-row"><span>Price</span><span class="num">' + price + '</span></div>' +
      '<div class="kv-row"><span>Order ID</span><span class="num">' + order.order_id + '</span></div>' +
    '</div>';
}
