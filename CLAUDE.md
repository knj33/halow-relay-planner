# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

HaLow Relay Planner: a browser-only prototype (React 19 + three.js + Zustand, Vite, TypeScript) for planning Wi-Fi HaLow (802.11ah, sub-GHz) relay deployments between two surface endpoints **A** and **B** on **Earth, the Moon or Mars**. The user clicks a 3D globe to place nodes; the app streams real elevation for a square "planning area" around them, checks every node pair against terrain + a link budget, auto-places relays, attaches base stations to a visible satellite, and compares the relay plan against conventional alternatives on cost and coverage.

There is no backend, no accounts, no API keys. Everything is computed client-side; imagery and elevation are fetched from public sources.

The Moon is the motivating case (no atmosphere, small radius so the horizon is close, extreme delivery cost per kg); Mars follows exactly the same code paths as the Moon (global USGS mosaic + bundled fallback, smooth imagery globe + relief patch, k locked to 1); Earth exists as a like-for-like reference.

**The UI is Mars-only for now.** `VISIBLE_BODIES` (`engine/types.ts`) is `['mars']`: the store starts on Mars, the masthead body switch is hidden while it has one entry, and importing an Earth or Moon file is rejected. Earth and Moon code, data and tests are kept; adding them back to `VISIBLE_BODIES` restores everything.

**Adding or changing a body** touches: `BodyId`/`BODY_IDS` (`engine/types.ts`), `BODIES` (`bodies.ts`), `AREA_LIMITS`/`NATIVE_AREA_LIMITS` (`area.ts`), `defaultCostModel`, `defaultSatellites`, `modelAssumptions`, the synthetic registry (`engine/terrain/index.ts`), `MOSAIC_TERRAIN` (`src/terrain/sources.ts`), `GLOBE_SOURCES`/`BASE_TEXTURE` (`scene/GlobeView.tsx`), `PRESETS`/`DEMO_*` (`presets.ts`), `PRESET_VIEW_M` (store), the `[data-body]` accent in `styles.css`, and the C helper (`MOON_MOSAICS`/`MARS_MOSAICS`, request limits, `/health` `bodies`). Most of these are `Record<BodyId, …>`, so `tsc` lists what is missing.

## Commands

Requires Node 20+.

```bash
npm install
npm run dev          # http://localhost:5173 (runs sync:engine first)
npm test             # Vitest, node environment, tests/**/*.test.ts
npm run typecheck    # tsc --noEmit
npm run build        # typecheck + vite build to dist/ (runs sync:engine first)
npm run preview      # serve dist/ on :4173 (judge smoothness here, not on the dev server)

npx vitest run tests/routing.test.ts                 # one file
npx vitest run tests/present.test.ts                 # presentation engine
npx vitest run -t "bridges a ridge with a single relay"  # one test by name
```

No linter or formatter is configured. `strict` TypeScript is the only static check.

Native helper (optional, POSIX only: Linux/WSL, needs `libcurl`, `libpng`, x86-64):

```bash
make -C native            # builds native/relay-engine (-march=x86-64-v3)
make -C native portable   # baseline x86-64 build
make -C native test       # deterministic regression tests, no network
./native/relay-engine [--port 8765] [--threads N] [--origin URL]...
```

`scripts/sync-engine.mjs` (the `predev`/`prebuild` hook) copies `native/` sources and tars `native/` + `extensions/` into `public/engine/` so the app can offer them as downloads. Those outputs are gitignored; do not edit them. One-off asset generators for committed files: `scripts/build-moon-tiles.mjs` → `public/moon-terrain/`; `scripts/build-mars-tiles.mjs <megt90n000eb.img>` (NASA PDS MOLA MEGDR 16 px/deg, raw MSB int16, 0°E origin) → `public/mars-terrain/`; `scripts/build-trek-base.py <Trek tile URL> <out.jpg> 2` (Pillow; stitches one NASA Trek EPSG:4326 zoom level) → `public/base/mars.jpg`; `build-base-textures.mjs` (needs ImageMagick) for the others.

## Domain model

