# CLAUDE.md — FieldLoop

Working notes for Claude Code on this repo. Keep this file updated as the
project changes; it is the first thing read at the start of a session.

## Git workflow (required)

- **Always `git pull --rebase origin main` before making any edits.** A teammate
  works in this repo concurrently; editing on a stale tree causes conflicts.
- **Always `git push origin main` after committing.** Do not leave commits
  sitting locally — the teammate needs to see them.
- Commit after each self-contained change with a short message.
- Branch is `main`; remote is `origin` (github.com/c1th/compiled-13-agri).

## What this is

Hackathon demo, ~90 min to build, optimized for an unbreakable live demo over
completeness. Satellite imagery flags crop-stress zones; a diagnosis step
separates pest problems from irrigation/nitrogen problems; only pest zones get
treated by a drone swarm. Headline: **treat ~9% of the field instead of 100%**.

Two things must stay visually dominant:
1. The reduction stat (91% less pesticide) — hero styling, accent `#4ADE80`.
2. The **DO NOT SPRAY** zones — dashed outline, no fill, distinct group. These
   prove the system *diagnoses* rather than just detects.

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

- `index.html` — dashboard: KPI row, Earth Engine map (region drawing),
  pesticide inventory, run-analysis bar, treatment breakdown, procurement.
- `drones.html` — drone operations: static zone map, per-drone config
  (origin via map click, pesticide, tank gallons), recommended assignments,
  swarm mount.
- `js/` — `app.js` (dashboard bootstrap), `kpi.js` (KPI + treatment breakdown),
  `geemap.js` (Leaflet + Earth Engine), `field-map.js` (static map, also the
  offline fallback), `inventory.js`, `analyze.js`, `procure.js`, `drones.js`,
  `swarm-mount.js` (integration seam), `config.js` (public client IDs).
- `data/` — `zones.js` (FIELD), `stub-zones.js` (STUB fallback).
- `vendor/` — Leaflet + Earth Engine client, committed for offline use.

## Credentials

Both optional; the app degrades gracefully without either.

- `.env` → `ANTHROPIC_API_KEY` — enables real Claude analysis on `/api/analyze`.
  Server-side only, never reaches the browser. Copy from `.env.example`.
  `.env` is gitignored.
- `js/config.js` → `EE_CLIENT_ID` / `EE_PROJECT` — enables the Earth Engine
  NDVI overlay. OAuth **client IDs are public**, so this file is committed;
  never put a secret here.

## Analysis layer

`POST /api/analyze` takes `{ bounds, total_acres, inventory }` and calls
`claude-opus-5` via the official SDK with structured outputs (strict JSON
schema), refusal handling, and server-side fallback. Returns a FIELD-shaped
plan. Model IDs and API shapes change — consult the `claude-api` skill before
editing that call rather than writing from memory.

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

- Built dashboard (KPI, map, breakdown, procurement) and drone ops page.
- Removed an earlier AI-agronomist panel and a Channel3 procurement proxy at
  the user's request — do not reintroduce either.
- Pivoted the map from a static image to Leaflet + Earth Engine with region
  drawing, and added the Claude analysis layer.
- Drone page assignments are greedy nearest-first within tank capacity, shown
  as colored rings + manifest cards. **No flight paths** — the swarm sim owns
  those; do not draw them here.
