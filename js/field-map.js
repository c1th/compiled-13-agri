// Static field map — image + absolutely-positioned zone markers.
// Positions are percentages of the container, so markers track window resize.
// y originates at the TOP of the image (contract) — never flipped.
// Used by the drones page and as the dashboard's offline map fallback.

const DIAGNOSIS_LABELS = {
  biotic_stress: 'Biotic stress (pest)',
  water_stress: 'Water stress',
  nitrogen_deficiency: 'Nitrogen deficiency'
};

function initFieldMap(data, wrapEl) {
  const wrap = wrapEl || document.getElementById('map-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';

  const img = document.createElement('img');
  img.className = 'map-image';
  img.src = 'assets/' + data.meta.image;
  img.alt = data.meta.name + ' satellite image';
  wrap.appendChild(img);

  const tooltip = document.createElement('div');
  tooltip.className = 'map-tooltip';
  wrap.appendChild(tooltip);

  for (const zone of data.zones) {
    const t = data.treatments[zone.treatment_id];
    if (!t) continue;
    const noSpray = zone.treatment_id === 'none';
    const d = Math.round(18 + zone.area_acres * 10); // px diameter, scaled by area

    const marker = document.createElement('div');
    marker.className = 'zone-marker' + (noSpray ? ' nospray' : '');
    marker.dataset.zoneId = zone.id;
    marker.style.left = (zone.x * 100) + '%';
    marker.style.top = (zone.y * 100) + '%';
    marker.style.width = d + 'px';
    marker.style.height = d + 'px';
    marker.style.borderColor = t.color;
    if (!noSpray) {
      marker.style.background = hexToRgba(t.color, 0.25 + zone.severity * 0.55);
    }

    if (noSpray) {
      const label = document.createElement('div');
      label.className = 'marker-label';
      label.textContent = 'NO SPRAY';
      label.style.color = t.color;
      marker.appendChild(label);
    }

    marker.addEventListener('mouseenter', () => showTooltip(tooltip, zone, t));
    marker.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
    wrap.appendChild(marker);
  }
}

function showTooltip(tooltip, zone, treatment) {
  const noSpray = zone.treatment_id === 'none';
  tooltip.innerHTML =
    '<div class="tip-head"><span class="num">' + zone.id + '</span> &middot; ' +
      (DIAGNOSIS_LABELS[zone.diagnosis] || zone.diagnosis) + '</div>' +
    (noSpray ? '<div class="tip-nospray">DO NOT SPRAY</div>' : '') +
    '<div class="tip-row"><span>Area</span><span class="num">' + zone.area_acres.toFixed(1) + ' ac</span></div>' +
    '<div class="tip-row"><span>Severity</span><span class="num">' + Math.round(zone.severity * 100) + '%</span></div>' +
    '<div class="tip-row"><span>NDVI anomaly</span><span class="num">' + fmtAnom(zone.ndvi_anomaly) + '</span></div>' +
    '<div class="tip-row"><span>NDMI anomaly</span><span class="num">' + fmtAnom(zone.ndmi_anomaly) + '</span></div>' +
    '<div class="tip-row"><span>Treatment</span><span>' + treatment.name + '</span></div>';

  // Flip near the right/bottom edges so the tooltip stays over the image.
  tooltip.style.left = (zone.x * 100) + '%';
  tooltip.style.top = (zone.y * 100) + '%';
  const dx = zone.x > 0.62 ? '-108%' : '8%';
  const dy = zone.y > 0.68 ? '-108%' : '8%';
  tooltip.style.transform = 'translate(' + dx + ', ' + dy + ')';
  tooltip.style.display = 'block';
}

function fmtAnom(v) {
  return (v > 0 ? '+' : '') + v.toFixed(2);
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha.toFixed(2) + ')';
}
