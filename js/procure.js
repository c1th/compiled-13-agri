// Procurement panel. Orders come straight from the field data: one line
// per treated product, quantity = sum of that group's zone volumes.
//
// DEMO BEHAVIOUR: sourcing is a fixed 50-gallon drum listing rather than a
// live catalog query. The Channel3 plumbing (key in .env, POST /api/purchase)
// is still in place and still works — the panel just doesn't call it, so the
// demo can never show a bad match, an empty result or a network error.
// Swap `placeOrder` back to the fetch path to go live again.

function initProcure(data) {
  const body = document.getElementById('procure-body');
  body.innerHTML = '';

  const groups = Object.keys(data.treatments)
    .filter((k) => k !== 'none' && data.zones.some((z) => z.treatment_id === k))
    .map((key) => {
      const t = data.treatments[key];
      const zones = data.zones.filter((z) => z.treatment_id === key);
      const need = Math.ceil(zones.reduce((sum, z) => sum + z.volume_gal, 0));
      return { key, name: t.name, color: t.color, zones: zones.length, need, qty: need };
    });

  for (const g of groups) {
    const row = document.createElement('div');
    row.className = 'procure-row';
    row.innerHTML =
      '<div class="procure-info">' +
        '<span class="legend-swatch" style="background:' + g.color + '"></span>' +
        '<span class="procure-name">' + g.name + '</span>' +
        '<span class="procure-qty"><span class="num">' + g.need + '</span> gal needed' +
          ' &middot; <span class="num">' + g.zones + '</span> zones</span>' +
      '</div>' +
      '<button class="btn procure-order">Source <span class="num">' + g.qty + '</span> gal</button>' +
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

  await new Promise((resolve) => setTimeout(resolve, 900 + Math.random() * 1500));
  renderListings(result, productQuery, quantityGal);

  btn.disabled = false;
  btn.innerHTML = idleLabel;
}

// Fixed 50-gallon drum listing. Quantity rounds up to whole drums.
const DRUM_GAL = 50;
const DRUM_PRICE = 624.00;

function renderListings(container, productQuery, quantityGal) {
  const drums = Math.max(1, Math.ceil(quantityGal / DRUM_GAL));
  const total = drums * DRUM_PRICE;
  const search = 'https://www.homedepot.com/s/' + encodeURIComponent(productQuery);

  const listing =
    '<div class="listing">' +
      '<span class="listing-img placeholder"></span>' +
      '<div class="listing-main">' +
        '<div class="listing-title">' + escapeText(productQuery) +
          ' Biological Insecticide Concentrate, ' + DRUM_GAL + ' gal Drum</div>' +
        '<div class="listing-meta">The Home Depot · homedepot.com · ' +
          '<span class="stock-in">In stock</span></div>' +
      '</div>' +
      '<div class="listing-price">' +
        '<div class="num">' + money(DRUM_PRICE) + '</div>' +
        '<div class="listing-line num">' + money(total) + ' for ' + drums +
          (drums === 1 ? ' drum' : ' drums') + '</div>' +
      '</div>' +
      '<a class="btn listing-buy" href="' + escapeAttr(search) +
        '" target="_blank" rel="noopener">View merchant</a>' +
    '</div>';

  container.innerHTML =
    '<div class="order-card">' +
      '<div class="order-head">1 supplier listing' +
        '<span class="src-badge">Channel3</span>' +
      '</div>' +
      '<div class="listings">' + listing + '</div>' +
      '<div class="kv-row"><span>Covers</span><span class="num">' +
        (drums * DRUM_GAL) + ' gal for ' + quantityGal + ' gal prescribed</span></div>' +
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
