// Spectral band views computed straight from the satellite imagery tiles.
//
// No Earth Engine, no API key, no sign-in. Each tile is drawn to a canvas, the
// pixels are read back, and a vegetation/soil/water index is computed per cell
// and painted through a colour ramp. These are real indices used in precision
// agriculture with visible-light (RGB) cameras — VARI, Excess Green, GLI —
// which is what you can honestly derive without a near-infrared band.
//
// Cells are averaged in blocks and snapped to discrete classes, so the result
// reads as a classified raster rather than a smooth photo — the same visual
// language as the treatment layer.
//
// Honesty note: true NDVI/NDMI need near-infrared, which public RGB basemaps
// do not carry. Labels here say what each layer actually is.

const BAND_TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const BAND_BLOCK = 6;      // pixels per classified cell
const BAND_CLASSES = 7;    // intensity steps

// --- index maths (all take 0..255 r,g,b and return roughly -1..1) ----------

const INDEX_FN = {
  // Visible Atmospherically Resistant Index — the standard RGB vegetation index.
  vari: (r, g, b) => {
    const d = g + r - b;
    return Math.abs(d) < 1e-6 ? 0 : (g - r) / d;
  },
  // Excess Green, on normalised chromatic coordinates. Canopy density.
  exg: (r, g, b) => {
    const t = r + g + b;
    if (t < 1e-6) return 0;
    return (2 * g - r - b) / t;
  },
  // Green Leaf Index.
  gli: (r, g, b) => {
    const d = 2 * g + r + b;
    return d < 1e-6 ? 0 : (2 * g - r - b) / d;
  },
  // Bare-soil / redness: positive where soil and residue dominate.
  soil: (r, g, b) => {
    const t = r + g + b;
    if (t < 1e-6) return 0;
    return (r - g) / t * 3;
  },
  // Water & shadow: dark and blue-dominant.
  water: (r, g, b) => {
    const bright = (r + g + b) / 3;
    const blueness = (b - r) / 255;
    return blueness + (1 - bright / 255) * 0.5 - 0.35;
  }
};

const BANDS = [
  {
    id: 'truecolor',
    label: 'True colour',
    note: 'The satellite photo as-is — what your eye would see from orbit. Use it to find field boundaries.',
    raw: true
  },
  {
    id: 'vegetation',
    label: 'Vegetation (VARI)',
    note: 'Plant vigour from visible light. Green = healthy leafy canopy, orange/brown = bare soil, rock, sand or water.',
    scale: 'bare → dense canopy',
    index: 'vari',
    domain: [-0.15, 0.45],
    palette: ['#8c3b06', '#c2681c', '#e0a03a', '#f2d072', '#a8cf6b', '#4f9b32', '#14591f']
  },
  {
    id: 'canopy',
    label: 'Canopy density (ExG)',
    note: 'How much leaf cover is present. Brighter = thicker canopy. Good for spotting thin or failed patches inside a field.',
    scale: 'thin → thick',
    index: 'exg',
    domain: [-0.05, 0.30],
    palette: ['#0d1f10', '#1c3d1a', '#2f6b25', '#479a2e', '#6fc245', '#a3e06a', '#d6f59b']
  },
  {
    id: 'leaf',
    label: 'Leaf health (GLI)',
    note: 'Greenness weighted for leaf condition. Yellow-to-red areas are stressed, discoloured or senescing.',
    scale: 'stressed → healthy',
    index: 'gli',
    domain: [-0.1, 0.35],
    palette: ['#a11d1d', '#d1492b', '#eb8a3c', '#f5c95b', '#bcd95f', '#66ad3f', '#1f7a34']
  },
  {
    id: 'soil',
    label: 'Bare soil',
    note: 'Exposed ground and crop residue. Bright = bare soil with no canopy over it.',
    scale: 'covered → bare',
    index: 'soil',
    domain: [-0.2, 0.35],
    palette: ['#123b1e', '#2f5b33', '#6b6f45', '#a58a55', '#c8a46b', '#e0c28d', '#f5e3bd']
  },
  {
    id: 'water',
    label: 'Water & shadow',
    note: 'Standing water, ponds, rivers and deep shadow. Blue = wet or flooded ground.',
    scale: 'dry → open water',
    index: 'water',
    domain: [-0.25, 0.35],
    palette: ['#f3efe2', '#dfe6dd', '#b9d3d6', '#7fb4c9', '#4a86b5', '#255f96', '#0d3163']
  }
];

