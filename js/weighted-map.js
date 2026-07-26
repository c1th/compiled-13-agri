// Weighted treatment map — a classified raster, not a smooth gradient.
//
// Each treated zone contributes a Gaussian bump (spread from area, peak from
// severity) tinted with its product colour; overlapping products blend by
// weight. The accumulated field is then QUANTIZED into a small number of
// intensity steps and rendered on a coarse grid with no interpolation, so it
// reads as discrete classified cells like a satellite-derived raster rather
// than an airbrushed glow.
//
// Returns a canvas the caller places however it likes — an L.imageOverlay on
// the Leaflet map, or an <img> layer beneath the static field map. Callers
// must render it with `image-rendering: pixelated` to keep the cell edges hard.
//
// Coordinates: pass `bounds` [W,S,E,N] to derive cell position from each
// zone's lon/lat (used for per-region overlays). Without bounds it falls back
// to the zone's stored x,y, which per the frozen contract are 0..1 with ORIGIN
// TOP-LEFT — canvas row 0 is the north edge. Nothing is flipped here.

const WEIGHT_GRID = 56;    // coarse on purpose — this is the "pixel" size
const WEIGHT_LEVELS = 5;   // intensity classes

function buildTreatmentCanvas(data, opts) {
  const o = opts || {};
  const N = o.grid || WEIGHT_GRID;
  const bounds = o.bounds || null;

  const canvas = document.createElement('canvas');
  canvas.width = N;
  canvas.height = N;
  const ctx = canvas.getContext('2d');

  let zones = data.zones.filter((z) =>
    z.treatment_id !== 'none' && z.volume_gal > 0 && data.treatments[z.treatment_id]);
  if (o.zoneFilter) zones = zones.filter(o.zoneFilter);
  if (!zones.length) return canvas;

  const weight = new Float32Array(N * N);
  const rAcc = new Float32Array(N * N);
  const gAcc = new Float32Array(N * N);
  const bAcc = new Float32Array(N * N);

  for (const zone of zones) {
    const pos = zonePosition(zone, bounds);
    if (!pos) continue;
    const rgb = hexToRgbTriplet(data.treatments[zone.treatment_id].color);
    const sigmaPx = Math.max(0.022, Math.sqrt(zone.area_acres) * 0.032) * N;
    const peak = 0.35 + zone.severity * 0.65;
    const cx = pos.x * N;
    const cy = pos.y * N;
    const reach = Math.ceil(sigmaPx * 2.6);
    const denom = 2 * sigmaPx * sigmaPx;

    const x0 = Math.max(0, Math.floor(cx - reach));
    const x1 = Math.min(N - 1, Math.ceil(cx + reach));
    const y0 = Math.max(0, Math.floor(cy - reach));
    const y1 = Math.min(N - 1, Math.ceil(cy + reach));

    for (let py = y0; py <= y1; py++) {
      const dy = py + 0.5 - cy;
      for (let px = x0; px <= x1; px++) {
        const dx = px + 0.5 - cx;
        const w = peak * Math.exp(-(dx * dx + dy * dy) / denom);
        if (w < 0.05) continue;   // hard cutoff — no faint haze around cells
        const i = py * N + px;
        weight[i] += w;
        rAcc[i] += rgb[0] * w;
        gAcc[i] += rgb[1] * w;
        bAcc[i] += rgb[2] * w;
      }
    }
  }

  let max = 0;
  for (let i = 0; i < weight.length; i++) if (weight[i] > max) max = weight[i];
  if (max <= 0) return canvas;

  const img = ctx.createImageData(N, N);
  for (let i = 0; i < weight.length; i++) {
    const w = weight[i];
    if (w <= 0) continue;
    // Snap into discrete intensity classes so cells read as stepped, not smooth.
    const level = Math.max(1, Math.ceil((w / max) * WEIGHT_LEVELS));
    const o4 = i * 4;
    img.data[o4] = Math.round(rAcc[i] / w);
    img.data[o4 + 1] = Math.round(gAcc[i] / w);
    img.data[o4 + 2] = Math.round(bAcc[i] / w);
    img.data[o4 + 3] = Math.round((0.30 + 0.70 * (level / WEIGHT_LEVELS)) * 245);
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function treatmentCanvasUrl(data, opts) {
  return buildTreatmentCanvas(data, opts).toDataURL();
}

// Cell position 0..1 within the rendered extent, origin top-left.
function zonePosition(zone, bounds) {
  if (!bounds) {
    return (zone.x == null || zone.y == null) ? null : { x: zone.x, y: zone.y };
  }
  const [w, s, e, n] = bounds;
  if (e === w || n === s) return null;
  const x = (zone.lon - w) / (e - w);
  const y = (n - zone.lat) / (n - s);   // y grows southward — origin top-left
  if (x < -0.05 || x > 1.05 || y < -0.05 || y > 1.05) return null;
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

// Peak application rate across the field, for the intensity legend.
function peakVolumePerAcre(data) {
  let peak = 0;
  for (const z of data.zones) {
    if (z.treatment_id === 'none' || !z.area_acres) continue;
    peak = Math.max(peak, z.volume_gal / z.area_acres);
  }
  return peak;
}

function hexToRgbTriplet(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ];
}
