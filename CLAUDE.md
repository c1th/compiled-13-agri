# CLAUDE.md — FieldLoop

Working notes for Claude Code on this repo. Keep this file updated as the
project changes; it is the first thing read at the start of a session.

## Git workflow (required)

- **Always `git pull --rebase origin main` before making any edits.** A teammate
  works in this repo concurrently; editing on a stale tree causes conflicts.
- **Commit and push each change as you finish it — do not batch pushes to the
  end of the run.** A teammate is working in parallel and needs to see work as
  it lands, not in one drop at the end. The cycle per change is:
  `pull --rebase` → edit → verify → `commit` → `push`. Then repeat for the next
  change. A multi-part task means several commits and several pushes, not one.
- Push even when more work is coming in the same turn. Never leave a finished,
  verified change sitting unpushed while starting the next one.
- Branch is `main`; remote is `origin` (github.com/c1th/compiled-13-agri).

## What this is

Hackathon demo, ~90 min to build, optimized for an unbreakable live demo over
completeness. Satellite imagery flags crop-stress zones; a diagnosis step
separates pest problems from irrigation/nitrogen problems; only pest zones get
treated by a drone swarm. Headline: **treat ~9% of the field instead of 100%**.

What must stay visually dominant: the **DO NOT SPRAY** zones — dashed outline,
no fill, own group rendered last in the breakdown. They prove the system
*diagnoses* rather than just detects.

The reduction stat and dollars-saved card were **removed from the UI** at the
user's request. `summary.pct_reduction` / `dollars_saved` still exist in the
data contract — do not re-add cards for them. Acreage now lives on one line
under the map: region bounds · total field · acres treated.

## Hard constraints — do not deviate

- Vanilla JS + plain CSS. **No** React, TypeScript, Vite/webpack, build step,
  Tailwind, or runtime CDN links. Must run offline if venue wifi dies.
- Third-party libs are **vendored** into `vendor/` (Leaflet, Earth Engine JS
  client) and served locally. Never add a `<script src="https://...">`.
- One Node/Express server (`server.js`) serving static files + the API routes.
  `npm install && node server.js` is the entire setup.
- Dark UI: bg `#0F1419`, panels `#1A2129`, borders `#2A3441`, text `#E6EDF3`,
  muted `#8B98A5`, accent `#4ADE80` (hero stat only). System font for prose,
  monospace + tabular-nums for every number. No gradients, no emoji, no icon
  libraries. Target is a 1440px laptop screen only.

## Demo-safety rules (non-negotiable)

- Every panel init wrapped in try/catch — one broken panel must never blank the
  page (`safeInit` in `js/app.js`, `safeCall` in `js/drones.js`).
- Data fallback chain: analysis plan (sessionStorage) → `FIELD` (`data/zones.js`)
  → `STUB` (`data/stub-zones.js`, loaded first).
- No fetch calls on page load; nothing external at render time.
- Every network call has a timeout and a labeled local fallback:
  `/api/analyze` → deterministic mock plan after 900ms;
  `/api/purchase` → mock confirmation after 800ms.
- Press **R** on either page to reset to initial state for a second demo run.
- No console errors on a clean load.

## Data contract — FROZEN, do not rename fields

`data/zones.js` defines global `FIELD`; the analysis layer returns the same
shape. May be overwritten with real data shortly before demo.

```
FIELD = {
  meta:       { name, bounds:[W,S,E,N], image, image_size:[w,h], date },
  summary:    { total_acres, flagged_acres, pct_flagged, pct_reduction, dollars_saved },
  treatments: { <id>: { name, rate_gal_per_acre, color }, none: {...} },
  zones:      [{ id, x, y, lon, lat, severity, area_acres, ndvi_anomaly,
                 ndmi_anomaly, diagnosis, treatment_id, volume_gal, priority }],
  fleet:      [{ id, home:[x,y], carries, tank_gal }]
}
```

- `diagnosis` is one of `biotic_stress` | `water_stress` | `nitrogen_deficiency`.
- `treatment_id` keys into `treatments`; `none` means **do not spray**.
- **`x`/`y` are 0..1 relative to the image, ORIGIN TOP-LEFT. Never flip y.**
  Zone pixel position = `zone.x * imageWidth`, `zone.y * imageHeight`.
  There is no projection math anywhere in this codebase — keep it that way.
- KPI cards read `summary` directly and never recompute.

## Layout

- `index.html` — dashboard: Earth Engine map with region drawing and the
  weighted treatment layer, recommended distribution, run-analysis bar,
  procurement. **No KPI row and no inventory panel** — both removed on request.
