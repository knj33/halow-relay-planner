# Performance

The planner has to stay smooth on machines where the CPU is the bottleneck: laptops without GPU
rasterisation, projectors driven by weak PCs, remote desktops. This file records what made it slow,
what fixed it, how to measure it, and the rules that keep it fast.

## Measurements

Chrome with DevTools CPU throttling at **6×**, demo scenario (200 km, 68 nodes, 116 links, ~560 SVG
elements on the survey map), survey view:

| | Before | After (dev server) | After (production build) |
|---|---|---|---|
| Idle, survey view | 0.7 fps | 128 fps, no DOM work | 128 fps |
| Dragging the map | 0.7 fps | 128 fps | 124 fps |
| Wheel zoom (includes redraws as it settles) | 0.5 fps | 92 fps | 118 fps |
| One map redraw after a gesture | ~2 s | ~230 ms | 8 ms |
| Slide transition / build step | n/a | ~124 fps | not measured |

(The 120–128 fps ceiling is the test display's refresh rate.)

The dev server stays slower to redraw than production because React's development build checks
and instruments every element. Judge final smoothness on `npm run build && npm run preview`.

## What was slow, and the fix

1. **The hidden globe kept rendering.** The WebGL globe stays mounted (so it keeps its streamed
   tiles) and ran its render loop at full rate behind the survey map. Now
   `GlobeView`/`Survey3D` take `active` and use `frameloop={active ? 'demand' : 'never'}`: no
   frames at all while hidden, and when visible a frame only when the camera, tiles or props change
   (the 3d-tiles controls and tile loader call `invalidate()`; the fly-to animation calls it per frame).
2. **The whole app re-rendered twice a second.** The globe reported its camera centre to the store
   every 600 ms, and `App` subscribed to the entire store, so every report re-rendered every panel.
   `setViewCentre` now ignores sub-1e-4° changes, `App` subscribes with a `useShallow` selector
   that leaves `viewCentre` out, the big children (`SurveyMap`, `GlobeView`, `Survey3D`, the setup
   panels) are `memo`, and their callbacks are stable (`useStableCallback` in `App.tsx`).
3. **Every pointer move re-rendered the map.** Panning set React state per event, so 560 SVG
   elements were reconciled and the canvas redrawn on every mouse move. Now a gesture only moves
   the already-drawn layer with a CSS transform (see [Survey map gestures](#survey-map-gestures));
   React and the canvas redraw once when the gesture settles. The hover elevation readout writes
   straight to its DOM node once per frame instead of going through state.
4. **Blur on large areas.** The SVG walking-route and corridor halos used `feGaussianBlur`, the
   raster had a CSS `mask-image` vignette, and five overlay panels used `backdrop-filter: blur()`.
   Each re-blurred the map underneath on every repaint. Replaced by stacked low-opacity strokes,
   a static gradient overlay (`.survey::after`) and denser solid backgrounds.
5. **The signal pulse animation repainted everything.** The SMIL pulses lived inside the main
   overlay SVG, so each animation frame repainted every route, mask and label in it. They now have
   their own SVG layer (`.survey-pulses`).
6. **Path strings rebuilt per render.** The walking route has thousands of points and its `d`
   string was built nine times per render. The strings are in map metres (zoom-independent) and are
   now memoised per data change.
7. **Tile-cache progress re-rendered the map per tile.** While the detail cache fills, hundreds of
   tiles finish; the redraw is now throttled to four per second.
8. **React dev instrumentation.** In the dev server, React 19 calls `console.createTask` for every
   element so DevTools can show async stacks; with DevTools open that was about 75% of a map redraw.
   A dev-only Vite plugin (`fastDevReact` in `vite.config.ts`) disables it. To get those stacks
   back: `localStorage.setItem('halow.devStacks', '1')` and reload. Production builds never use it.

## Survey map gestures

`SurveyMap` keeps two views:

- the **committed** view (React state): what the canvas and the SVG were drawn for;
- the **live** view (`liveRef`): where the user's gesture has got to.

Canvas, overlay SVG and pulse SVG sit in one `.survey-stage` element with `will-change: transform`
and `contain: strict`. They are drawn with **20% overscan** on every side (`OVERSCAN`), so a pan
shows already-drawn map rather than blank ground. During a drag, wheel or pinch, `preview()`
stores the live view and, once per animation frame, sets the stage's transform to map the committed
view onto the live one (`translate(tx, ty) scale(r)`, `transform-origin` at the visible window's
corner). This is compositor-only work: no React render, no layout, no paint.

The live view is **committed** (one React render + one canvas redraw):

- on pointer-up after a drag or pinch;
- 140 ms after the last wheel event (`SETTLE_MS`);
- immediately when the live window leaves the drawn (overscanned) window, or a zoom-in has stretched
  the raster by more than 2.5× (so it would look blurry);
- at once for buttons and keys (`setView`).

After a commit, a layout effect recomputes the transform (normally back to identity) in the same
frame the new drawing appears, so nothing jumps.

## How to measure

1. `npm run build && npm run preview`, open `http://localhost:4173`, click **Demo**.
2. DevTools → Performance → CPU: 6× slowdown. Record while panning, zooming, or presenting.
3. Keep the tab in the **foreground**: Chrome throttles background tabs to about one frame per
   2 s, which looks exactly like a performance bug.
4. A quick in-page check, pasted into the console:

```js
let n = 0, t0 = performance.now();
(function f() { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else console.log((n / 3).toFixed(0), 'fps'); })();
```

## Rules for new code

- Animate only `opacity` and `transform`. No animated `filter`, `box-shadow`, sizes or positions.
- No `backdrop-filter`, `filter: blur()` or `mask-image` on large or frequently repainted areas.
- Anything continuously animated (SMIL, CSS loops) gets its own layer and stops when hidden or when
  Motion is Off.
- A WebGL canvas renders on demand (`frameloop="demand"`) and stops when hidden (`'never'`). Call
  `invalidate()` from any animation you add.
- Don't put high-frequency values (camera position, pointer position, progress ticks) in the
  Zustand store or in React state of a large component. Use refs and write to the DOM, or throttle.
- Subscribe to the store with selectors; `memo` large components and pass them stable callbacks.
- Build expensive derived data (paths, rasters, `Map`s) in `useMemo` keyed on the data, never on
  the view.
