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
- **The repo is PUBLIC. Never commit a credential.** `git add -A` has twice
  swept up a real key a human pasted into a tracked file — check `git diff
  --cached` for secrets before every commit. Live keys belong in `.env`
  (gitignored); tracked templates like `.env.example` keep blank placeholders.
  GitHub push protection is the last line of defence, not the first.

## What this is

Hackathon demo, ~90 min to build, optimized for an unbreakable live demo over
completeness. Satellite imagery flags crop-stress zones; a diagnosis step
separates pest problems from irrigation/nitrogen problems; only pest zones get
treated by a drone swarm. Headline: **treat ~9% of the field instead of 100%**.

What must stay visually dominant: the **DO NOT SPRAY** zones — dashed outline,
no fill, own group rendered last in the breakdown. They prove the system
*diagnoses* rather than just detects.

The dollars-saved card was **removed from the UI** at the user's request and
stays out. `summary.dollars_saved` still exists in the data contract — do not
re-add a card for it. **Partially reversed 2026-07-25:** the user asked for a
post-analysis impact strip with real derived numbers, so the pesticide-savings
percentage is back on screen inside the impact panel (js/impact.js) — not as a
standalone KPI card. Acreage still lives on one line under the map: region
bounds · total field · acres treated.

## Hard constraints — do not deviate

- Vanilla JS + plain CSS. **No** React, TypeScript, Vite/webpack, build step,
  Tailwind, or runtime CDN links. Must run offline if venue wifi dies.
- Third-party libs are **vendored** into `vendor/` (Leaflet, `three.module.js`)
  and served locally. Never add a `<script src="https://...">`; `import()` of a
  local `vendor/*.js` path is fine. Map *tiles* and the geocode lookup are
  runtime network calls, which is fine — they are user-triggered, never on page
  load, and every one has an offline fallback.
- One Node/Express server (`server.js`) serving static files + the API routes.
  `npm install && node server.js` is the entire setup.
- **UI direction pivoted (superseded the old dark-hackathon palette below):**
  the dashboard now mirrors a warm, soft, rounded "wellness app" visual
  language — cream/beige page background, large-radius (24px+) white/cream
  cards, one true-black high-contrast card for the swarm/map moment, soft
  blurred-color glow shapes used deliberately as a data-viz technique (tinted
  with our own real treatment colors, not arbitrary decoration), a circular
  ring stat, and habit-list-style rows for the treatment/procurement groups.
  This is an intentional full commit, not a hybrid — do not pull it back
  toward the old dark palette. Gradients are now allowed **only** as the soft
  blurred-glow stat visualization described above; don't use them elsewhere
  (no decorative background gradients, no gradient buttons). No emoji, no
  icon libraries beyond simple inline SVG/line icons for the nav rail. System
  font for prose still applies (rounded/geometric sans is fine, still no
  imported/CDN webfont); monospace + tabular-nums for every number, unchanged.
  Target is a 1440px laptop screen only.
- ~~Old dark UI (superseded, kept here for history): bg `#0F1419`, panels
  `#1A2129`, borders `#2A3441`, text `#E6EDF3`, muted `#8B98A5`, accent
  `#4ADE80`. No gradients.~~

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

**The dashboard is standalone.** Every link to `drones.html` was removed at the
user's request — `index.html` is the whole product now. `drones.html`,
`js/swarm.js`, `js/swarm-mount.js` and `js/field-3d.js` still exist and belong
to the teammate; do not wire navigation back to them without being asked.

- `index.html` — dashboard, laid out as **two columns** (`.layout`:
  `minmax(0,1fr) 420px`). Left (`.col-main`): how-to-use steps, location search,
  map with band selector and multi-region drawing, weighted treatment layer,
  run-analysis bar, field impact, calculate-routes bar, flight plan. Right
  (`.col-rail`, sticky, full viewport height): a scrolling area holding
  recommended distribution + drone fleet, with the system output console
  (`.rail-log`) pinned to the bottom quarter of the rail. Removed on request:
  the KPI row, the inventory panel, the pesticide shed, and procurement.
- `drones.html` — drone operations: static zone map, per-drone config
  (origin via map click, pesticide, tank gallons), recommended assignments,
  swarm mount.
- `js/` — `app.js` (dashboard bootstrap), `breakdown.js` (recommended
  distribution), `map-panel.js` (Leaflet map, regions, search), `bands.js`
  (spectral views + land-cover check), `field-map.js` (static map, also the
  offline fallback), `weighted-map.js` (classified treatment raster),
  `analyze.js`, `impact.js`, `fleet.js`, `trace.js` (system console),
  `drones.js`, `swarm-mount.js` (integration seam).
- `data/` — `zones.js` (FIELD), `stub-zones.js` (STUB fallback),
  `catalog.js` (biological catalog, mirrors the one in `server.js`).