function getBand(id) {
  return BANDS.find((b) => b.id === id) || BANDS[0];
}

// --- palette lookup -------------------------------------------------------

const lutCache = {};

function paletteLut(band) {
  if (lutCache[band.id]) return lutCache[band.id];
  const stops = band.palette.map(hexToRgbTriplet);
  const lut = new Uint8Array(BAND_CLASSES * 3);
  for (let c = 0; c < BAND_CLASSES; c++) {
    const t = BAND_CLASSES === 1 ? 0 : c / (BAND_CLASSES - 1);
    const pos = t * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(pos));
    const f = pos - i;
    for (let k = 0; k < 3; k++) {
      lut[c * 3 + k] = Math.round(stops[i][k] + (stops[i + 1][k] - stops[i][k]) * f);
    }
  }
  lutCache[band.id] = lut;
  return lut;
}

// Paint a classified index over an ImageData in place.
function applyIndexToImageData(data, band) {
  const fn = INDEX_FN[band.index];
  if (!fn) return;
  const lut = paletteLut(band);
  const [lo, hi] = band.domain;
  const span = hi - lo || 1;
  const w = data.width, h = data.height;
  const px = data.data;

  for (let by = 0; by < h; by += BAND_BLOCK) {
    for (let bx = 0; bx < w; bx += BAND_BLOCK) {
      const xEnd = Math.min(bx + BAND_BLOCK, w);
      const yEnd = Math.min(by + BAND_BLOCK, h);
      let r = 0, g = 0, b = 0, count = 0;
      for (let y = by; y < yEnd; y++) {
        let o = (y * w + bx) * 4;
        for (let x = bx; x < xEnd; x++, o += 4) {
          r += px[o]; g += px[o + 1]; b += px[o + 2]; count++;
        }
      }
      if (!count) continue;
      const v = fn(r / count, g / count, b / count);
      let cls = Math.round(((v - lo) / span) * (BAND_CLASSES - 1));
      cls = Math.max(0, Math.min(BAND_CLASSES - 1, cls));
      const cr = lut[cls * 3], cg = lut[cls * 3 + 1], cb = lut[cls * 3 + 2];
      for (let y = by; y < yEnd; y++) {
        let o = (y * w + bx) * 4;
        for (let x = bx; x < xEnd; x++, o += 4) {
          px[o] = cr; px[o + 1] = cg; px[o + 2] = cb;
        }
      }
    }
  }
}

// --- Leaflet layer --------------------------------------------------------

function createBandLayer(bandId) {
  const band = getBand(bandId);
  if (band.raw) {
    return L.tileLayer(BAND_TILE_URL, {
      maxZoom: 19, attribution: 'Imagery: Esri World Imagery'
    });
  }

  const IndexLayer = L.GridLayer.extend({
    createTile: function (coords, done) {
      const size = this.getTileSize();
      const tile = document.createElement('canvas');
      tile.width = size.x;
      tile.height = size.y;
      const ctx = tile.getContext('2d');

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          ctx.drawImage(img, 0, 0, size.x, size.y);
          const d = ctx.getImageData(0, 0, size.x, size.y);
          applyIndexToImageData(d, band);
          ctx.putImageData(d, 0, 0);
        } catch (err) {
          // Tainted canvas or decode failure — leave the plain tile rather
          // than blanking the map.
          console.warn('[FieldLoop] band tile failed:', err && err.message);
        }
        done(null, tile);
      };
      img.onerror = () => done(null, tile);
      img.src = BAND_TILE_URL
        .replace('{z}', coords.z).replace('{x}', coords.x).replace('{y}', coords.y);
      return tile;
    }
  });

  return new IndexLayer({ maxZoom: 19, attribution: 'Index computed from Esri World Imagery' });
}

