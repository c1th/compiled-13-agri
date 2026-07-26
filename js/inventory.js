// Pesticide inventory panel — what we have on hand. Feeds the analysis
// layer, which may only assign treatments from this list.

const INVENTORY_COLORS = ['#7B4B94', '#E8A33D', '#5AD4C8', '#D07EA8', '#8FBF6F', '#C2B25A'];

let inventoryItems = [
  { id: 'beauveria', name: 'Beauveria bassiana', rate: 1.5, gallons: 24 },
  { id: 'bt', name: 'Bacillus thuringiensis', rate: 1.0, gallons: 30 }
];

function initInventory() {
  const saved = sessionStorage.getItem('fieldloop_inventory');
  if (saved) {
    try { inventoryItems = JSON.parse(saved); } catch (_e) { /* keep defaults */ }
  }
  renderInventory();
}

function renderInventory() {
  const body = document.getElementById('inventory-body');
  body.innerHTML = '';

  inventoryItems.forEach((item, i) => {
    const row = document.createElement('div');
    row.className = 'inv-row';
    row.innerHTML =
      '<span class="legend-swatch" style="background:' + invColor(i) + '"></span>' +
      '<input class="inv-input inv-name" data-i="' + i + '" data-k="name" value="' + escapeAttr(item.name) + '">' +
      '<input class="inv-input inv-num num" data-i="' + i + '" data-k="rate" type="number" step="0.1" min="0.1" value="' + item.rate + '" title="gal/acre">' +
      '<span class="inv-unit">gal/ac</span>' +
      '<input class="inv-input inv-num num" data-i="' + i + '" data-k="gallons" type="number" step="1" min="0" value="' + item.gallons + '" title="gallons on hand">' +
      '<span class="inv-unit">gal</span>' +
      '<button class="inv-remove" data-i="' + i + '" title="Remove">&times;</button>';
    body.appendChild(row);
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'btn inv-add';
  addBtn.textContent = '+ Add pesticide';
  addBtn.onclick = () => {
    inventoryItems.push({ id: 'p' + Date.now().toString(36), name: 'New biological', rate: 1.0, gallons: 10 });
    saveInventory();
    renderInventory();
  };
  body.appendChild(addBtn);

  body.querySelectorAll('.inv-input').forEach((input) => {
    input.addEventListener('change', () => {
      const item = inventoryItems[Number(input.dataset.i)];
      const key = input.dataset.k;
      item[key] = key === 'name' ? input.value : Number(input.value) || 0;
      saveInventory();
    });
  });
  body.querySelectorAll('.inv-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (inventoryItems.length <= 1) return; // keep at least one product
      inventoryItems.splice(Number(btn.dataset.i), 1);
      saveInventory();
      renderInventory();
    });
  });
}

function getInventory() {
  return inventoryItems.map((item, i) => ({
    id: item.id,
    name: item.name,
    rate: item.rate,
    gallons: item.gallons,
    color: invColor(i)
  }));
}

function invColor(i) {
  return INVENTORY_COLORS[i % INVENTORY_COLORS.length];
}

function saveInventory() {
  sessionStorage.setItem('fieldloop_inventory', JSON.stringify(inventoryItems));
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