- `drones.html` — drone operations: static zone map, per-drone config
  (origin via map click, pesticide, tank gallons), recommended assignments,
  swarm mount.
- `js/` — `app.js` (dashboard bootstrap), `breakdown.js` (recommended
  distribution), `geemap.js` (Leaflet + Earth Engine), `field-map.js` (static
  map, also the offline fallback), `weighted-map.js` (density renderer),
  `analyze.js`, `procure.js`, `drones.js`, `swarm-mount.js` (integration seam),
  `config.js` (public client IDs).
- `data/` — `zones.js` (FIELD), `stub-zones.js` (STUB fallback),
  `catalog.js` (biological catalog, mirrors the one in `server.js`).
- `vendor/` — Leaflet + Earth Engine client, committed for offline use.

## Treatment rendering — weighted, not circles

Treatment is drawn as a **continuous weighted density field**, never as
discrete circle markers. `js/weighted-map.js` accumulates a Gaussian per
treated zone (σ from area, peak from severity), tinted with the product colour
so overlapping products blend by weight, and returns a canvas. `geemap.js`
places it as an `L.imageOverlay` over the region bounds; `field-map.js` places
it as an `<img>` layer over the static imagery.

Treated zones still carry an *invisible* marker purely as a hover target for
the tooltip — the density layer is the only visual. Do-not-spray zones keep
their dashed outline on top. If you touch this, do not reintroduce filled
circles for treatment.

## Treatment selection — optimal, not stock-constrained

There is **no inventory input**. The analysis layer prescribes the
agronomically optimal biological per zone from a fixed catalog
(`BIOLOGICAL_CATALOG` in `server.js`, mirrored as `TREATMENT_CATALOG` in
`data/catalog.js`), with no quantity ceiling — availability is assumed
unlimited because more can always be bought. Rates step up 1.25x on zones with
severity > 0.8. Keep the two catalog copies in sync when editing.

## Credentials

Both optional; the app degrades gracefully without either.

- `.env` → `ANTHROPIC_API_KEY` — enables real Claude analysis on `/api/analyze`.
  Server-side only, never reaches the browser. Copy from `.env.example`.
  `.env` is gitignored.
- `js/config.js` → `EE_CLIENT_ID` / `EE_PROJECT` — enables the Earth Engine
  NDVI overlay. OAuth **client IDs are public**, so this file is committed;
  never put a secret here.

## Analysis layer

`POST /api/analyze` takes `{ bounds, total_acres }` and calls `claude-opus-5`
via the official SDK with structured outputs (strict JSON schema), refusal
handling, and server-side fallback. Returns a FIELD-shaped plan. Model IDs and
API shapes change — consult the `claude-api` skill before editing that call
rather than writing from memory.

## Teammate integration — swarm simulator

The teammate owns the swarm sim. **Do not build it.**

`js/swarm.js` (theirs) exposes `planSwarmRoutes(data, fleetOverride)` — pure
routing logic, no DOM. It is **not** yet wired to a page.

`js/swarm-mount.js` (ours) exposes `window.FieldLoop = { field, onZonesUpdated }`
and calls `window.initSwarm(mountEl, field)` if that function exists, otherwise
renders a bordered placeholder.

**Resolved:** `js/swarm.js` now also exposes `window.initSwarm(mountEl, field)`,
wired into `drones.html` after `js/swarm-mount.js`. It reads `field.fleet` when
the drone page has configured one (falls back to a random fleet only if empty),
picks the best of three routing strategies via `planSwarmRoutes`, animates
drone markers along their routes on a canvas in `#swarm-mount`, and calls
`window.FieldLoop.onZonesUpdated(field.zones)` once every drone finishes.
Styled to the dark theme (`--bg`/`--panel`/`--border`/`--text`/`--muted`,
monospace tabular-nums for the stats row). Not yet verified in a real browser
from this session — no Node/browser automation available in this sandbox: test
in a real run and report back if the canvas doesn't render or console errors.

## Log

- Built dashboard (map, breakdown, procurement) and drone ops page.
- Removed at the user's request — **do not reintroduce**: AI-agronomist panel,
  Channel3 procurement proxy, KPI row (pesticide-reduction + dollars-saved
  cards), pesticide-inventory panel.
- Pivoted the map from a static image to Leaflet + Earth Engine with region
  drawing, and added the Claude analysis layer.
- Replaced circle markers with the weighted treatment density map, and dropped
  the inventory input in favour of an unconstrained optimal prescription.
- Drone page assignments are greedy nearest-first within tank capacity, shown
  as colored rings + manifest cards. **No flight paths** — the swarm sim owns
  those; do not draw them here.