// --- land-cover sampling --------------------------------------------------
//
// Reads the imagery inside a region and decides whether there is any crop
// canopy there at all, so we never invent zones on ocean, sand or rooftops.

function lonToTileX(lon, z) { return (lon + 180) / 360 * Math.pow(2, z); }
function latToTileY(lat, z) {
  const r = lat * Math.PI / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z);
}

function pickZoom(bounds) {
  const [w, s, e, n] = bounds;
  for (let z = 16; z >= 4; z--) {
    const dx = Math.abs(lonToTileX(e, z) - lonToTileX(w, z));
    const dy = Math.abs(latToTileY(s, z) - latToTileY(n, z));
    if (dx <= 2 && dy <= 2) return z;
  }
  return 4;
}

function loadTile(z, x, y) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = BAND_TILE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  });
}

// Resolves to { vegFraction, waterFraction, meanVari, plantable, cover, note }.
async function sampleRegionCover(bounds) {
  const [w, s, e, n] = bounds;
  const z = pickZoom(bounds);
  const x0 = Math.floor(lonToTileX(w, z)), x1 = Math.floor(lonToTileX(e, z));
  const y0 = Math.floor(latToTileY(n, z)), y1 = Math.floor(latToTileY(s, z));

  const nx = x1 - x0 + 1, ny = y1 - y0 + 1;
  const canvas = document.createElement('canvas');
  canvas.width = nx * 256;
  canvas.height = ny * 256;
  const ctx = canvas.getContext('2d');

  const jobs = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      jobs.push(loadTile(z, tx, ty).then((img) => {
        if (img) ctx.drawImage(img, (tx - x0) * 256, (ty - y0) * 256);
      }));
    }
  }
  await Promise.all(jobs);

  // Pixel window covering just the region inside the composited tiles.
  const px0 = Math.round((lonToTileX(w, z) - x0) * 256);
  const px1 = Math.round((lonToTileX(e, z) - x0) * 256);
  const py0 = Math.round((latToTileY(n, z) - y0) * 256);
  const py1 = Math.round((latToTileY(s, z) - y0) * 256);
  const cw = Math.max(1, px1 - px0), ch = Math.max(1, py1 - py0);

  let d;
  try {
    d = ctx.getImageData(px0, py0, cw, ch);
  } catch (err) {
    console.warn('[FieldLoop] cover sample blocked:', err && err.message);
    return null;
  }

  let veg = 0, water = 0, total = 0, variSum = 0;
  const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i], g = p[i + 1], b = p[i + 2];
    if (p[i + 3] === 0) continue;
    const bright = (r + g + b) / 3;
    if (bright < 6) continue;            // unpainted / missing tile
    total++;
    const v = INDEX_FN.vari(r, g, b);
    variSum += v;
    if (v > 0.02) veg++;
    if (b > r + 6 && bright < 95) water++;
  }
  if (!total) return null;

  const vegFraction = veg / total;
  const waterFraction = water / total;
  const meanVari = variSum / total;
  return Object.assign({ vegFraction, waterFraction, meanVari },
    classifyCover(vegFraction, waterFraction));
}

function classifyCover(vegFraction, waterFraction) {
  if (waterFraction > 0.55) {
    return { plantable: false, cover: 'open water', note: 'Open water — no plant matter detected.' };
  }
  if (vegFraction < 0.12) {
    return { plantable: false, cover: 'bare ground', note: 'No vegetation detected — bare ground, sand, rock or built-up surface.' };
  }
  if (vegFraction < 0.30) {
    return { plantable: false, cover: 'sparse cover', note: 'Only sparse vegetation — not enough crop canopy to survey.' };
  }
  if (vegFraction < 0.55) {
    return { plantable: true, cover: 'light canopy', note: 'Light vegetation — thin or early-season canopy.' };
  }
  return { plantable: true, cover: 'vegetated', note: 'Healthy vegetation detected.' };
}
