// Map panel: Leaflet (vendored) over satellite imagery, with spectral band
// views computed live from the tiles themselves (see js/bands.js) — no sign-in
// and no external analysis service.
// Region input: "Add region" then two clicks = rectangle corners; repeat to
// survey several areas at once.
// If Leaflet/tiles are unavailable (offline), falls back to the static
// field.png render so the demo never blanks.

let lmap = null;
let regions = [];          // [{ id, label, bounds:[W,S,E,N], rect }]
let regionSeq = 0;
let drawCorner = null;     // first click while drawing
let drawing = false;
let zoneLayers = [];
let baseLayer = null;
let treatmentOverlays = [];
let mapData = null;

function initMapPanel(data) {
  mapData = data;
  document.getElementById('field-name').textContent = data.meta.name;
  document.getElementById('field-date').textContent = data.meta.date;
  const container = document.getElementById('gee-map');

  if (!regions.length) addRegion(data.meta.bounds.slice());

  try {
    if (typeof L === 'undefined') throw new Error('Leaflet not available');
    if (lmap) { lmap.remove(); lmap = null; }
    container.innerHTML = '';
    lmap = L.map(container, { zoomSnap: 0.25 });
    baseLayer = createBandLayer(currentBandId);
    baseLayer.addTo(lmap);
    fitAllRegions();
    drawRegionRects();
    renderZonesOnMap(data);
    lmap.on('click', onMapClick);
    setMapStatus('Search a location or draw a region to begin.');
  } catch (err) {
    console.warn('[FieldLoop] map fallback to static image:', err.message);
    renderStaticFallback(container, data);
    setMapStatus('Offline mode \u2014 static imagery');
  }

  renderMapLegend(data);
  populateBandSelect();
  renderBandScale();
  initSearch();
  renderRegionList();
  updateRegionReadout();

  const drawBtn = document.getElementById('draw-region');
  const clearBtn = document.getElementById('clear-regions');
  if (drawBtn) drawBtn.onclick = toggleDraw;
  if (clearBtn) clearBtn.onclick = clearRegions;
}

// ---------- Regions (one or many) ----------

function addRegion(bounds) {
  regionSeq += 1;
  regions.push({ id: 'R' + regionSeq, label: 'R' + regionSeq, bounds, rect: null });
  return regions[regions.length - 1];
}

function removeRegion(id) {
  const i = regions.findIndex((r) => r.id === id);
  if (i < 0) return;
  if (regions[i].rect) regions[i].rect.remove();
  regions.splice(i, 1);
  if (!regions.length) addRegion(defaultBounds());
  drawRegionRects();
  invalidatePlan();
}

function clearRegions() {
  for (const r of regions) if (r.rect) r.rect.remove();
  regions = [];
  regionSeq = 0;
  addRegion(defaultBounds());
  drawRegionRects();
  fitAllRegions();
  invalidatePlan();
  setMapStatus('');
}

// Full reset for a second demo run (the "R" key).
function resetRegions() {
  for (const r of regions) if (r.rect) r.rect.remove();
  regions = [];
  regionSeq = 0;
  regionsUserDrawn = false;
}

function defaultBounds() {
  if (mapData && mapData.meta && mapData.meta.bounds) return mapData.meta.bounds.slice();
  return [-93.652, 41.987, -93.618, 42.001];
}

// Regions changed, so any existing plan describes different ground.
function invalidatePlan() {
  if (typeof clearPlan === 'function') clearPlan();
  renderRegionList();
  updateRegionReadout();
}

function unionBounds() {
  const w = Math.min.apply(null, regions.map((r) => r.bounds[0]));
  const s = Math.min.apply(null, regions.map((r) => r.bounds[1]));
  const e = Math.max.apply(null, regions.map((r) => r.bounds[2]));
  const n = Math.max.apply(null, regions.map((r) => r.bounds[3]));
  return [w, s, e, n];
}

function fitAllRegions() {
  const [w, s, e, n] = unionBounds();
  lmap.fitBounds([[s, w], [n, e]], { padding: [24, 24] });
}

function drawRegionRects() {
  for (const r of regions) {
    if (r.rect) r.rect.remove();
    const [w, s, e, n] = r.bounds;
    r.rect = L.rectangle([[s, w], [n, e]], {
      color: '#4ADE80', weight: 2, fill: false, dashArray: '6 4', interactive: false
    }).addTo(lmap);
    if (regions.length > 1) {
      r.rect.bindTooltip(r.label, {
        permanent: true, direction: 'top', className: 'region-tag', offset: [0, -2]
      });
    }
  }
}

