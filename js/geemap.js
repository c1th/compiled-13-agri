// Real map panel: Leaflet (vendored) + Esri satellite tiles as the base,
// with a Google Earth Engine NDVI overlay once the user connects (OAuth).
// Region input: "Draw region" then two clicks = rectangle corners.
// If Leaflet/tiles are unavailable (offline), falls back to the static
// field.png render so the demo never blanks.

let geeMap = null;
let regions = [];          // [{ id, label, bounds:[W,S,E,N], rect }]
let regionSeq = 0;
let drawCorner = null;     // first click while drawing
let drawing = false;
let zoneLayers = [];
let ndviLayer = null;
let treatmentOverlays = [];
let eeReady = false;
let mapData = null;

function initGeeMap(data) {
  mapData = data;
  document.getElementById('field-name').textContent = data.meta.name;
  document.getElementById('field-date').textContent = data.meta.date;
  const container = document.getElementById('gee-map');

  if (!regions.length) addRegion(data.meta.bounds.slice());

  try {
    if (typeof L === 'undefined') throw new Error('Leaflet not available');
    if (geeMap) { geeMap.remove(); geeMap = null; }
    container.innerHTML = '';
    geeMap = L.map(container, { zoomSnap: 0.25 });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Imagery: Esri World Imagery'
    }).addTo(geeMap);
    fitAllRegions();
    drawRegionRects();
    renderZonesOnMap(data);
    geeMap.on('click', onMapClick);
    // Band layers cover the visible scene, so refetch after the view settles.
    geeMap.on('moveend', () => { if (eeReady) addBandLayer(); });
    setMapStatus(eeReady
      ? 'Earth Engine \u00b7 ' + currentBand().label
      : 'Satellite base map. Connect Earth Engine to view spectral bands.');
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
  const geeBtn = document.getElementById('gee-connect');
  const clearBtn = document.getElementById('clear-regions');
  if (drawBtn) drawBtn.onclick = toggleDraw;
  if (geeBtn) geeBtn.onclick = connectEarthEngine;
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
  setMapStatus('Regions cleared.');
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
  geeMap.fitBounds([[s, w], [n, e]], { padding: [24, 24] });
}

function drawRegionRects() {
  for (const r of regions) {
    if (r.rect) r.rect.remove();
    const [w, s, e, n] = r.bounds;
    r.rect = L.rectangle([[s, w], [n, e]], {
      color: '#4ADE80', weight: 2, fill: false, dashArray: '6 4', interactive: false
    }).addTo(geeMap);
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
  if (geeMap) geeMap.getContainer().style.cursor = drawing ? 'crosshair' : '';
  if (drawing) setMapStatus('Click one corner of the area to survey, then the opposite corner.');
}

function onMapClick(evt) {
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
  setMapStatus(regions.length > 1
    ? regions.length + ' regions selected \u2014 run the analysis to survey them all.'
    : 'Region set \u2014 run the analysis to generate a plan.');
}

let regionsUserDrawn = false;

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
  const ndvi = r.probe.ndvi == null ? '' : ' NDVI ' + r.probe.ndvi.toFixed(2);
  return '<span class="' + cls + '" title="' + r.probe.note + '">' + r.probe.cover + ndvi + '</span>';
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
  if (!geeMap) return;
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
        }).addTo(geeMap)
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
    ).addTo(geeMap);
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
  if (!geeMap) return;
  if (bounds) {
    const [w, s, e, n] = bounds;
    geeMap.fitBounds([[s, w], [n, e]], { padding: [20, 20], maxZoom: 15 });
  } else {
    geeMap.setView([lat, lon], 14);
  }
}

function setSearchStatus(text) {
  const el = document.getElementById('search-status');
  if (el) el.textContent = text;
}

// ---------- Earth Engine band layers ----------
//
// Each preset turns a cloud-reduced Sentinel-2 composite into one viewable
// layer. `image` returns the ee.Image to draw, `vis` is its visualisation.
// `note` is written in plain language for the end user — it is the label that
// tells them what they are actually looking at.

