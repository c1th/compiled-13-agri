// Real map panel: Leaflet (vendored) + Esri satellite tiles as the base,
// with a Google Earth Engine NDVI overlay once the user connects (OAuth).
// Region input: "Draw region" then two clicks = rectangle corners.
// If Leaflet/tiles are unavailable (offline), falls back to the static
// field.png render so the demo never blanks.

let geeMap = null;
let regionRect = null;
let regionBounds = null;   // [W,S,E,N]
let drawCorner = null;     // first click while drawing
let drawing = false;
let zoneLayers = [];
let ndviLayer = null;
let eeReady = false;

function initGeeMap(data) {
  regionBounds = data.meta.bounds.slice();
  const container = document.getElementById('gee-map');

  try {
    if (typeof L === 'undefined') throw new Error('Leaflet not available');
    if (geeMap) { geeMap.remove(); geeMap = null; }
    container.innerHTML = '';
    geeMap = L.map(container, { zoomSnap: 0.25 });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Imagery: Esri World Imagery'
    }).addTo(geeMap);
    fitRegion();
    drawRegionRect();
    renderZonesOnMap(data);
    geeMap.on('click', onMapClick);
    setMapStatus(eeReady
      ? 'Earth Engine connected — NDVI overlay active'
      : 'Satellite base map. Connect Earth Engine for the live NDVI overlay.');
  } catch (err) {
    console.warn('[FieldLoop] map fallback to static image:', err.message);
    renderStaticFallback(container, data);
    setMapStatus('Offline mode — static imagery');
  }

  renderMapLegend(data);
  updateRegionReadout();

  const drawBtn = document.getElementById('draw-region');
  const geeBtn = document.getElementById('gee-connect');
  if (drawBtn) drawBtn.onclick = toggleDraw;
  if (geeBtn) geeBtn.onclick = connectEarthEngine;
}

function fitRegion() {
  const [w, s, e, n] = regionBounds;
  geeMap.fitBounds([[s, w], [n, e]], { padding: [24, 24] });
}

function drawRegionRect() {
  const [w, s, e, n] = regionBounds;
  if (regionRect) regionRect.remove();
  regionRect = L.rectangle([[s, w], [n, e]], {
    color: '#4ADE80', weight: 2, fill: false, dashArray: '6 4'
  }).addTo(geeMap);
}

function toggleDraw() {
  drawing = !drawing;
  drawCorner = null;
  const btn = document.getElementById('draw-region');
  btn.textContent = drawing ? 'Click two corners…' : 'Draw region';
  if (geeMap) geeMap.getContainer().style.cursor = drawing ? 'crosshair' : '';
}

function onMapClick(evt) {
  if (!drawing) return;
  if (!drawCorner) {
    drawCorner = evt.latlng;
    setMapStatus('Corner set — click the opposite corner.');
    return;
  }
  const a = drawCorner, b = evt.latlng;
  regionBounds = [
    Math.min(a.lng, b.lng), Math.min(a.lat, b.lat),
    Math.max(a.lng, b.lng), Math.max(a.lat, b.lat)
  ];
  drawCorner = null;
  toggleDraw();
  drawRegionRect();
  updateRegionReadout();
  if (eeReady) addNdviOverlay();
  setMapStatus('Region set — run the analysis to generate a plan.');
}

function getRegionBounds() { return regionBounds.slice(); }

function regionAcres() {
  const [w, s, e, n] = regionBounds;
  const latM = (n - s) * 111320;
  const lonM = (e - w) * 111320 * Math.cos(((n + s) / 2) * Math.PI / 180);
  return Math.max(1, (latM * lonM) / 4046.86);
}

function updateRegionReadout() {
  const el = document.getElementById('region-readout');
  if (!el) return;
  const [w, s, e, n] = regionBounds;
  el.textContent = `Region [${w.toFixed(4)}, ${s.toFixed(4)}, ${e.toFixed(4)}, ${n.toFixed(4)}] · ~${Math.round(regionAcres()).toLocaleString('en-US')} acres`;
}