- `vendor/` — Leaflet and three.js, committed for offline use.

## Map, bands and regions — no Earth Engine

**Earth Engine was removed at the user's request** (OAuth sign-in, vendored
client and credentials file all deleted). Do not reintroduce it.

`js/bands.js` computes the spectral views client-side from the Esri satellite
tiles: it reads tile pixels into a canvas and derives real RGB vegetation
indices (VARI, Excess Green, GLI) plus bare-soil and water indices, painted as
classified cells. Works with no key and no sign-in. Esri tiles send
`Access-Control-Allow-Origin: *`, which is what makes the pixel read legal —
if that ever changes, proxy the tiles through the server.

Honesty rule: true NDVI/NDMI need near-infrared, which public RGB basemaps do
not carry. Label the layers as what they actually are; don't call an RGB index
"NDVI" in the UI.

**Multiple regions** are supported. `map-panel.js` owns `regions[]`; each is
analysed separately and `analyze.js` merges them, recomputing zone `x`/`y`
against the **union extent** so the frozen 0..1 origin-top-left contract still
holds downstream. Each region gets its own raster overlay.

**Location search** accepts a place name (via the `/api/geocode` proxy, so the
browser never calls a third party directly) or raw `lat, lon`.

## Treatment rendering — classified raster, not circles

Treatment is drawn as a **weighted, quantized raster**, never as discrete
circle markers and never as a smooth gradient. `js/weighted-map.js` accumulates
a Gaussian per treated zone (σ from area, peak from severity), tinted with the
product colour so overlapping products blend by weight, then snaps intensity to
5 classes on a coarse grid. Render it with `image-rendering: pixelated` — the
hard cell edges are the intended look. `map-panel.js` places it as an
`L.imageOverlay` per region; `field-map.js` places it as an `<img>` layer.

Treated zones still carry an *invisible* marker purely as a hover target for
the tooltip — the density layer is the only visual. Do-not-spray zones keep
their dashed outline on top. If you touch this, do not reintroduce filled
circles for treatment.

## Land-cover check — never invent crops on bare ground

Before a region is analysed, `sampleRegionCover()` reads the imagery inside it
and classifies vegetation and water fraction. Open water, bare ground and
sparse scrub are marked not-plantable and **skipped**, with the reason shown in
the region row, the map status and the distribution panel. Without that check
the analysis layer makes the same call from the coordinates alone. Do not
weaken this — inventing crop zones on ocean or desert is the most obvious way
the demo can look fake.

## Treatment selection — optimal, not stock-constrained

The analysis layer prescribes the agronomically optimal biological per zone
from a fixed catalog (`BIOLOGICAL_CATALOG` in `server.js`, mirrored as
`TREATMENT_CATALOG` in `data/catalog.js`), with no quantity ceiling —
availability is assumed unlimited because more can always be bought. Rates
step up 1.25x on zones with severity > 0.8. Keep the two catalog copies in
sync when editing.

The pesticide shed was added on 2026-07-25 and **removed again later the same
day at the user's request** — `js/shed.js` is deleted. There is no inventory
input anywhere; the prescription is unconstrained and always optimal.

## Drone fleet and routing — on the dashboard

`js/fleet.js` owns fleet configuration and lives on `index.html` (the drone
page is not linked from anywhere). Per drone: one product, tank gallons,
battery km, and a launch point picked by clicking the map. "Randomise for demo"
spreads launch points around the field perimeter and varies tanks/batteries.

**Routing is the teammate's — do not reimplement it.** `js/fleet.js` calls
`planSwarmRoutes(data, fleet)` from `js/swarm.js` and only renders the result.
Fleet entries must match that contract exactly:
`{ id, carries, tank_gal, battery_km, x, y }` with x/y normalised 0..1,
origin top-left. Verified behaviour: a drone only visits zones whose
`treatment_id` equals what it carries, tank and battery are never exceeded, and
no zone is assigned twice. Uncovered zones are surfaced, not hidden.

`js/map-panel.js` provides `armOriginPick(cb)` (next map click returns lat/lon),
`drawDroneRoutes(result)` and `clearDroneRoutes()`. Note `swarm.js` also defines
`hexToRgba`, shadowing the one in `field-map.js` — the two are byte-identical,
so it is harmless; keep them in sync if either changes.

## Procurement — removed from the UI

The procurement panel was **removed at the user's request** and `js/procure.js`
is deleted. Do not re-add it. The server route `POST /api/purchase` (Channel3
proxy) still exists and works, but nothing on the dashboard calls it — leave it
in place unless asked; if it is ever wired back up, the old rule stands: on any
failure show a clearly-labelled estimate, never a fake confirmation.

## Credentials

Both optional; the app degrades gracefully without either.

- `.env` → `CHANNEL3_API_KEY` — enables real supplier sourcing on
  `/api/purchase`. Server-side only.
