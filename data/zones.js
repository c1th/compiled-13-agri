// FieldLoop field data — mock. May be overwritten with real data before demo.
// Contract is FROZEN: do not rename fields. y is measured from the TOP of the
// image (origin top-left). Zone pixel position = x * imageWidth, y * imageHeight.

const FIELD = {
  meta: {
    name: "Hartley North 160",
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
    { id: "Z01", x: 0.12, y: 0.18, lon: -93.6479, lat: 41.9985, severity: 0.82, area_acres: 1.9, ndvi_anomaly: -0.19, ndmi_anomaly:  0.01, diagnosis: "biotic_stress", treatment_id: "beauveria", volume_gal: 2.85, priority: 2 },
    { id: "Z02", x: 0.22, y: 0.31, lon: -93.6445, lat: 41.9967, severity: 0.74, area_acres: 1.6, ndvi_anomaly: -0.16, ndmi_anomaly: -0.02, diagnosis: "biotic_stress", treatment_id: "beauveria", volume_gal: 2.40, priority: 4 },
    { id: "Z03", x: 0.38, y: 0.12, lon: -93.6391, lat: 41.9993, severity: 0.66, area_acres: 1.2, ndvi_anomaly: -0.13, ndmi_anomaly:  0.02, diagnosis: "biotic_stress", treatment_id: "beauveria", volume_gal: 1.80, priority: 6 },
    { id: "Z04", x: 0.55, y: 0.22, lon: -93.6333, lat: 41.9979, severity: 0.91, area_acres: 2.1, ndvi_anomaly: -0.23, ndmi_anomaly:  0.00, diagnosis: "biotic_stress", treatment_id: "beauveria", volume_gal: 3.15, priority: 1 },
    { id: "Z05", x: 0.63, y: 0.38, lon: -93.6306, lat: 41.9957, severity: 0.58, area_acres: 0.9, ndvi_anomaly: -0.11, ndmi_anomaly:  0.01, diagnosis: "biotic_stress", treatment_id: "beauveria", volume_gal: 1.35, priority: 9 },
    { id: "Z06", x: 0.81, y: 0.17, lon: -93.6245, lat: 41.9986, severity: 0.70, area_acres: 1.4, ndvi_anomaly: -0.15, ndmi_anomaly: -0.01, diagnosis: "biotic_stress", treatment_id: "beauveria", volume_gal: 2.10, priority: 5 },
    { id: "Z07", x: 0.18, y: 0.62, lon: -93.6459, lat: 41.9923, severity: 0.61, area_acres: 1.1, ndvi_anomaly: -0.12, ndmi_anomaly:  0.02, diagnosis: "biotic_stress", treatment_id: "bt", volume_gal: 1.10, priority: 8 },
    { id: "Z08", x: 0.34, y: 0.74, lon: -93.6404, lat: 41.9906, severity: 0.79, area_acres: 1.3, ndvi_anomaly: -0.18, ndmi_anomaly:  0.00, diagnosis: "biotic_stress", treatment_id: "bt", volume_gal: 1.30, priority: 3 },
    { id: "Z09", x: 0.49, y: 0.58, lon: -93.6353, lat: 41.9929, severity: 0.55, area_acres: 0.8, ndvi_anomaly: -0.10, ndmi_anomaly:  0.01, diagnosis: "biotic_stress", treatment_id: "bt", volume_gal: 0.80, priority: 10 },
    { id: "Z10", x: 0.68, y: 0.69, lon: -93.6289, lat: 41.9913, severity: 0.85, area_acres: 1.5, ndvi_anomaly: -0.20, ndmi_anomaly: -0.02, diagnosis: "biotic_stress", treatment_id: "bt", volume_gal: 1.50, priority: 7 },
    { id: "Z11", x: 0.86, y: 0.55, lon: -93.6228, lat: 41.9933, severity: 0.49, area_acres: 0.8, ndvi_anomaly: -0.09, ndmi_anomaly:  0.02, diagnosis: "biotic_stress", treatment_id: "bt", volume_gal: 0.80, priority: 11 },
    { id: "Z12", x: 0.30, y: 0.46, lon: -93.6418, lat: 41.9946, severity: 0.68, area_acres: 2.4, ndvi_anomaly: -0.14, ndmi_anomaly: -0.21, diagnosis: "water_stress", treatment_id: "none", volume_gal: 0, priority: 12 },
    { id: "Z13", x: 0.74, y: 0.84, lon: -93.6308, lat: 41.9892, severity: 0.60, area_acres: 1.8, ndvi_anomaly: -0.12, ndmi_anomaly: -0.18, diagnosis: "water_stress", treatment_id: "none", volume_gal: 0, priority: 13 },
    { id: "Z14", x: 0.58, y: 0.86, lon: -93.6323, lat: 41.9890, severity: 0.52, area_acres: 2.0, ndvi_anomaly: -0.13, ndmi_anomaly:  0.03, diagnosis: "nitrogen_deficiency", treatment_id: "none", volume_gal: 0, priority: 14 }
  ],
  fleet: [
    { id: "DR-1", home: [0.03, 0.30], carries: "beauveria", tank_gal: 6.0 },
    { id: "DR-2", home: [0.03, 0.70], carries: "bt", tank_gal: 6.0 },
    { id: "DR-3", home: [0.97, 0.50], carries: "beauveria", tank_gal: 6.0 }
  ]
};
