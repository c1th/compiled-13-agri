// Procurement panel. Consumes the diagnose() result (via the
// 'fieldloop:diagnosis' event) and POSTs to our own /api/purchase —
// server.js holds the Channel3 key; it never reaches the browser.
// If the request fails for ANY reason, fall back to a clearly-labeled
// mock confirmation after 800ms so the demo never dead-ends.

let procureDx = null;

function initProcure(data) {
  procureDx = null;
  const body = document.getElementById('procure-body');
  body.innerHTML = '<div class="procure-empty">Run a leaf diagnosis to enable ordering.</div>';
}

document.addEventListener('fieldloop:diagnosis', (e) => {
  procureDx = e.detail;
  const body = document.getElementById('procure-body');
  if (!body) return;

  const acres = DATA.summary.flagged_acres;
  const qty = Math.ceil(procureDx.rate_per_acre * acres);

  body.innerHTML =
    '<div class="procure-summary">' +
      '<div class="ag-rec-row"><span>Product</span><span>' + procureDx.recommended_biological + '</span></div>' +
      '<div class="ag-rec-row"><span>Quantity</span><span class="num">' + qty + ' gal</span> </div>' +
      '<div class="ag-rec-row"><span>Covers</span><span class="num">' + fmtNum(acres) + ' treated acres</span></div>' +
    '</div>' +
    '<button id="procure-order" class="btn">Order treatment</button>' +
    '<div id="procure-result"></div>';

  document.getElementById('procure-order').addEventListener('click', () => {
    placeOrder(procureDx.product_query, qty);
  });
});

async function placeOrder(productQuery, quantityGal) {
  const btn = document.getElementById('procure-order');
  const result = document.getElementById('procure-result');
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
    console.warn('[FieldLoop] live purchase failed, using mock confirmation:', err);
    await new Promise((resolve) => setTimeout(resolve, 800));
    renderOrder(result, {
      product: productQuery,
      price: (quantityGal * 12.4).toFixed(2),
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
      '<div class="ag-rec-row"><span>Product</span><span>' + order.product + '</span></div>' +
      '<div class="ag-rec-row"><span>Quantity</span><span class="num">' + order.quantity_gal + ' gal</span></div>' +
      '<div class="ag-rec-row"><span>Price</span><span class="num">' + price + '</span></div>' +
      '<div class="ag-rec-row"><span>Order ID</span><span class="num">' + order.order_id + '</span></div>' +
    '</div>';
}
