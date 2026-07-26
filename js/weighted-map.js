// Weighted treatment map. Renders treatment intensity as a continuous density
// field instead of discrete circles: each treated zone contributes a Gaussian
// bump scaled by severity and area, tinted with its product colour. Where two
// products overlap the colours blend by weight, so the map reads as "how much
// of what goes where" rather than "here are some dots".
//
// Returns a canvas the caller places however it likes — an L.imageOverlay on
// the Leaflet map, or an <img> layer beneath the static field map.
//
// Coordinates follow the frozen contract: x,y are 0..1 with ORIGIN TOP-LEFT,
// so canvas row 0 is the north edge. Nothing is flipped here.

const WEIGHT_GRID = 192;

function buildTreatmentCanvas(data, gridSize) {
  const N = gridSize || WEIGHT_GRID;
  const canvas = document.createElement('canvas');
  canvas.width = N;
  canvas.height = N;
  const ctx = canvas.getContext('2d');

  const treated = data.zones.filter((z) =>
    z.treatment_id !== 'none' && z.volume_gal > 0 && data.treatments[z.treatment_id]);
  if (!treated.length) return canvas;

  const weight = new Float32Array(N * N);
  const rAcc = new Float32Array(N * N);
  const gAcc = new Float32Array(N * N);
  const bAcc = new Float32Array(N * N);

  for (const zone of treated) {
    const rgb = hexToRgbTriplet(data.treatments[zone.treatment_id].color);
    // Larger zones spread wider; severity drives peak intensity.
    const sigmaPx = Math.max(0.018, Math.sqrt(zone.area_acres) * 0.030) * N;
    const peak = 0.35 + zone.severity * 0.65;
    const cx = zone.x * N;
    const cy = zone.y * N;
    const reach = Math.ceil(sigmaPx * 3);
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
        if (w < 0.002) continue;
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
    const o = i * 4;
    img.data[o] = Math.round(rAcc[i] / w);
    img.data[o + 1] = Math.round(gAcc[i] / w);
    img.data[o + 2] = Math.round(bAcc[i] / w);
    // gamma < 1 keeps the low-intensity fringe readable without washing out
    img.data[o + 3] = Math.round(Math.pow(Math.min(1, w / max), 0.65) * 235);
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function treatmentCanvasUrl(data, gridSize) {
  return buildTreatmentCanvas(data, gridSize).toDataURL();
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