**Nodes** (`NodeKind`): `A` and `B` (the two endpoints, at most one each, ids `'A'`/`'B'`), `relay` (ids `relay-N`), `base` (base station with a satellite terminal, ids `base-N`). Each has `enabled` (disabled = treated as absent, used to simulate failure) and `origin: 'manual' | 'auto'`. "Plan relays" starts clean (user request): `clearForPlan` removes every relay, hand-placed ones included, re-enables failed nodes and ends the failure simulation, keeping A, B, base stations, waypoints, zones and settings. `applyPlan` then replaces all relays with the planned ones. `origin` still records whether a relay came from the planner; moving an auto relay turns it manual. The engine planner itself can still reuse existing relays passed to it (`tests/routing.test.ts`); the app just no longer passes any.

**Link model** (`src/engine/propagation.ts`, `evaluateLink`) is the single physical model that everything else reuses:

- Sample the terrain profile between the two antennas, subtract the curvature bulge `d1*d2 / (2*k*R)`, compare with the straight ray.
- Loss = free-space path loss + one ITU-R P.526 knife-edge estimate for the worst Fresnel intrusion.
- Status: `fail` if geometric LOS is blocked **or** margin (`rxPower - sensitivity`) is below `requiredMarginDb`; `marginal` if LOS is clear and margin OK but less than 60% of the first Fresnel zone is clear; otherwise `good`.
- `reasons[]` carries human-readable explanations shown in the UI, including whether curvature (not terrain) is what blocks the ray.