function toggleDraw() {
  drawing = !drawing;
  drawCorner = null;
  const btn = document.getElementById('draw-region');
  btn.textContent = drawing ? 'Click two corners\u2026' : 'Add region';
  if (lmap) lmap.getContainer().style.cursor = drawing ? 'crosshair' : '';
  if (drawing) setMapStatus('Click one corner of the area to survey, then the opposite corner.');
}

function onMapClick(evt) {
  // Origin picking takes precedence over region drawing.
  if (originPick) {
    const cb = originPick;
    originPick = null;
    if (lmap) lmap.getContainer().style.cursor = '';
    cb(evt.latlng.lat, evt.latlng.lng);
    return;
  }
  if (!drawing) return;
  if (!drawCorner) {
    drawCorner = evt.latlng;
    setMapStatus('Corner set \u2014 click the opposite corner.');
    return;
  }
  const a = drawCorner, b = evt.latlng;
  const bounds = [
    Math.min(a.lng, b.lng), Math.min(a.lat, b.lat),
    Math.max(a.lng, b.lng), Math.max(a.lat, b.lat)
  ];
  drawCorner = null;
  toggleDraw();

  // First draw replaces the seeded default; later draws add alongside.
  if (regions.length === 1 && !regionsUserDrawn) {
    regions[0].bounds = bounds;
  } else {
    addRegion(bounds);
  }
  regionsUserDrawn = true;

  drawRegionRects();
  probeRegion(regions[regions.length - 1]);
  invalidatePlan();
  setMapStatus('');
}

let regionsUserDrawn = false;
let originPick = null;
let routeLayers = [];

// ---------- Drone origin picking + route overlay ----------

// Arm the map so the next click reports a lat/lon back to the caller.
function armOriginPick(callback) {
  originPick = callback;
  if (lmap) lmap.getContainer().style.cursor = 'crosshair';
  setMapStatus('Click the map to set the launch point.');
}

function cancelOriginPick() {
  originPick = null;
  if (lmap) lmap.getContainer().style.cursor = '';
}

// Convert a normalised 0..1 field position (origin top-left) to lat/lon.
function fieldToLatLng(x, y) {
  const [w, s, e, n] = unionBounds();
  return [n - y * (n - s), w + x * (e - w)];
}

// Convert a map lat/lon to normalised 0..1 field position.
function latLngToField(lat, lon) {
  const [w, s, e, n] = unionBounds();
  return {
    x: e === w ? 0.5 : Math.min(1, Math.max(0, (lon - w) / (e - w))),
    y: n === s ? 0.5 : Math.min(1, Math.max(0, (n - lat) / (n - s)))
  };
}

function clearDroneRoutes() {
  for (const l of routeLayers) l.remove();
  routeLayers = [];
}

// Draw each drone's launch point and the ordered path it flies.
function drawDroneRoutes(result) {
  if (!lmap || !result) return;
  clearDroneRoutes();
  const palette = (typeof SWARM_COLORS !== 'undefined' && SWARM_COLORS.length)
    ? SWARM_COLORS
    : ['#5AD4C8', '#EC6B64', '#D0A5E8', '#8FBF6F', '#F2D857', '#7FA8F5'];

  result.drones.forEach((d, i) => {
    const color = palette[i % palette.length];
    const home = fieldToLatLng(d.home.x, d.home.y);

    const marker = L.circleMarker(home, {
      radius: 7, color: '#0F1419', weight: 2,
      fill: true, fillColor: color, fillOpacity: 1
    }).addTo(lmap);
    marker.bindTooltip(d.id + ' launch · ' + d.carries, { className: 'map-tooltip-leaflet' });
    routeLayers.push(marker);

    if (!d.route.length) return;
    const path = [home].concat(d.route.map((stop) => [stop.lat, stop.lon]));
    routeLayers.push(L.polyline(path, {
      color, weight: 2.5, opacity: 0.9, dashArray: '6 5', interactive: false
    }).addTo(lmap));

    d.route.forEach((stop, idx) => {
      const stopMarker = L.circleMarker([stop.lat, stop.lon], {
        radius: 5, color, weight: 2, fill: true, fillColor: '#0F1419', fillOpacity: 0.95
      }).addTo(lmap);
      stopMarker.bindTooltip(
        d.id + ' · stop ' + (idx + 1) + ' of ' + d.route.length + '<br>' +
        stop.zone_id + ' · ' + stop.volume_gal.toFixed(2) + ' gal',
        { className: 'map-tooltip-leaflet' });
      routeLayers.push(stopMarker);
    });
  });
}