// Zones as circle markers, colored by treatment; do-not-spray dashed, no fill.
function renderZonesOnMap(data) {
  if (!geeMap) return;
  for (const layer of zoneLayers) layer.remove();
  zoneLayers = [];
  for (const zone of data.zones) {
    const t = data.treatments[zone.treatment_id];
    if (!t) continue;
    const noSpray = zone.treatment_id === 'none';
    const marker = L.circleMarker([zone.lat, zone.lon], {
      radius: 7 + zone.area_acres * 4,
      color: t.color,
      weight: 2,
      dashArray: noSpray ? '5 4' : null,
      fill: !noSpray,
      fillColor: t.color,
      fillOpacity: noSpray ? 0 : 0.2 + zone.severity * 0.5
    }).addTo(geeMap);
    marker.bindTooltip(zoneTooltipHtml(zone, t), { className: 'map-tooltip-leaflet', sticky: true });
    zoneLayers.push(marker);
  }
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
    const item = document.createElement('span');
    item.className = 'legend-item';
    const swatchClass = key === 'none' ? 'legend-swatch nospray' : 'legend-swatch';
    item.innerHTML = '<span class="' + swatchClass + '" style="' +
      (key === 'none' ? 'border-color:' + t.color : 'background:' + t.color) + '"></span>' + t.name;
    legend.appendChild(item);
  }
}

function setMapStatus(text) {
  const el = document.getElementById('map-status');
  if (el) el.textContent = text;
}

// ---------- Earth Engine ----------

function connectEarthEngine() {
  const cfg = window.FIELDLOOP_CONFIG || {};
  try {
    if (typeof ee === 'undefined') throw new Error('Earth Engine library failed to load');
    if (!cfg.EE_CLIENT_ID) {
      setMapStatus('Set EE_CLIENT_ID (and EE_PROJECT) in js/config.js to connect Earth Engine.');
      return;
    }
    setMapStatus('Opening Google sign-in…');
    ee.data.authenticateViaOauth(
      cfg.EE_CLIENT_ID,
      () => eeInitialize(cfg),
      (err) => { console.warn('[FieldLoop] EE auth error:', err); setMapStatus('Earth Engine sign-in failed — continuing on base imagery.'); },
      null,
      () => ee.data.authenticateViaPopup(
        () => eeInitialize(cfg),
        (err) => { console.warn('[FieldLoop] EE popup auth error:', err); setMapStatus('Earth Engine sign-in failed — continuing on base imagery.'); }
      )
    );
  } catch (err) {
    console.warn('[FieldLoop] EE connect failed:', err);
    setMapStatus('Earth Engine unavailable — continuing on base imagery.');
  }
}

function eeInitialize(cfg) {
  ee.initialize(
    null, null,
    () => { eeReady = true; setMapStatus('Earth Engine connected — loading NDVI…'); addNdviOverlay(); },
    (err) => { console.warn('[FieldLoop] EE init error:', err); setMapStatus('Earth Engine init failed — continuing on base imagery.'); },
    null,
    cfg.EE_PROJECT || null
  );
}

// Sentinel-2 NDVI over the drawn region, least-cloudy scene from the last 60 days.
function addNdviOverlay() {
  if (!eeReady || !geeMap) return;
  try {
    const [w, s, e, n] = regionBounds;
    const region = ee.Geometry.Rectangle([w, s, e, n]);
    const end = new Date();
    const start = new Date(end.getTime() - 60 * 24 * 3600 * 1000);
    const scene = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
      .filterBounds(region)
      .filterDate(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10))
      .sort('CLOUDY_PIXEL_PERCENTAGE')
      .first();
    const ndvi = ee.Image(scene).normalizedDifference(['B8', 'B4']);
    ndvi.getMapId(
      { min: 0, max: 0.9, palette: ['d7191c', 'fdae61', 'ffffbf', 'a6d96a', '1a9641'] },
      (obj, err) => {
        if (err || !obj) {
          console.warn('[FieldLoop] NDVI getMapId error:', err);
          setMapStatus('NDVI layer failed — continuing on base imagery.');
          return;
        }
        if (ndviLayer) ndviLayer.remove();
        ndviLayer = L.tileLayer(obj.urlFormat, { opacity: 0.55, maxZoom: 19 }).addTo(geeMap);
        setMapStatus('Earth Engine connected — Sentinel-2 NDVI overlay active.');
      }
    );
  } catch (err) {
    console.warn('[FieldLoop] NDVI overlay failed:', err);
    setMapStatus('NDVI layer failed — continuing on base imagery.');
  }
}

// ---------- Offline fallback ----------

function renderStaticFallback(container, data) {
  container.classList.add('static-fallback');
  container.innerHTML = '<div class="map-wrap" id="gee-static-wrap"></div>';
  initFieldMap(data, document.getElementById('gee-static-wrap'));
}