- `.env` → `ANTHROPIC_API_KEY` — enables real Claude analysis on `/api/analyze`.
  Server-side only, never reaches the browser. `.env` is gitignored; keep the
  tracked `.env.example` placeholder **blank**.
- No other credentials exist. Earth Engine is gone; the map and band views need
  no key at all.
- When the live call fails, `/api/analyze` returns a `reason` (no key, out of
  credits, key rejected, rate limited, refusal) and the UI states it, so a
  billing problem never masquerades as normal mock behaviour.

## Analysis trace — the live feed

`js/trace.js` renders a running log of the survey while it happens. Steps come
from three real places: `js/bands.js` (tile fetch, raster decode, index maths),
`js/analyze.js` (geodesy, geometry reconciliation, volume derivation), and the
server stream (schema compile, inference channel, per-zone delineation, the
model's own summarised reasoning).

Two deliberate choices, do not "fix" them:
- **Paced on purpose.** `tracePause` / `traceBeat` slow the client steps and the
  server sleeps between its own. The pipeline really is faster than a human can
  read; the delay is presentation, not work.
- **Jargon is accurate.** Every technical term maps to something the code
  actually does (EPSG:3857 reprojection, XYZ tile pyramid, chromatic
  coordinates, VARI/ExG/GLI, strict JSON Schema decode, Gaussian accumulation).
  Do not add terminology for a step that is not really performed.

The reasoning line is genuine model output — `thinking: {type:'adaptive',
display:'summarized'}` streamed from `/api/analyze/stream`.

## Analysis layer

`POST /api/analyze/stream` is the primary path: same input, but returns SSE
trace events (`step`, `thinking`, `usage`, `done`, `error`) so the UI can narrate
the run. `POST /api/analyze` is the non-streaming equivalent and the fallback.
Both share `buildAnalysisPrompt` and `failureReason`.

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

## Field impact panel

`js/impact.js` renders one hero figure (pesticide use cut, with a sprayed-vs-
field bar) plus four label/value rows — not a paragraph of prose. Every number
is derived from the plan (severities, areas, volumes); the modelling constants
`IMPACT_LOSS_MIN` / `IMPACT_LOSS_SPAN` / `IMPACT_EFFICACY` live at the top of
the file. Keep it structured and scannable; do not turn it back into plaintext.

## PENUMBRA RNAi safety engine — removed

A teammate landed a PENUMBRA RNAi safety engine (dashboard panel, `/safety`
page, `/api/rnai/*` and `/api/channel3/offers` routes, PDF dossier via pdfkit).
**The user asked for all of it to be removed** — `safety.html`, `js/safety.js`,
`js/rnai-entry.js`, `data/rnai.js`, the server routes, the CSS block and the
pdfkit dependency are all gone. Do not reintroduce it. The `penumbra/` Python
research directory is untouched — it is a separate project, not wired to the
dashboard.

## Log

- Built dashboard (map, breakdown, procurement) and drone ops page.
- Reinstated Channel3 sourcing (real listings/prices) and brought full drone
  fleet configuration + route planning onto the dashboard.
- Added the live analysis trace (streamed reasoning + pipeline telemetry) and
  made the dashboard standalone by removing all drone-page navigation.
- Removed at the user's request — **do not reintroduce**: AI-agronomist panel,
  dollars-saved card. (Two earlier removals were **reversed on 2026-07-25**:
  the user asked for the crop-aware pesticide shed and the post-analysis
  impact strip — replacing the old inventory panel and KPI row — and the
  teammate is reinstating Channel3 sourcing in `/api/purchase`.)
- Pivoted the map from a static image to Leaflet with region drawing, and added
  the Claude analysis layer.
- Removed Earth Engine entirely; band views are now computed from the imagery.
- Added location search, multiple regions, the land-cover check, the classified
  pixel raster, and the how-to-use steps.
- Replaced circle markers with the weighted treatment density map, and dropped
  the inventory input in favour of an unconstrained optimal prescription.
- Drone page assignments are greedy nearest-first within tank capacity, shown
  as colored rings + manifest cards. **No flight paths** — the swarm sim owns
  those; do not draw them here.
- Vendored `three.module.js` and added a decorative (non-routing) `js/field-3d.js`
  "3D field preview" panel on `drones.html` — separate from the swarm sim,
  does not touch `js/swarm.js` / `js/swarm-mount.js` / `#swarm-mount`.
- Added the crop-aware pesticide shed (`js/shed.js`, `data/crops.js`) and the
  `/api/crop-intel` endpoint — Claude identifies the crop from region
  coordinates and returns a tailored product list, with a latitude-band
  offline fallback that is clearly labelled as an estimate.
- Pivoted the whole visual system to the warm/soft/rounded language described
  in Hard constraints above, at the user's explicit request ("fully commit,
  no middle ground") — full reskin of `styles.css`, `index.html`, `drones.html`.
