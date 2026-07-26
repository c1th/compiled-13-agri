// Fallback data. Loaded BEFORE data/zones.js — if FIELD fails to define,
// the app renders from STUB instead of blanking. Same shape as FIELD.

const STUB = {
  meta: {
    name: "Stub Field",
    bounds: [-93.652, 41.987, -93.618, 42.001],
    image: "field.png",
    image_size: [1200, 800],
    date: "2026-07-24"
  },
  summary: {
    total_acres: 160,
    flagged_acres: 14.6,
    pct_flagged: 9.1,
    pct_reduction: 91,
    dollars_saved: 4944
  },
  treatments: {
    beauveria: { name: "Beauveria bassiana", rate_gal_per_acre: 1.5, color: "#7B4B94" },
    bt:        { name: "Bacillus thuringiensis", rate_gal_per_acre: 1.0, color: "#E8A33D" },
    none:      { name: "No treatment — irrigation issue", rate_gal_per_acre: 0, color: "#5A9BD4" }
  },
  zones: [
    { id: "S01", x: 0.30, y: 0.30, lon: -93.6418, lat: 41.9968, severity: 0.80, area_acres: 2.0, ndvi_anomaly: -0.18, ndmi_anomaly: 0.01, diagnosis: "biotic_stress", treatment_id: "beauveria", volume_gal: 3.0, priority: 1 },
    { id: "S02", x: 0.65, y: 0.60, lon: -93.6299, lat: 41.9926, severity: 0.65, area_acres: 1.5, ndvi_anomaly: -0.13, ndmi_anomaly: 0.02, diagnosis: "biotic_stress", treatment_id: "bt", volume_gal: 1.5, priority: 2 },
    { id: "S03", x: 0.45, y: 0.75, lon: -93.6367, lat: 41.9905, severity: 0.60, area_acres: 2.2, ndvi_anomaly: -0.12, ndmi_anomaly: -0.20, diagnosis: "water_stress", treatment_id: "none", volume_gal: 0, priority: 3 }
  ],
  fleet: [
    { id: "DR-1", home: [0.03, 0.50], carries: "beauveria", tank_gal: 6.0 }
  ]
};