// Every drawn region, plus whatever the land-cover probe found, for the
// analysis layer.
function getRegions() {
  return regions.map((r) => ({
    id: r.id, label: r.label, bounds: r.bounds.slice(), probe: r.probe || null
  }));
}

// Short land-cover chip for a region row.
function coverTag(r) {
  if (r.probing) return '<span class="cover-tag pending">checking…</span>';
  if (!r.probe) return '';
  const cls = r.probe.plantable ? 'cover-tag ok' : 'cover-tag bad';
  const pct = r.probe.vegFraction == null ? '' : ' ' + Math.round(r.probe.vegFraction * 100) + '% green';
  return '<span class="' + cls + '" title="' + r.probe.note + '">' + r.probe.cover + pct + '</span>';
}

// Union of all regions — the extent the merged plan is expressed in.
function getRegionBounds() { return unionBounds(); }

function acresOf(bounds) {
  const [w, s, e, n] = bounds;
  const latM = (n - s) * 111320;
  const lonM = (e - w) * 111320 * Math.cos(((n + s) / 2) * Math.PI / 180);
  return Math.max(1, (latM * lonM) / 4046.86);
}

// Combined surveyed area across every region.
function regionAcres() {
  return regions.reduce((sum, r) => sum + acresOf(r.bounds), 0);
}

// One row per region: label, bounds, acreage, remove.
function renderRegionList() {
  const el = document.getElementById('region-list');
  if (!el) return;
  el.innerHTML = '';
  for (const r of regions) {
    const [w, s, e, n] = r.bounds;
    const row = document.createElement('div');
    row.className = 'region-row';
    row.innerHTML =
      '<span class="region-badge num">' + r.label + '</span>' +
      '<span class="region-coords num">' + s.toFixed(4) + ', ' + w.toFixed(4) +
        '  \u2192  ' + n.toFixed(4) + ', ' + e.toFixed(4) + '</span>' +
      '<span class="region-acres num">' + Math.round(acresOf(r.bounds)).toLocaleString('en-US') + ' ac</span>' +
      coverTag(r) +
      '<button class="inv-remove" data-id="' + r.id + '" title="Remove region">&times;</button>';
    el.appendChild(row);
  }
  el.querySelectorAll('.inv-remove').forEach((btn) => {
    btn.addEventListener('click', () => removeRegion(btn.dataset.id));
  });
}

// Total surveyed area and, once analysed, how much of it gets treated.
function updateRegionReadout() {
  const el = document.getElementById('region-readout');
  if (!el) return;
  const parts = [
    regions.length + (regions.length === 1 ? ' region' : ' regions'),
    'Total field ' + Math.round(regionAcres()).toLocaleString('en-US') + ' ac'
  ];
  if (mapData && mapData.summary && mapData.summary.flagged_acres) {
    const s0 = mapData.summary;
    parts.push('Acres treated ' + s0.flagged_acres.toLocaleString('en-US') + ' ac (' + s0.pct_flagged + '%)');
    parts.push('Untreated ' + Math.max(0, Math.round(s0.total_acres - s0.flagged_acres)).toLocaleString('en-US') + ' ac');
  }
  el.textContent = parts.join('  \u00b7  ');
}

