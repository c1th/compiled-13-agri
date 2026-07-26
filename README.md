# FieldLoop

Precision crop-stress dashboard. Satellite imagery flags stress zones, diagnosis
separates pest pressure from irrigation/nitrogen issues, and only pest zones get
treated — ~9% of the field instead of 100%.

## Run

```
npm install express dotenv
node server.js
```

Open http://localhost:3000. Press **R** to reset all panels for a second demo run.

## Swarm simulator integration (teammate contract)

1. Function to define: `window.initSwarm(mountEl, field)` — we call it on load if it exists.
2. Add your `<script>` tag in `index.html` at the marked slot **above** `js/app.js`.
3. Arg 1 `mountEl`: the `<div id="swarm-mount">` element — render your canvas into it.
4. Arg 2 `field`: the FIELD object — `{ meta: {name, bounds, image, image_size, date}, summary, treatments, zones, fleet }`.
5. Each zone: `{ id, x, y, lon, lat, severity, area_acres, ndvi_anomaly, ndmi_anomaly, diagnosis, treatment_id, volume_gal, priority }` — `x`/`y` are 0..1 relative to the field image, **origin top-left, never flip y**; each fleet drone: `{ id, home: [x,y], carries, tank_gal }`. Treat only zones whose `treatment_id !== "none"`.
6. After treating zones, call `window.FieldLoop.onZonesUpdated(zones)` to refresh the dashboard panels.
