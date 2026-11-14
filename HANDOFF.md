# Handoff

For the next agent (or person) picking up the HaLow Relay Planner. Last updated 2026-11-14.

**Read in this order:** this file, then `CLAUDE.md` (the authoritative architecture and conventions; long but worth it), then `PROJECT_OVERVIEW.md` if you want the product background. `.claude/memory/` holds the Claude memory from the sessions that built this; see *Claude memory* below.

## What this is

A browser-only planner (React 19, three.js, Zustand, Vite, TypeScript) for Wi-Fi HaLow relay networks between two surface endpoints A and B on Earth, the Moon or Mars. It streams real elevation, checks every link against terrain and a link budget, places relays, attaches base stations to satellites, plans a safe crew walking route that keeps radio coverage, and simulates node failures. There is no backend.

## Run it

Node 20 or newer (built with 24.18).

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest, 113 tests, no network
npm run typecheck
npm run build
```

Fastest way to see everything: open the app, click **Demo** (next to Globe in the map's top-left panel). It loads the bundled 200 km Mars scenario instantly, with no network: relays already planned, crew path drawn, and "Why this path" shown.

## What exists (built in the sessions so far)

All of this is in place, tested and documented in `CLAUDE.md`.

| Feature | Where |
|---|---|
| "Mars survey" visual design (dark frame, hairlines, Jost/IBM Plex Mono, salmon/ochre/ice palette); followed Apple HIG for sizes, contrast and keyboard access | `src/styles.css`, `src/theme.ts`, `src/App.tsx` |
| 2D survey map: hillshade, contours, drainage channels (old rivers), craters/depressions, steep-ground hatching, pan/zoom (wheel, pinch, drag, keys) | `src/components/SurveyMap.tsx`, `src/survey/draw.ts`, `src/engine/survey.ts` |
| Detail cache: whole area pre-rendered to 8192 px in workers (~341 MB RAM, ~2.5 s), so zoom never waits | `src/survey/tileCache.ts`, `src/worker/tiles.worker.ts` |
| 3D relief view (rotate, exaggeration slider, links between true antenna heights) | `src/components/Survey3D.tsx` |
| Survey layers draped on the 3D globe | `SurveyOverlay` in `src/scene/GlobeView.tsx` |
| Route card with expand chevron, hop strip, terrain profile per hop | `src/components/RouteDetail.tsx` |
| Premade 200 km demo at the SpaceX Starship candidate site in Arcadia Planitia (HiRISE ESP_060706_2195) | `public/demo/`, `scripts/demo/`, `loadPremadeDemo` in `src/state/store.ts` |
| Crew waypoints (W), no-go zones (Z), safety rules (conservative: 15°, 300 m from cliffs, 150 m outside crater rims) | `src/engine/traverse.ts`, `CrewPanel` in `src/components/Sidebar.tsx` |
| Safe and covered crew path: A* with cost tiers hazard ≫ no signal ≫ effort; gaps and hazards flagged | `safeTraverse`, `coverageField`, `hazardClasses` |
| "Why this path" text, built from measured facts so it is correct for any input | `explainTraverse` + `src/whyThisPath.ts` |
| Failure simulation: pick a node (F) or random failure; animated go-dark, reroute, signal flow; Motion On/Auto/Off | `Sim` in `src/App.tsx`, `SimView` in `SurveyMap.tsx` |

## How the work was verified

Every feature was checked in a real browser with the Chrome DevTools MCP tools (load Demo, plan, zoom, fail nodes, add waypoints and zones, screenshot), as well as by unit tests. Do the same after UI changes; tests alone do not catch layout or animation problems.

### Gotchas that cost time

- **Background tabs are throttled** to about one frame per 2 s. If frame-time measurements look terrible, bring the tab to the front (`select_page` with `bringToFront`) before measuring.
- **The test Chrome reports `prefers-reduced-motion: reduce`.** The failure-simulation animation is gated by its own Motion setting (default **On**, stored in localStorage `halow.sim.motion`), not by the system flag, because the user explicitly asked for the animation. Other decorative motion still respects the system setting.
- **USGS range reads fail intermittently in that browser** (`ERR_CACHE_OPERATION_NOT_SUPPORTED`). The loader then falls back to MOLA 463 m or the bundled ~4.9 km/px pyramid. On the coarse data, contours become evenly spaced parallel lines; that is expected, not a bug. The Demo needs no network.
- **`ERR_CONNECTION_REFUSED` in the console** is the optional native engine probe (localhost:8765) and is expected.
- **A dev server may already be running on 5173** from another session; check before starting a second one (`Get-NetTCPConnection -LocalPort 5173`).
- **HMR wipes store state:** after a hot reload, re-run your setup steps (Demo, plan) before checking anything.
- **`Math.max(...array)` overflows the stack** on million-cell grids; loop instead.
- **drei `<Html>` failed to mount its first portal under React 19**, so the 3D labels are canvas sprites.
- **Holding the whole tile pyramid as GPU `ImageBitmap`s starved the GPU.** Tiles are kept as plain pixel arrays, and only the visible ones are uploaded (LRU of 96).

## Regenerating the demo

```bash
npx vitest run --config scripts/demo/vitest.config.ts   # network, about 40 s
```

This fetches 200 km of HRSC + MOLA elevation, plans the network with the app's own planner, and rewrites `public/demo/arcadia-200km.{json,bin}`. `tests/demo.test.ts` checks the bundle afterwards. To move the site or change the layout, edit `SITE` and `LAYOUT` in `scripts/demo/build-demo-site.gen.ts`.

## Conventions that matter

- `src/engine/` is pure TypeScript (no DOM, no fetch). Put new physics or planning there and test it in `tests/`.
- When the model changes, update `src/engine/assumptions.ts`. It is shown in the UI **and written into every export**.
- Export format: `src/engine/serialize.ts`. A new state field needs the exporter, the importer (validate untrusted input field by field) and the round-trip test in `tests/system.test.ts`. Fields added later should be optional on import.
- New UI keeps the Mars survey design language: tokens on `:root` in `styles.css`. Approve visual changes with the user first; they liked seeing an artifact or mockup before implementation.
- The project's `CLAUDE.md` asks for `graphify update .` after code changes when `graphify-out/` exists. It does not exist in this repo yet.

## Known limits and open ideas

- **Crew coverage is optimistic.** It uses line of sight plus free-space range only; the link model adds Fresnel and diffraction.
- **Zone drafting is drawn only on the survey map.** Clicking on the globe with the zone tool adds corners, but the draft outline isn't shown there.
- **The 3D view is read-only** (it can select and fail nodes, but not place them).
- **Failure detection isn't modelled.** The failure simulation recomputes from the new state instantly; real detection and convergence delays are not modelled.
- **200 km is the stress case.** It is above the normal Mars limits (60 km in browser, 120 km with the native engine); the importer accepts exactly 200 km so Demo exports round-trip.
- **Possible next steps:** suggest relays automatically for "NO SIGNAL" stretches; time-based EVA limits (suit consumables versus path length); show the crew path in the 3D view with gaps highlighted; a polar terrain source.

## Claude memory

`.claude/memory/` is a copy of the Claude Code memory written while building this (`MEMORY.md` is the index). Claude Code reads memory from your user profile, not from the repo. To give a new machine the same context, copy these files into the memory folder for this project: `~/.claude/projects/<project-path-slug>/memory/`. On Windows the slug is the project path with `:` and `\` replaced by `-`. Keep `CLAUDE.md` and this file in the repo; they are the shared context.

## Not in the repo

- **`design idea/`** (the reference image the design was based on) is excluded because its copyright is unknown. The approved design canvas (private artifact) is linked in `.claude/memory/mars-survey-design.md`.
- **`node_modules/`, `dist/` and the `public/engine/` build copies** are generated: run `npm install` and `npm run dev`/`build`.
