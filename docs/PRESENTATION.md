# Presentation engine

The planner can play slide decks, like PowerPoint or Keynote, inside the website. A slide can
be an ordinary slide (text, figures, images) or a **live slide**, where the real planner is the
slide and the deck drives it: load the 200 km demo, switch to 3D, fail a relay.

There is no real talk yet. `src/present/decks/sample.tsx` is a sample deck that exercises every
feature. Copy it to start the real one.

- Open: the **Present** link in the masthead, the `P` key, or a link such as `/#/present`.
- Code: `src/present/`. Tests: `tests/present.test.ts`.
- No dependency: the engine is about 600 lines of our own code (see [Why not reveal.js](#why-not-revealjs-or-another-library)).

## Contents

- [Using it](#using-it)
- [Writing a deck](#writing-a-deck)
- [Live slides and the bridge](#live-slides-and-the-bridge)
- [Architecture](#architecture)
- [Performance rules](#performance-rules)
- [Testing](#testing)
- [Why not reveal.js or another library](#why-not-revealjs-or-another-library)
- [Extending](#extending)

## Using it

| Key | Action |
|---|---|
| → ↓ Space PageDown Enter N | Next build step, or next slide |
| ← ↑ Shift+Space PageUp Backspace P | Previous |
| Home / End | First / last slide |
| Type a number, then Enter | Go to that slide |
| O or G | Overview of all slides (arrow keys move, Enter opens) |
| S | Speaker notes panel with a clock and the next slide's title |
| F | Full screen (the whole page, so live slides still show the planner) |
| B or . | Blank the screen; any navigation key brings it back |
| L | On a live slide: give the keyboard to the planner, or take it back |
| ? | Shortcut help |
| Esc | Close the open panel; then leave the presentation |

Handheld clickers send PageUp/PageDown or arrow keys, so they work as is.

**Pointer:** click anywhere on a stage slide to advance, or on its left quarter to go back. On
touch screens, swipe left or right. The control bar (bottom right) fades out after 2.6 s without
pointer movement and returns when the pointer moves or a control has keyboard focus.

**Links:** the URL follows the deck, so you can bookmark or share a position:

| Link | Opens |
|---|---|
| `/#/present` | default deck, slide 1 |
| `/#/present/4` | slide 4 |
| `/#/present/4.2` | slide 4 with two build steps shown |
| `/#/present/<deck-id>/4` | a specific deck |

The engine uses `history.replaceState`, so stepping through slides does not fill the Back
button. Esc removes the hash.

**Two screens:** open the deck in two windows (for example the projector window and your
laptop). They follow each other through a `BroadcastChannel`: press Next in either one. Keep the
notes panel (`S`) open on yours. A window that opens later jumps to wherever the others are.

## Writing a deck

A deck is a TypeScript object. Each slide is a `render` function returning JSX, laid out on a
fixed **1920 × 1080** stage that is scaled to the screen, so sizes are in "projector pixels" and
text wraps the same everywhere.

```tsx
// src/present/decks/launch.tsx
import { Caption, Columns, Cover, Figure, Frame, Points, Step } from '../kit';
import type { Deck } from '../types';

export const launchDeck: Deck = {
  id: 'launch',                         // URL-safe; never all digits
  title: 'Relays for Arcadia Planitia',
  slides: [
    {
      id: 'cover',
      title: 'Cover',                    // used by the overview, the notes and the tab title
      transition: 'fade',
      render: () => <Cover title="HALOW" subtitle="Relays for a Mars landing site" />,
    },
    {
      id: 'problem',
      title: 'The problem',
      steps: 3,                          // three presses reveal three points
      notes: 'Pause after the second point.',
      render: () => (
        <Frame kicker="Problem" title="Radio does not bend over crater rims">
          <Points items={['First point', 'Second point', 'Third point']} />
        </Frame>
      ),
    },
  ],
};
```

Then register it in `src/present/decks/index.ts`. The first deck in `DECKS` is the default:

```ts
export const DECKS: Deck[] = [launchDeck, sampleDeck];
```

### Slide fields (`src/present/types.ts`)

| Field | Meaning |
|---|---|
| `id` | Unique in the deck. React key and how code refers to the slide. |
| `title` | Short name for the overview, the notes panel and the browser tab. |
| `kind` | `'stage'` (default) or `'live'` ([below](#live-slides-and-the-bridge)). |
| `steps` | Number of build steps after the slide appears. Default 0. |
| `transition` | `'slide'` (default), `'fade'`, `'rise'` or `'none'`. |
| `notes` | Speaker notes. Never shown on the stage. |
| `background` | CSS background for this slide. The deck default is `deck.background`. |
| `render(ctx)` | The content. `ctx` has `step`, `index`, `count`, `active` and `thumbnail`. |
| `onEnter(app, ctx)` | Runs when the slide becomes current. Can be async; navigation never waits for it. |
| `onStep(app, step, ctx)` | Runs when the build step changes on the current slide. |
| `onLeave(app)` | Runs when another slide becomes current, or the deck closes. |

A thrown error or rejected promise in a hook is logged with the slide id and never stops the deck.

### Builds (fragments)

Wrap anything in `<Step at={n}>` to reveal it at build step `n` (1-based). Hidden steps keep their
space, so revealing one never moves anything else. `until={m}` hides it again from step `m`, which
lets one item replace another. `<Points items={[...]} />` reveals one bullet per step; pass
`from={0}` to show them all at once. You can also read the step directly: `render: ({ step }) => ...`.

Going back onto a slide shows it fully built, as Keynote and PowerPoint do.

### Authoring kit (`src/present/kit.tsx`)

| Component | Use |
|---|---|
| `Cover` | Title slide: very large wordmark-style title, a rule, subtitle, meta line. |
| `Frame` | Standard slide: optional kicker line, title, body. `align="center"` centres it vertically. |
| `Points` | Bullet list with one build step per item. |
| `Step` | A fragment (see above). |
| `Columns` | Two or more columns, `ratio` is a CSS grid template (`'1.2fr 1fr'`). |
| `Figure` | One big number with a unit and a label. |
| `Compare` | Side-by-side table: a label column, a neutral left column and a highlighted right column (green tint), each cell a big figure plus a sentence. Row i builds in at step i + 1; `sources` renders a numbered source list under it (cite with `<sup>n</sup>`). Used by the "Relay satellite or surface mesh?" slide in `sample.tsx`. |
| `Caption` | The caption card for live slides. |

**Decks.** `decks/smms.tsx` is the default (the SMMS talk: title, problem, mesh example,
satellite vs mesh, hardware, SSA Mesh Oriented OS, live demo, thanks); `decks/sample.tsx` is the
engine sample, at `#/present/sample`. The hardware slide lives in `decks/hardware.tsx` and both
decks use it. The OS slide shows `public/present/ssa-os.png`, a crop of the team's QEMU/KVM
screenshot of SSA Space 0.1. The demo slide has three builds: the network, a relay failure, then
the 3D relief via `bridge.showRelief(10)`, which sets the vertical exaggeration and flies the
camera once around the area (`showcase` prop on `Survey3D`, `SHOWCASE_ORBIT_S`). Network drawings on slides use `decks/MapArt.tsx`, the survey
map's drawing language at stage scale (relay and endpoint glyphs, link styles, route corridor,
glowing signal packets, dashed area frame): `MeshArtHealthy` (green, slide 1), `MeshArtCut`
(red, "DISCONNECTED", slide 2) and `MeshHeal` all build on it, so keep it in step with
`components/SurveyMap.tsx` if the map's look changes. `Compare dense` tightens the table for
Georgian, which runs longer than English. The thank-you mascot is `public/present/kerbal.png`
(background cut out of the supplied clipart, watermark corner cleared). `Points numbered` shows 1. 2. 3. instead of dashes; `Cover phrase`
sets a few words (not a wordmark) on one line with normal letter spacing.

**Languages.** A deck's `langs` lists the languages it is written in (first = default); with two
or more, a faint toggle at the top of the screen switches between them, and the choice is kept in
`localStorage` (`halow.present.lang`). Slides read the language from their context (`render({ lang })`
or `useSlide().lang`); a slide's own `langs` limits it to some languages, and the slide list (and
numbering) is filtered per language. A deck's `notice` puts a faint note in the bottom-right
corner per language. SMMS: Georgian (default) and English; English shows slides 1–7 without the
thank-you and carries "Includes AI-generated content". The position is clamped during render, so
switching language on a slide that does not exist in the other language lands on the last one.

**Preloading and autoplay.** A deck's `onOpen(app)` runs once when the deck opens, whatever slide
it opens at. The SMMS deck calls `app.ensureDemo()` there (after 1.2 s, so the opening transition
stays smooth): the bundled demo loads and the survey map mounts under the title slide, which also
builds its detail cache, so the live demo slide opens with no loading screen. `ensureDemo` is a
no-op while the grid it loaded is still in the store, and shares one in-flight load. A slide's
`autoAdvanceMs` steps it on by itself after that long without navigation (any navigation restarts
the wait; it never leaves the slide; paused in the overview and while blanked): the SMMS demo
fails a relay after 20 s if nobody presses Next.

`decks/HardwareShowcase.tsx` shows the two PCBs as real 3D models, each turning on its own
turntable (one r3f canvas per board, `frameloop` `'always'` only on the current slide, a still
placeholder in thumbnails, `resize={{ offsetSize: true }}` because the stage is CSS-scaled). The
models in `public/hw/` are generated, not hand-made. To regenerate after a board changes:

1. The boards reference part models through `${KICAD6..10_3DMODEL_DIR}`, which kicad-cli does not
   resolve and the KiCad 10 library ships as STEP only. Copy each `.kicad_pcb` to a scratch folder
   with those paths rewritten to `C:/Program Files/KiCad/10.0/share/kicad/3dmodels/...` and
   `.wrl` → `.step` where the STEP exists.
2. Export: `kicad-cli pcb export glb --force --include-silkscreen --include-soldermask [--include-tracks --include-pads] -o out.glb board.kicad_pcb`.
   The relay node keeps tracks and pads (its traces show). The base station is exported without
   them: with them the raw file is 166 MB, and its outer traces barely show under the mask.
3. Base station only: colour the parts by type on a dark board, so its 818 parts read at slide
   scale: `node scripts/recolor-pcb-glb.mjs out.glb out-color.glb` (needs `@gltf-transform/core`
   and `@gltf-transform/extensions` 4.1.1 installed where you run it; they are not project
   dependencies). This has to happen before step 4, which merges every part into a few meshes
   with a palette texture, so nothing per-part is left to recolour at runtime.
4. Compress: `npx @gltf-transform/cli@4.1.1 optimize out.glb public/hw/<name>.glb --compress meshopt --texture-compress false --simplify-error 0.0005`
   (relay node 12.7 MB → 0.53 MB, base station 18.8 MB → 0.53 MB). `useGLTF(url, false, true)`
   decodes meshopt locally; Draco stays off because drei would fetch its decoder from a CDN.

The enclosures, solar panels and antennas are drawn by the slide (`BoardDressing`), not exported.
`shell: true` puts the board in a simple box (see-through walls and floor with light edges, 7 %
clearance) whose lid is a solar panel. A loop in `Board` (`CYCLE`: 3 s closed, 1.6 s opening,
3.6 s open, 1.6 s closing) shows both: open, the lid rises and fades to a ghost, the walls clear
and the view tilts down onto the PCB. The clock only advances on rendered frames, so every visit
to the slide starts closed. Antennas sit at the antenna connectors' exported positions
and leave the box: base station J32 `HALOW_A` and J33 `HALOW_B` (edge-mount SMA) through the nearest
side wall as hinged rubber ducks; relay node J7 (u.FL) as an 86 mm whip (a quarter wave at
868 MHz) standing on the lid above it. If a connector moves on the board, update its position in
`sample.tsx` (read it from the un-optimised GLB, where nodes are still named by reference designator).

Sources: relay node `nodepcb/LunarLink-Relay-Node.kicad_pcb`; base station
`Documents/NASA/packet/Lunar_Base_Station/kicad/lunar_base.kicad_pcb` (outside this repo).

`decks/MeshHeal.tsx` is an example of an animated stage slide driven by build steps: step 0 signal
pulses flow A→B, step 1 a relay goes dark (route past it red, B loses signal), step 2 a standby relay
wakes and the new route draws in green. Pulses are SMIL `animateMotion` and run only on the current
slide (`useSlide().active`, never in thumbnails); everything else animates opacity, transform or
`stroke-dashoffset` on a few small shapes, and stops with the planner's Motion setting off.

Styles are the `.pz-*` rules in `src/present/present.css`, built on the planner's design tokens
(`--salmon`, `--traverse`, `--display`, `--mono`, ...), so slides match the app. Plain JSX
and your own classes work too.

Images: put files in `public/slides/` and reference them as `/slides/name.webp`. Give `<img>`
explicit `width` and `height` so nothing shifts while it decodes. The neighbouring slides are
mounted ahead of time, so an image on the next slide has already started loading when you get there.

## Live slides and the bridge

A slide with `kind: 'live'` hands the screen to the planner. The deck backdrop fades away, the
planner underneath becomes visible and interactive, and the slide's `render` output is
drawn as a caption card at the bottom right (use `<Caption>`). The presenter can pan and zoom the
map while talking.

While a live slide is up, the deck keeps only PageUp/PageDown, Esc and L, so arrow keys pan the
map and letters stay tool shortcuts. Press **Esc** once (or **L**) to take the keyboard back for
the deck; arrows then move slides again. Esc a second time leaves the presentation.

Slides drive the planner only through the **bridge** (`src/present/bridge.ts`):

```ts
interface PresentationBridge {
  loadPremadeDemo(): Promise<void>; // the bundled 200 km Arcadia Planitia scenario, no network
  setView(view: 'survey' | '3d' | 'globe'): void;
  planRelays(): Promise<void>;      // same as the Plan relays button
  randomFailure(): void;            // fail a random relay/base on the route, with the animation
  restoreAll(): void;               // bring failed nodes back, end the failure simulation
}
```

Example: a live slide that loads the demo, and fails a relay on its first build step:

```tsx
{
  id: 'failure',
  title: 'A relay fails',
  kind: 'live',
  steps: 1,
  onEnter: async (app) => {
    await app.loadPremadeDemo();
    app.setView('survey');
    app.restoreAll();
  },
  onStep: (app, step) => (step >= 1 ? app.randomFailure() : app.restoreAll()),
  render: ({ step }) => <Caption title={step ? 'A relay went dark' : 'Watch this relay'} />,
}
```

Make hooks idempotent and reversible: someone can arrive on a slide from either side, jump to it
from the overview, or step back. Restore what a step changed when stepping back (as above).

To give slides a new power, add a method to `PresentationBridge`, to the `noop` and `bridge`
objects in `bridge.ts`, and to the implementation `App` registers (`bridgeImpl` in `App.tsx`).
The bridge is deliberately small, so decks never import the store or components directly and
don't break when those change.

## Architecture

```
src/present/
  engine.ts        pure navigation core: next/prev/goto, builds, progress, URL hash,
                   key and swipe mapping, stage fit. No DOM, no React; unit-tested.
  types.ts         Deck, SlideDef, SlideContext, Transition.
  state.ts         tiny Zustand store the rest of the app reads: open, live, deck, start.
  bridge.ts        the planner API slides may call; App registers the implementation.
  kit.tsx          authoring components and the slide context (step) provider.
  Presenter.tsx    the player: stage, transitions, input, sync, URL, overview, notes, help.
  present.css      all presentation styles (loaded with the presenter chunk only).
  decks/index.ts   deck registry (first = default).
  decks/sample.tsx sample deck.
```

**Loading.** `App.tsx` imports the presenter with `React.lazy`, so the planner downloads none of
it (about 18 kB JS + 7 kB CSS) until a deck opens. `App` opens it from the Present link, the `P`
key, or a `#/present...` hash on load or on `hashchange`.

**Navigation.** Position is `{ slide, step }`. `engine.ts` owns every rule (clamping bad deep
links, builds, ends of the deck, progress), and `Presenter` only stores the position and maps
input to commands. Keys are handled in the capture phase on `window` and stopped there, so the
planner's own shortcuts never see a key the deck used. While a stage slide covers the planner,
`App` also ignores its tool shortcuts.

**Rendering.** Only the current slide and its two neighbours are mounted (`mountWindow`). Each
mounted slide is `is-before`, `is-current` or `is-after`, and the CSS transition between those
classes is the slide transition, so going forward and back animates in the right direction with no
JavaScript animation code. `SlideView` is memoised on (slide, step, state), so the clock, the
control bar or the notes panel never re-render slide content.

**Covering the planner.** While a stage slide is up, `App` adds `is-covered` to `.app`, which
sets `visibility: hidden; content-visibility: hidden` on everything except the deck, and stops the
globe and 3D WebGL render loops (`frameloop="never"`) and the map's signal-pulse animation. The
planner keeps its state and comes back instantly on a live slide or on exit.

**Sync.** Every local position change is posted on `BroadcastChannel('halow-present')` with the
deck id; positions received are applied without re-posting, so windows cannot loop.

## Performance rules

The engine is built to stay smooth when the CPU is the bottleneck: it was measured at about 124 fps
through transitions and builds with Chrome's CPU throttled 6×. Keep it that way:

1. **Animate only `opacity` and `transform`.** These run on the compositor thread and keep going
   when the main thread is busy. Animating `width`, `top`, `filter`, `box-shadow` or a blur
   repaints every frame.
2. **No `backdrop-filter` or CSS `filter: blur()` on anything large.** On machines without GPU
   rasterisation these are the most expensive thing on screen. Use a solid or semi-opaque background.
3. **Lay out once.** The stage has a fixed logical size and is scaled with one transform
   (`fitStage`). Never size slide content with `vw`/`vh` or media queries; resizing then costs no
   layout and text never re-wraps.
4. **Keep heavy work out of `render`.** Render runs again when the step changes. Precompute data at
   module level or in `useMemo`. Canvas/WebGL inside a slide should only run while `ctx.active`, and
   never when `ctx.thumbnail` is true (the overview renders every slide as a thumbnail).
5. **Hooks must not block.** `onEnter` can be async; the transition never waits for it.
6. **Large images:** use WebP/AVIF at no more than 1920 px wide, with explicit `width`/`height`.

See [PERFORMANCE.md](PERFORMANCE.md) for how the planner itself stays smooth.

## Testing

`tests/present.test.ts` covers navigation (forward/back symmetry through builds, ends, clamping),
progress, the mount window, hash parsing and formatting, key and swipe mapping, stage fit, and
validates every registered deck (unique URL-safe ids, unique slide ids, valid step counts). Adding
a deck to `DECKS` puts it under that check automatically.

In the browser: `npm run dev`, open `http://localhost:5173/#/present`, and step through with the
keyboard. To judge smoothness, use Chrome DevTools Performance with CPU throttling, or the
production build (`npm run build && npm run preview`, port 4173).

## Why not reveal.js or another library

The usual web options are reveal.js, Spectacle (React), MDX Deck and Slidev (Vue). We built our own because:

- **Live slides** are the point here. The deck has to sit over the running planner, hand it the
  pointer and keyboard, and drive it through a typed API. Libraries assume they own the page.
- **Performance control.** The planner already runs WebGL, workers and a 340 MB tile cache. The
  engine has to pause all that under stage slides and add nothing heavy. A small engine whose
  every animation is opacity/transform is easier to guarantee than a themed framework.
- **Design.** Slides share the planner's tokens and fonts with no theme to override.
- **Size.** About 25 kB loaded on demand, with no new dependency to keep updated.

What we borrowed from reveal.js and Keynote: fixed logical stage scaled to fit, fragments,
"back lands fully built", the overview grid, blank screen on B, speaker notes, number+Enter jumps
and clicker-compatible keys.

## Extending

- **New transition:** add the name to `Transition` in `types.ts` and an `is-before`/`is-after`
  pair of transforms in `present.css` (`.pz-slide.tr-<name>.is-before { transform: ... }`). Keep it
  opacity/transform only.
- **New kit component:** add it to `kit.tsx` with `.pz-*` styles in `present.css`; size it in
  stage pixels.
- **Different aspect ratio:** set `width`/`height` on the deck (for example 1440 × 1080 for 4:3).
- **Presenter-only window** (notes, next slide preview, timer) would subscribe to the same
  `BroadcastChannel`; the message format is `{ type: 'pos', deck, slide, step }` plus
  `{ type: 'hello', deck }` to ask for the current position.
- **Export to PDF:** not built. The simplest route is a print stylesheet that lays every slide out
  fully built at 1920 × 1080 per page.