// Treatment renders as a weighted density field (see js/weighted-map.js), not
// as discrete circles. Do-not-spray zones keep a dashed outline so the
// diagnosis result stays unmistakable; treated zones get an invisible marker
// purely as a hover target for the tooltip.
function renderZonesOnMap(data) {
  if (!lmap) return;
  mapData = data;
  for (const layer of zoneLayers) layer.remove();
  zoneLayers = [];
  for (const o of treatmentOverlays) o.remove();
  treatmentOverlays = [];

  // One raster per region, each rendered in its own local grid so cell size
  // stays consistent regardless of how far apart the regions are.
  for (const r of regions) {
    const [w, s, e, n] = r.bounds;
    const inRegion = (z) => z.lon >= w && z.lon <= e && z.lat >= s && z.lat <= n;
    if (!data.zones.some((z) => z.treatment_id !== 'none' && inRegion(z))) continue;
    try {
      const url = treatmentCanvasUrl(data, { bounds: r.bounds, zoneFilter: inRegion });
      treatmentOverlays.push(
        L.imageOverlay(url, [[s, w], [n, e]], {
          opacity: 0.88, interactive: false, className: 'treatment-overlay'
        }).addTo(lmap)
      );
    } catch (err) {
      console.warn('[FieldLoop] treatment overlay failed for ' + r.id + ':', err);
    }
  }

  for (const zone of data.zones) {
    const t = data.treatments[zone.treatment_id];
    if (!t) continue;
    const noSpray = zone.treatment_id === 'none';
    const marker = L.circleMarker([zone.lat, zone.lon], noSpray
      ? { radius: 9 + zone.area_acres * 3, color: t.color, weight: 2, dashArray: '5 4', fill: false }
      // invisible hit target — the heatmap is the visual
      : { radius: 8 + zone.area_acres * 3, stroke: false, fill: true, fillOpacity: 0.01 }
    ).addTo(lmap);
    marker.bindTooltip(zoneTooltipHtml(zone, t), { className: 'map-tooltip-leaflet', sticky: true });
    zoneLayers.push(marker);
  }

  updateRegionReadout();
}

function zoneTooltipHtml(zone, treatment) {
  const noSpray = zone.treatment_id === 'none';
  return '<div class="tip-head">' + zone.id + ' &middot; ' + (DIAGNOSIS_LABELS[zone.diagnosis] || zone.diagnosis) + '</div>' +
    (noSpray ? '<div class="tip-nospray">DO NOT SPRAY</div>' : '') +
    '<div class="tip-row"><span>Area</span><span class="num">' + zone.area_acres.toFixed(1) + ' ac</span></div>' +
    '<div class="tip-row"><span>Severity</span><span class="num">' + Math.round(zone.severity * 100) + '%</span></div>' +
    '<div class="tip-row"><span>NDVI / NDMI</span><span class="num">' + fmtAnom(zone.ndvi_anomaly) + ' / ' + fmtAnom(zone.ndmi_anomaly) + '</span></div>' +
    '<div class="tip-row"><span>Treatment</span><span>' + treatment.name + '</span></div>';
}

function renderMapLegend(data) {
  const legend = document.getElementById('map-legend');
  if (!legend) return;
  legend.innerHTML = '';
  for (const key of Object.keys(data.treatments)) {
    const t = data.treatments[key];
    if (key !== 'none' && !data.zones.some((z) => z.treatment_id === key)) continue;
    const item = document.createElement('span');
    item.className = 'legend-item';
    const swatchClass = key === 'none' ? 'legend-swatch nospray' : 'legend-swatch';
    item.innerHTML = '<span class="' + swatchClass + '" style="' +
      (key === 'none' ? 'border-color:' + t.color : 'background:' + t.color) + '"></span>' + t.name;
    legend.appendChild(item);
  }

  // Intensity ramp — the weighted map's density axis.
  const peak = peakVolumePerAcre(data);
  if (peak > 0) {
    const ramp = document.createElement('span');
    ramp.className = 'legend-item legend-ramp';
    ramp.innerHTML = '<span class="ramp-label">Application rate</span>' +
      '<span class="ramp-bar"></span>' +
      '<span class="ramp-label num">0 &ndash; ' + peak.toFixed(2) + ' gal/ac</span>';
    legend.appendChild(ramp);
  }
}

function setMapStatus(text) {
  const el = document.getElementById('map-status');
  if (el) el.textContent = text;
}

// ---------- Location search ----------
//
// Accepts either a place name ("Ames, Iowa") or raw coordinates
// ("42.0351, -93.5696"). Coordinates resolve instantly with no network call;
// names go through our own /api/geocode proxy.

function initSearch() {
  const form = document.getElementById('search-form');
  const input = document.getElementById('search-input');
  if (!form || !input) return;
  form.onsubmit = (e) => {
    e.preventDefault();
    runSearch(input.value.trim());
  };
}

// "42.03, -93.57" / "42.03 -93.57" / "42.03N 93.57W"
function parseCoords(text) {
  const m = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*°?\s*([NnSs])?\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*°?\s*([EeWw])?\s*$/);
  if (!m) return null;
  let a = parseFloat(m[1]);
  let b = parseFloat(m[3]);
  if (m[2] && m[2].toLowerCase() === 's') a = -a;
  if (m[4] && m[4].toLowerCase() === 'w') b = -b;
  // Assume lat,lon; if that's impossible but lon,lat works, swap.
  let lat = a, lon = b;
  if (Math.abs(lat) > 90 && Math.abs(lon) <= 90) { lat = b; lon = a; }
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