const EE_BANDS = [
  {
    id: 'ndvi',
    label: 'Vegetation (NDVI)',
    note: 'Plant vigour. Green = dense healthy canopy, orange/red = bare soil, rock, sand or water.',
    scaleNote: 'bare → dense canopy',
    palette: ['#9e2f00', '#d95f0e', '#fec44f', '#addd8e', '#31a354', '#00602a'],
    image: (s) => s.normalizedDifference(['B8', 'B4']).rename('ndvi'),
    vis: { min: -0.1, max: 0.85 }
  },
  {
    id: 'truecolor',
    label: 'True colour',
    note: 'Natural colour — roughly what your eye would see from orbit.',
    image: (s) => s,
    vis: { bands: ['B4', 'B3', 'B2'], min: 0, max: 3000 }
  },
  {
    id: 'water',
    label: 'Water (NDWI)',
    note: 'Surface water and flooding. Blue = open water, pale = dry ground.',
    scaleNote: 'dry → open water',
    palette: ['#f7f4e9', '#d5e8e4', '#7fcdbb', '#2c7fb8', '#08306b'],
    image: (s) => s.normalizedDifference(['B3', 'B8']).rename('ndwi'),
    vis: { min: -0.4, max: 0.5 }
  },
  {
    id: 'moisture',
    label: 'Soil moisture (NDMI)',
    note: 'Moisture held in the canopy and soil. Blue = wet, brown = dry — this is what separates drought stress from pest damage.',
    scaleNote: 'dry → wet',
    palette: ['#8c510a', '#d8b365', '#f6e8c3', '#c7eae5', '#5ab4ac', '#01665e'],
    image: (s) => s.normalizedDifference(['B8', 'B11']).rename('ndmi'),
    vis: { min: -0.4, max: 0.5 }
  },
  {
    id: 'infrared',
    label: 'False-colour infrared',
    note: 'Near-infrared composite. Living vegetation glows red — the classic way to spot crop vs bare ground.',
    image: (s) => s,
    vis: { bands: ['B8', 'B4', 'B3'], min: 0, max: 3500 }
  },
  {
    id: 'agriculture',
    label: 'Agriculture (SWIR)',
    note: 'Short-wave infrared composite. Highlights crop type and residue; bright green = vigorous growth.',
    image: (s) => s,
    vis: { bands: ['B11', 'B8', 'B2'], min: 0, max: 3500 }
  }
];

let currentBandId = 'ndvi';

function currentBand() {
  return EE_BANDS.find((b) => b.id === currentBandId) || EE_BANDS[0];
}

// Cloud-reduced Sentinel-2 composite over the last 90 days for the given area.
function sentinelComposite(region) {
  const end = new Date();
  const start = new Date(end.getTime() - 90 * 24 * 3600 * 1000);
  return ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(region)
    .filterDate(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10))
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 40))
    .median();
}

// ---------- Land-cover probe ----------
//
// Measures mean NDVI (plant vigour) and NDWI (surface water) inside a drawn
// region so we can tell the user straight away when there is nothing to
// survey — water, sand, rock or pavement — instead of inventing crop zones.
// Only runs when Earth Engine is connected; otherwise the analysis layer's
// own geographic assessment covers it.

function classifyCover(ndvi, ndwi) {
  if (ndwi != null && ndwi > 0.18) {
    return { plantable: false, cover: 'open water', note: 'Open water — no plant matter detected.' };
  }
  if (ndvi == null) {
    return { plantable: true, cover: 'unknown', note: '' };
  }
  if (ndvi < 0.12) {
    return { plantable: false, cover: 'bare ground', note: 'No vegetation detected — bare ground, sand, rock or pavement.' };
  }
  if (ndvi < 0.22) {
    return { plantable: false, cover: 'sparse scrub', note: 'Only sparse scrub detected — not enough crop canopy to survey.' };
  }
  if (ndvi < 0.4) {
    return { plantable: true, cover: 'light vegetation', note: 'Light vegetation — thin or early-season canopy.' };
  }
  return { plantable: true, cover: 'dense vegetation', note: 'Healthy vegetation detected.' };
}