**Bodies** (`bodies.ts`): Moon radius 1737.4 km and Mars 3389.5 km (IAU mean), both with k locked to 1 (`makeEnv` ignores any requested k; Mars's CO₂ atmosphere refracts negligibly); Earth 6371 km with editable k (default 4/3). `kFactorNote` is the UI hint text.

**Network analysis** (`network.ts` + `graph.ts`): all enabled pairs are evaluated; non-`fail` links form a graph. The A→B route is fewest hops, ties broken by the best weakest-link margin (Dijkstra on the lexicographic key `(cost, -bottleneck)`). Topology is `incomplete | disconnected | direct | chain | mesh`, where `mesh` means ≥2 node-disjoint A–B paths (max-flow with node splitting). `criticalIds` are single points of failure.

**Auto-placement** (`planner.ts`, `planRelays`): one candidate site per grid cell at that cell's highest elevation sample (auto ≈ one per 1.2 km, 6–32 per side) → evaluate every pair within free-space range → find the A–B path adding the fewest *new* relays (existing nodes cost 0) → optionally a second path sharing no interior node (`redundancy`) → attach each base station with the fewest extra relays. It is a heuristic over samples: "no-route" means none found among candidates, not that none exists.

**Backhaul** (`backhaul.ts`): satellites are a fixed illustrative snapshot, not an ephemeris. Their sub-satellite points are `x, y` in the *planning area's local frame* (so they are relative to wherever the area is). A base station picks the closest satellite whose elevation clears the terrain skyline in that azimuth plus `minElevationDeg`. Geometry only; no satellite link budget.

**Comparison** (`compare.ts`, `analyzeScenario`): four strategies evaluated on the same grid, radio and cost placeholders: `mesh` (this plan), `direct` (same radios, relays removed), `towers` (tall masts re-planned with the same heuristic), `satellite` (a terminal per user, coverage = sky visibility). Coverage (`coverage.ts`) is the share of cells from which a client radio at `clientHeightM` can close a link, by the same `evaluateLink`, to any node in A's connected component. Cost (`cost.ts`) is `hardware + install + mass × deliveryUsdPerKg`; lunar defaults are dominated by delivery at $1M/kg.

**The comparison is not shown in the UI** (team decision): no strategy cards, no coverage overlay on the map, no coverage figure in the plan readout, and the comparison-only cost inputs (`COMPARISON_ONLY`: masts, per-user terminals, coverage target) are hidden. `analyzeScenario` still runs in the worker because the plan readout takes each base station's chosen satellite from it.

The **Costs** tab (`components/CostsPage.tsx`) holds everything financial: the bundled Arcadia demo priced line by line from its manifest (no elevation fetch) against the budget (Mars default US$1 billion, the team's budget), a table of each Mars default's basis (`MARS_COST_BASIS`: sourced / derived / team estimate) with numbered references (`COST_SOURCES`), and the cost inputs. Mars delivery is `MARS_LANDED_USD_PER_KG` (Mars 2020: $2.7B ÷ 1,025 kg); if you change a Mars cost default, update its basis entry and sources too.

Every number in `radio.ts`, `cost.ts` and the satellite list is an explicitly illustrative placeholder. `assumptions.ts` is the user-facing statement of what is and is not modelled; it is rendered in the UI **and embedded in every export**, so when the model changes, update it too.

## Architecture

### Layering

- `src/engine/` — pure TypeScript, no DOM, no React, no fetch. All physics, graph search, planning, cost, serialization, and the terrain *resampling maths*. Everything is re-exported from `src/engine/index.ts`. This is what the tests exercise and what runs inside the worker. Keep it free of browser APIs.
- `src/terrain/` — browser adapters that actually fetch data (PNG tile decode via `OffscreenCanvas`, HTTP range reads of a remote TIFF) and inject it into the engine's loaders (`TileFetcher`, `EquirectRaster` interfaces in `engine/terrain/real.ts`).
- `src/native/engine.ts` — client for the optional localhost native helper.
- `src/state/store.ts` — single Zustand store: the deployment, the planning area, terrain loading, UI tool state.
- `src/worker/` — one module worker running `planRelays` and `analyzeScenario`; `client.ts` exposes `runJob(job)` as a promise. The `HeightGrid` is structured-cloned on each job.
- `src/App.tsx` — orchestration: derives engine inputs from the store, runs cheap analysis synchronously in `useMemo`, dispatches heavy jobs to the worker.
- `src/scene/GlobeView.tsx` — rendering and picking only (react-three-fiber + `3d-tiles-renderer`). It never feeds the physics.
- `src/components/` — sidebar and result panels.

### Two coordinate systems (the key thing to get right)

Nodes are **stored and exported as lat/lon** (`GeoNode`). All calculation happens in a **local east/north metre frame** on a `HeightGrid` covering the current `PlanningArea { centre, sizeM }`:

- `engine/terrain/geo.ts`: `geoToLocal` / `localToGeo` are an azimuthal-equidistant mapping on a sphere of the body radius.
- `engine/area.ts`: grid `x = east + sizeM/2`, `y = north + sizeM/2`; row 0 is the south edge. `toEngineNodes` converts `GeoNode[]` → `SiteNode[]` and reports nodes that fall outside the area (those are excluded from analysis and block planning).
- Planner output is in grid metres and is converted back with `gridToGeo` against the area the plan was computed for (`applyPlan(result, area)`).

All engine quantities are SI (metres, Hz, dB) unless the name says otherwise (`frequencyMHz`, `txPowerDbm`, …).

### Planning area lifecycle

`fitArea` picks the smallest allowed square from a per-body list of step sizes (`AREA_LIMITS`; larger `NATIVE_AREA_LIMITS` when the native engine is available) that holds all nodes with margin, and **keeps the current area if nodes still fit** so adding a node does not trigger a re-download. `gridPointsFor` sets resolution to match the source data (Moon: 118 m target, ≤257 points per side in-browser; Earth: 75 m, ≤769).

Store flow: any node mutation → `syncArea()` → (if auto-fit) `fitArea` → `loadTerrain()` when the area changed. `terrainArea` is the area the loaded grid belongs to and may lag `area`; `App` only computes when `sameArea(area, terrainArea)` and status is `ready` (`gridReady`). A module-level `terrainToken` discards stale loads; anything that resets the environment must bump it. Switching body clears the whole deployment and resets body-specific defaults (cost model, satellites, k).

### Terrain sources

| Body | Primary | Fallback |
|---|---|---|
| Moon | USGS LRO LOLA 118 m global TIFF, read with HTTP range requests one row-block at a time (`terrain/rangeTiff.ts` → `loadEquirectRegion`) | bundled 16 px/deg Terrarium pyramid in `public/moon-terrain/` (~1.9 km/px; flagged in the UI as orientation-only) |
| Mars | USGS HRSC + MOLA blended DEM v2, 200 m (11.4 GB BigTIFF), same range reader | USGS MGS MOLA 463 m TIFF, then bundled MOLA MEGDR 16 px/deg pyramid in `public/mars-terrain/` (~3.7 km/px) |
| Earth | Mapzen Terrarium PNG tiles on AWS, ≤64 tiles per area (`loadTerrariumRegion`) | none (error + retry) |

The Moon and Mars share one path: `src/terrain/sources.ts` (`MOSAIC_TERRAIN`) lists each body's mosaics best-first plus its bundled pyramid, and builds the `TerrainMeta` attribution for both the browser loader (`areaTerrain.ts`) and the native client. Any new mosaic must be uncompressed, single-band signed 16-bit, one row per strip with contiguous rows, west edge −180°, top +90° (a GDAL `scale` tag is honoured; Mars values are plain metres). All the USGS `asc-pds-services` S3 mosaics send `Access-Control-Allow-Origin: *`; NASA Trek imagery tiles do too.

`loadTerrain` tries the native engine first when it is detected **and** `engineInfo.bodies` includes the current body (`nativeActive` in the store; helpers older than 0.3.0 don't report `bodies` and are treated as Earth + Moon only). On any failure it marks the engine unavailable and falls through to the browser loader. Synthetic terrain (`engine/terrain/synthetic.ts`, the `TerrainSource` registry in `engine/terrain/index.ts`) is no longer reachable from the UI flow; it survives for tests and as the documented extension point for new sources.

### Main thread vs worker

- Main thread, synchronous: `evaluateNetwork` + `analyzeNetwork` over placed nodes (small N), so links, route and critical nodes update instantly.
- Worker: `plan` jobs (on button press) and `analyze` jobs (coverage maps + four-strategy comparison, debounced 250 ms on any input change). `analyze` itself calls `planRelays` for the tall-mast strategy.
- `displayLinks` (`src/links.ts`) filters which failed pairs are worth drawing: only A–B, or pairs that free-space loss alone would allow.

### Survey map and visual design

The UI follows a "Mars survey" design language (reference image in `design idea/`): near-black warm ground, terrain carries the colour, hairline geometry, small widely tracked Jost capitals, IBM Plex Mono for numbers. Tokens live in `:root` in `styles.css` and `PALETTE`/`STATUS_COLOR` in `theme.ts` (status colours always also differ by dash pattern). Layout: masthead → map frame (Survey | Globe toggle, round tool buttons on the right) → plan readout with the route card (`RouteDetail`) overlapping the map → Setup panels.

The 2D survey map (`components/SurveyMap.tsx`) is available whenever a grid exists; choosing Survey with no area opens one at the globe's view centre, and the app switches to it once A and B sit on a loaded grid. It fills the map frame with a pan/zoom view (`View { cx, cy, zoom }`, zoom relative to "fit whole area"; wheel/pinch/drag, +/−/0/arrow keys, Whole area button). It opens on the whole area, centred (zoom 1), and re-opens that way when the frame changes size by more than 15% (full screen, live slides); the side space a square area leaves on a wide frame holds the map panels (`.map-info` left, `.map-tools` right). The view switch has a Full screen toggle that puts the whole `.map-frame` (any view) into browser full screen. On a live presentation slide `.app.is-live` makes the map frame fixed to the viewport and hides everything else plus the planner's banners, hints and "why this path" (the slide caption, which sits in the right side column, replaces them). Survey3D shows the same coverage/hazard shading (a second transparent mesh with `safetyCanvas`) and the red/green failure-simulation routes. Drawing is shared with the globe in `survey/draw.ts`: rasters and `Path2D`s are built once per grid in grid metres and `drawSurvey` renders them under any view transform (hillshade at 3× display exaggeration, coverage, >25° hatching, contours, drainage channels, grain). The SVG overlay uses a `viewBox` equal to the visible window and sizes strokes by `k` (metres per CSS px). The globe drapes the same layers plus the walking route over the planning area (`SurveyOverlay` in `GlobeView`, every body). Clicks convert grid metres → geo with `gridToGeo(terrainArea, …)` and go through `surfaceClick`; a drag never places a node.

**Crew route, safety and failure simulation** (`engine/traverse.ts`, pure):
- `hazardBase` holds per-grid facts: slope, and depression fill depth from `priorityFlood`.
- `hazardClasses` builds per-node classes from the settings (`SafetySettings`; conservative default 15° max slope, 300 m from cliffs steeper than 25°, 150 m outside rims of depressions deeper than 3 m) and the drawn no-go zones. Buffers come from a chamfer `distanceTransform`.
- `coverageField` counts how many working nodes (App passes only `servingNodeIds`: nodes still connected to A or a base station, so relays orphaned by a failure don't count) can reach a crew radio at `clientHeightM` in each cell: a radial line-of-sight sweep within `maxFreeSpaceRangeM`, curvature included, no Fresnel allowance.
- `safeTraverse` is A* from A through `waypoints` to B. Costs come in three tiers: hazard (1e5/m) ≫ no signal (250/m) ≫ effort. It always returns a path and reports `gaps` and `hazards` stretches.

These run in the `'traverse'` worker job on its own worker channel (`runJob(job, 'traverse')`), which caches `hazardBase` per `gridKey`. `App` re-runs the job on any node, waypoint, zone or safety change, and the job replaces the old `walkingRoute`.

Waypoints (`wp-N`), zones (`zone-N`, lat/lon polygons) and `safety` live in the store and in `DeploymentState`. The export puts them under `deployment.waypoints`, `deployment.noGoZones` and top-level `safety`; the importer treats all three as optional, so older files load.

The failure simulation (tool `fail`/F, Random failure, Restore all) only toggles `enabled`. `App` holds a `Sim` state machine, `failing` (900 ms burst) → `rerouting` → `done` once the traverse result arrives, and `SurveyMap` animates it: the old radio route and crew path turn red from the failed node on (`routeCut`/`walkCut` in `SimView`; the walk is cut at its closest approach to the node) while the part before it fades, then the new route and crew path draw in with a green glow (`.sv-chosen`) over the red, while SMIL signal pulses run along the route all the time. The animation follows a Motion setting: On by default, Auto (system reduce-motion) or Off, stored in localStorage `halow.sim.motion`. Set `.motion-on` on `.app` to enable the CSS animations; that is needed because the test Chrome reports reduce-motion.

**Premade demo** ("Demo" next to Globe in the map's view switch): a bundled 200 km Mars scenario at the SpaceX Starship candidate landing site in Arcadia Planitia (HiRISE ESP_060706_2195, 39.09°N 189.79°E). `public/demo/arcadia-200km.bin` is a 1025² int16 grid (0.25 m steps above `offsetM`) of the HRSC + MOLA 200 m DEM, and `arcadia-200km.json` holds the area, radio (3 m masts), planner options, node roles, all 68 nodes and the plan (mesh: 25 hops, 2 node-disjoint paths, 63 relays, 3 base stations). `loadPremadeDemo` in the store installs it with `autoFit: false` and `terrainStatus: 'ready'`, so nothing downloads and nothing refits. 200 km is beyond `AREA_LIMITS`/`NATIVE_AREA_LIMITS` (60/120 km), which is why it is built offline. The flat-frame curvature and local projection stay small-angle at 200 km on Mars (about 3.4°), but this is the largest area the app has seen, so treat it as the stress case. Regenerate with `npx vitest run --config scripts/demo/vitest.config.ts` (network, about 40 s). `tests/demo.test.ts` decodes the bundle and checks that the app's own link model still connects it.

**Detail cache** (`survey/tileCache.ts` + `worker/tiles.worker.ts`): once a grid and its survey layers exist, a pool of workers renders the whole area as a 512 px tile pyramid up to 8192 px across (~341 MB, ~2–3 s). Each tile pixel is shaded from `sampleBicubic` (Catmull-Rom, display only; the link model keeps bilinear), and contours are anti-aliased per pixel by distance to the nearest level. Pixels are kept as plain `Uint8ClampedArray`s; only tiles being drawn go into a 96-canvas LRU pool, because keeping the whole pyramid as GPU-backed `ImageBitmap`s starved the GPU. `SurveyMap` draws from the cache once level 0 is done (falling back to `drawSurvey` before that) and caps zoom at 2× the top level. One cache exists at a time (`tileCacheFor`), shared with the 3D view. Benchmarks of frame time must run in a foreground tab: Chrome throttles background tabs to ~1 frame per 2 s.

**3D relief** (`components/Survey3D.tsx`, the "3D relief" view): r3f mesh of the bicubic surface in km, curvature drop applied with the effective radius k·R like the link model, the cached map (≤4096 px level) as texture, dark side walls, links between true antenna heads, and the walking route draped on the surface. The exaggeration slider scales terrain and antennas together, so whether a straight link cuts the terrain stays true. Labels are canvas sprites (drei `Html` failed to mount its first portal under React 19). The view is read-only; nodes are placed in Survey or Globe. The globe's 3d-tiles LRU cache is enlarged (`TileCacheBoost`) so streamed imagery is kept rather than re-fetched.

`engine/survey.ts` (pure): `slopeGrid`, `hillshade`, `surveyLayers` and `walkingRoute` (A* with a slope limit, main thread, through the radio route). In `surveyLayers`, drainage and depressions run on a grid resampled to `sourceResolutionM` (from `TerrainMeta.resolutionM`) when the source is coarser than the grid, and a channel cell must be concave (valley test over a two-cell ring). Without those two rules, bilinear creases and smooth planes produce rows of straight fake channels. Contours stay on the full grid, so on coarse fallback data a source pixel shows as a tilted facet with evenly spaced contours.

### Presentation engine

`src/present/` plays PowerPoint-style decks over the app (full guide: `docs/PRESENTATION.md`). `engine.ts` is the pure navigation core (position `{slide, step}`, builds, clamping, progress, `#/present[/<deck>]/<n>[.<step>]` hash, key/swipe mapping, `fitStage`), tested in `tests/present.test.ts`. `Presenter.tsx` is lazy-loaded by `App` (Present link, `P`, or a `#/present` hash) and lays slides out on a fixed 1920×1080 stage scaled by one transform; only the current slide and its neighbours are mounted, and transitions are CSS opacity/transform between `is-before`/`is-current`/`is-after`. Keys are captured on `window` in the capture phase. Decks live in `src/present/decks/`: `DECKS[0]` is the default, the team's talk `smms.tsx` (SMMS, Spacial Mars Mesh Systems: title, problem in Georgian, `MeshHeal` animation, hardware (`hardware.tsx`, shared with the sample deck), SSA Mesh Oriented OS screenshot, Mars relay-orbiter-vs-mesh comparison with sources, live demo ending in a 3D relief fly-around via `showRelief`, thanks); `sample.tsx` (engine test card, hardware slide) is at `#/present/sample`. Georgian text renders in Noto Sans Georgian (in the `--display` stack after Jost). A `kind: 'live'` slide shows the planner itself under a caption card and drives it through `bridge.ts` (`loadPremadeDemo`, `ensureDemo`, `setView`, `showRelief`, `planRelays`, `randomFailure`, `restoreAll`), which `App` registers; `ensureDemo` is a no-op while the demo grid it loaded is still in the store, so a deck's `onOpen` can preload the demo (and the survey map's detail cache) behind the title slide. A slide's `autoAdvanceMs` steps it on by itself if nobody navigates; slides never touch the store directly. `state.ts` (`usePresentation`) tells `App` whether a stage slide covers the planner: then `.app.is-covered` hides it with `content-visibility`, its tool shortcuts are ignored, and the globe/3D render loops stop. Open windows sync position over `BroadcastChannel('halow-present')`.

### Performance model

The app must stay smooth on CPU-bound machines (full write-up and measurements: `docs/PERFORMANCE.md`). Load-bearing pieces: `GlobeView` and `Survey3D` take `active` and use `frameloop` `'demand'`/`'never'` (call `invalidate()` from any new animation); `App` subscribes with a `useShallow` selector excluding `viewCentre`, and passes memoised children stable callbacks (`useStableCallback`); `SurveyMap` keeps a committed view (React state) and a live gesture view (`liveRef`), moves the overscanned `.survey-stage` with a CSS transform during gestures and commits on pointer-up, 140 ms after the last wheel event, or when the gesture leaves the drawn area; the hover readout writes to the DOM directly; signal pulses have their own SVG layer; no `backdrop-filter`, blur filters or masks on large areas. `vite.config.ts` disables React's dev-only `console.createTask` (re-enable with localStorage `halow.devStacks = '1'`).

### Globe rendering

Earth: streamed Sentinel-2 imagery draped on Terrarium relief via `3d-tiles-renderer` plugins. Moon and Mars: streamed NASA Trek imagery (LRO WAC; Viking MDIM 2.1, zoom 0–7) on a *smooth* sphere of the body radius (global relief is too coarse to displace), plus a `PlanetRelief` patch that shades the actual planning grid over the area, coloured from the same Trek tiles at `GLOBE_SOURCES[body].albedoZoom`. Relief exaggeration, mast size and satellite positions are display-only.

### Native Relay Engine and extensions

`native/relay-engine.c` is a single-file localhost HTTP server (`GET /health`, `POST /terrain`) that only accelerates terrain download + resampling and returns an `HRG1` binary grid (parsed by `parseGridResponse`). It contains **no** planning or propagation logic. Things that must stay in sync by hand:

- Its geodesy/tile/TIFF maths mirror `engine/terrain/geo.ts` and `real.ts`; a change to resampling in one must be made in the other or grids will differ by loader.
- Its accepted size/grid bounds must match `NATIVE_AREA_LIMITS` (`native/test-engine.c` asserts 300 km Earth / 120 km Moon and Mars).
- Its mosaic ids/URLs (`MOON_MOSAICS`, `MARS_MOSAICS`) must match `MOSAIC_TERRAIN`; it reports the one it used in `X-Engine-Source`, and `/health` lists supported `bodies`.
- Unlike the browser reader (which maps nodata to 0), it fails a load on any nodata sample, then tries the next mosaic.
- Its CORS allowlist defaults to `localhost`/`127.0.0.1` on ports 5173 and 4173; a hosted planner needs `--origin`.
- The client rejects a grid whose size differs from what it asked for.

`native/test-engine.c` `#include`s the engine source with `send`, `pthread_create` and `curl_easy_perform` macro-replaced by fakes. `extensions/{chromium,firefox}/` are an optional status badge for the helper; the app never depends on them.

### Export / import

`engine/serialize.ts` defines schema `halow-relay-planner/deployment` version 2. `importDeployment` validates untrusted JSON field by field and rebuilds state from whitelisted keys (`RADIO_FIELDS`, `COST_FIELDS`). Adding a field to `DeploymentState`, `RadioProfile` or `CostModel` means updating the field spec tables, the importer, and the round-trip test in `tests/system.test.ts`; a breaking change needs a version bump.

## Constraints baked into the current design

Worth knowing before extending, since several are load-bearing assumptions rather than bugs:

- **Latitude is clamped to ±84°** everywhere (store, importer, Terrarium loader), and the equirectangular mosaic reader rejects areas near a pole or straddling ±180°. The lunar and Martian poles are therefore out of reach without a polar-projected terrain source.
- **A plan can break when auto-fit grows the area.** If the planner puts a relay within the auto-fit inset (≤ 1 km) of the area edge, `applyPlan` → `syncArea` refits to the next size step and reloads elevation at a different grid spacing; a marginal link can then flip to `fail` and the result shows "Disconnected" right after "1 new relay suggested". This applies to every body. The Moon and Mars demo sites were chosen (by simulating plan → refit → reload on the real mosaics) so their plans don't trigger it; re-check that way if a demo site changes.
- Exactly one A and one B; the whole analysis is framed as "connect A to B", with base stations and coverage attached to A's component.
- One radio profile and one antenna height for all endpoints/relays (`Heights = { nodeM, baseM, clientM }`); links are symmetric.
- Planner and network evaluation are O(N²) in nodes/candidates, and `bestPath` is an O(N²) array Dijkstra; fine at ≤32×32 candidates.
- Satellites are static; nothing is time-dependent (no orbits, no lighting/power, no traffic or throughput).
- The curvature model is the flat-frame bulge approximation on a sphere, and area sizes are capped (Moon 60 km in-browser, 120 km native) partly to keep that and the local projection valid.

## Tests

`tests/helpers.ts` provides flat and ridge grids built with `gridFromFunction`, so engine behaviour is tested on analytic terrain with no network. `system.test.ts` also drives the Zustand store directly in node, with `src/terrain/areaTerrain` replaced by a `vi.mock` returning a tiny deterministic grid (so a new store code path that fetches terrain some other way will hit the network in tests); `native.test.ts` covers the `HRG1` parser. `mars.test.ts` covers Mars end to end (physics, limits, defaults, import/export, store body switch and demo, native `bodies` support) and carries its own copy of the `areaTerrain` mock. No test touches the network; to check a real mosaic, call `openRangeTiff` + `loadEquirectRegion` from a throwaway vitest file, which works in Node because both only use `fetch`.