async function runSearch(query) {
  if (!query) return;
  const coords = parseCoords(query);
  if (coords) {
    goTo(coords.lat, coords.lon, null);
    setSearchStatus('Moved to ' + coords.lat.toFixed(4) + ', ' + coords.lon.toFixed(4) +
      '. Draw a region to survey it.');
    return;
  }

  setSearchStatus('Searching…');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    const res = await fetch('/api/geocode?q=' + encodeURIComponent(query), { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error('geocode responded ' + res.status);
    const data = await res.json();
    if (!data.results || !data.results.length) {
      setSearchStatus('No match for “' + query + '”. Try a place name, or type coordinates as lat, lon.');
      return;
    }
    const hit = data.results[0];
    goTo(hit.lat, hit.lon, hit.bounds);
    setSearchStatus(hit.label + ' — draw a region to survey it.');
  } catch (err) {
    console.warn('[FieldLoop] geocode failed:', err);
    setSearchStatus('Search unavailable offline. Type coordinates instead, as lat, lon.');
  }
}

function goTo(lat, lon, bounds) {
  if (!lmap) return;
  if (bounds) {
    const [w, s, e, n] = bounds;
    lmap.fitBounds([[s, w], [n, e]], { padding: [20, 20], maxZoom: 15 });
  } else {
    lmap.setView([lat, lon], 14);
  }
}

function setSearchStatus(text) {
  const el = document.getElementById('search-status');
  if (el) el.textContent = text;
}

// ---------- Land-cover check ----------
//
// Reads the actual imagery inside a drawn region and decides whether there is
// any crop canopy there, so we never invent zones on ocean, sand or rooftops.
// Runs on the tiles the map already shows — no sign-in, no external service.

function probeRegion(region) {
  if (typeof sampleRegionCover !== 'function') return;
  region.probing = true;
  renderRegionList();
  sampleRegionCover(region.bounds).then((cover) => {
    region.probing = false;
    if (!cover) { renderRegionList(); return; }
    region.probe = cover;
    renderRegionList();
  }).catch((err) => {
    region.probing = false;
    console.warn('[FieldLoop] land-cover check failed:', err);
    renderRegionList();
  });
}

// ---------- Band views ----------

function currentBand() { return getBand(currentBandId); }

let currentBandId = 'truecolor';

function populateBandSelect() {
  const sel = document.getElementById('band-select');
  if (!sel) return;
  sel.innerHTML = BANDS
    .map((b) => '<option value="' + b.id + '"' + (b.id === currentBandId ? ' selected' : '') + '>' + b.label + '</option>')
    .join('');
  sel.onchange = () => {
    currentBandId = sel.value;
    applyBandLayer();
    renderBandScale();
  };
}

// Swap the base layer for the selected band view.
function applyBandLayer() {
  if (!lmap) return;
  const band = currentBand();
  try {
    const next = createBandLayer(band.id);
    next.addTo(lmap);
    next.bringToBack();
    if (baseLayer) baseLayer.remove();
    baseLayer = next;
    for (const o of treatmentOverlays) o.bringToFront();
    setMapStatus(band.raw
      ? 'Satellite imagery'
      : band.label + ' — computed live from the imagery');
  } catch (err) {
    console.warn('[FieldLoop] band layer failed:', err);
    setMapStatus('Band view unavailable — showing plain imagery.');
  }
}

// Colour scale for the active index, so the layer is readable.
function renderBandScale() {
  const el = document.getElementById('band-scale');
  if (!el) return;
  const band = currentBand();
  if (!band.palette) { el.innerHTML = ''; el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML =
    '<span class="ramp-label">' + (band.scale || '').split(' \u2192 ')[0] + '</span>' +
    '<span class="ramp-bar" style="background:linear-gradient(90deg,' + band.palette.join(',') + ')"></span>' +
    '<span class="ramp-label">' + (band.scale || '').split(' \u2192 ')[1] + '</span>';
}

// ---------- Offline fallback ----------

function renderStaticFallback(container, data) {
  container.classList.add('static-fallback');
  container.innerHTML = '<div class="map-wrap" id="gee-static-wrap"></div>';
  initFieldMap(data, document.getElementById('gee-static-wrap'));
}