function probeRegion(region) {
  if (!eeReady || typeof ee === 'undefined') return;
  try {
    const [w, s, e, n] = region.bounds;
    const rect = ee.Geometry.Rectangle([w, s, e, n]);
    const comp = sentinelComposite(rect);
    const idx = comp.normalizedDifference(['B8', 'B4']).rename('ndvi')
      .addBands(comp.normalizedDifference(['B3', 'B8']).rename('ndwi'));

    region.probing = true;
    renderRegionList();
    idx.reduceRegion({
      reducer: ee.Reducer.mean(),
      geometry: rect,
      scale: 30,
      maxPixels: 1e9,
      bestEffort: true
    }).evaluate((res, err) => {
      region.probing = false;
      if (err || !res) {
        console.warn('[FieldLoop] land-cover probe failed:', err);
        renderRegionList();
        return;
      }
      const verdict = classifyCover(res.ndvi, res.ndwi);
      region.probe = {
        ndvi: res.ndvi, ndwi: res.ndwi,
        plantable: verdict.plantable, cover: verdict.cover, note: verdict.note
      };
      renderRegionList();
      if (!verdict.plantable) {
        setMapStatus(region.label + ': ' + verdict.note + ' It will be skipped in the survey.');
      }
    });
  } catch (err) {
    region.probing = false;
    console.warn('[FieldLoop] land-cover probe failed:', err);
  }
}

function populateBandSelect() {
  const sel = document.getElementById('band-select');
  if (!sel) return;
  sel.innerHTML = EE_BANDS
    .map((b) => '<option value="' + b.id + '"' + (b.id === currentBandId ? ' selected' : '') + '>' + b.label + '</option>')
    .join('');
  sel.onchange = () => {
    currentBandId = sel.value;
    setBandNote();
    if (eeReady) addBandLayer();
    else setBandNote('Connect Earth Engine to view this layer.');
  };
  setBandNote();
}

function setBandNote(override) {
  const el = document.getElementById('band-note');
  if (!el) return;
  el.textContent = override || currentBand().note;
}

// Draws the selected band across the whole visible scene (not clipped to a
// region) so the user can see context while choosing where to survey.
function addBandLayer() {
  if (!eeReady || !geeMap) return;
  const band = currentBand();
  try {
    const v = geeMap.getBounds();
    const area = ee.Geometry.Rectangle([v.getWest(), v.getSouth(), v.getEast(), v.getNorth()]);
    const image = band.image(sentinelComposite(area));
    const vis = Object.assign({}, band.vis);
    if (band.palette) vis.palette = band.palette;

    setMapStatus('Loading ' + band.label + '…');
    image.getMapId(vis, (obj, err) => {
      if (err || !obj) {
        console.warn('[FieldLoop] band layer error:', err);
        setMapStatus(band.label + ' unavailable here — showing base imagery.');
        return;
      }
      if (ndviLayer) ndviLayer.remove();
      ndviLayer = L.tileLayer(obj.urlFormat, { opacity: 0.8, maxZoom: 19 }).addTo(geeMap);
      for (const o of treatmentOverlays) o.bringToFront();
      setMapStatus('Earth Engine · ' + band.label + ' (Sentinel-2, last 90 days)');
      renderBandScale();
    });
  } catch (err) {
    console.warn('[FieldLoop] band layer failed:', err);
    setMapStatus('Band layer failed — continuing on base imagery.');
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
    '<span class="ramp-label">' + band.label.replace(/ \(.*\)/, '') + '</span>' +
    '<span class="ramp-bar" style="background:linear-gradient(90deg,' + band.palette.join(',') + ')"></span>' +
    '<span class="ramp-label">' + (band.scaleNote || '') + '</span>';
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
    () => { eeReady = true; addBandLayer(); regions.forEach(probeRegion); },
    (err) => { console.warn('[FieldLoop] EE init error:', err); setMapStatus('Earth Engine init failed — continuing on base imagery.'); },
    null,
    cfg.EE_PROJECT || null
  );
}

// ---------- Offline fallback ----------

function renderStaticFallback(container, data) {
  container.classList.add('static-fallback');
  container.innerHTML = '<div class="map-wrap" id="gee-static-wrap"></div>';
  initFieldMap(data, document.getElementById('gee-static-wrap'));
}
