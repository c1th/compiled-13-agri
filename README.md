# FieldLoop

Precision crop-stress dashboard. A region is selected on a real satellite map
(Google Earth Engine NDVI overlay), the pesticide inventory is declared, and a
Claude-powered analysis layer produces a treatment plan that separates pest
pressure from irrigation/nitrogen issues — only pest zones get treated (~9% of
the field instead of 100%). The plan then drives the drone operations page.

## Run

```
npm install
node server.js
```

Open http://localhost:3000. Press **R** on either page to reset for a second
demo run.

- `.env` (optional): `ANTHROPIC_API_KEY=` — enables the real Claude analysis on
  `/api/analyze`. Without it (or offline) the app falls back to a clearly-labeled
  mock analysis, so the demo never dead-ends. Copy from `.env.example`.
- `js/config.js` (optional): set `EE_CLIENT_ID` / `EE_PROJECT` (a Google Cloud
  project with the Earth Engine API enabled and an OAuth Web client ID for
  `http://localhost:3000`) to enable the "Connect Earth Engine" NDVI overlay.
  Without it the map runs on satellite base imagery; fully offline it falls back
  to a static field image.

## Pages

- `index.html` — dashboard: KPI row, Earth Engine map with two-click region
  drawing, pesticide inventory, "Run analysis" (Claude → treatment plan),
  treatment breakdown with the do-not-spray group, procurement.
- `drones.html` — drone operations: configure each drone individually (origin
  via map click, pesticide, tank gallons), "Recommend assignments" shows which
  zones each drone covers. No flight-path drawing — that's the swarm sim's job.

## Swarm simulator integration (teammate contract)

1. Function to define: `window.initSwarm(mountEl, field)` — called on the drone
   page load if it exists.
2. Add your `<script>` tag in `drones.html` at the marked slot — after
   `js/swarm-mount.js` and before the inline `initDronesPage()` call.
3. Arg 1 `mountEl`: the `<div id="swarm-mount">` element — render your canvas into it.
4. Arg 2 `field`: the FIELD-shaped plan — `{ meta: {name, bounds, image, image_size, date}, summary, treatments, zones, fleet }`.
5. Each zone: `{ id, x, y, lon, lat, severity, area_acres, ndvi_anomaly, ndmi_anomaly, diagnosis, treatment_id, volume_gal, priority }` — `x`/`y` are 0..1 relative to the field image, **origin top-left, never flip y**. Treat only zones whose `treatment_id !== "none"`.
6. After treating zones, call `window.FieldLoop.onZonesUpdated(zones)` to refresh the page's views.
