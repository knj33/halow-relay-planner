---
name: presentation-engine
description: Site has its own slide-deck engine (src/present) with live slides; the real deck is still unwritten; smoothness on CPU-bound machines is a hard requirement
metadata:
  node_type: memory
  type: project
  originSessionId: b1b6df02-ecac-436e-af83-19a461356840
  modified: 2026-11-14T22:25:21.470Z
---

On 2026-11-15 the user asked for a presentation engine inside the planner website (PowerPoint-like, slide to slide) — "not yet making a presentation, just the engine" — and for the site to be "very very smooth, even on a cpu bound thing". Built our own engine in `src/present/` (no reveal.js) with live slides that drive the planner via `bridge.ts`; only `decks/sample.tsx` exists. Docs: `docs/PRESENTATION.md`, `docs/PERFORMANCE.md`.

**Why:** the deck will presumably be the user's talk about the planner, shown on whatever machine is at hand; the user forbade questions for that request, so content was left as a sample.

**How to apply:** when asked to write the actual presentation, add a deck in `src/present/decks/`, put it first in `DECKS`, keep the Mars survey style ([[mars-survey-design]]). Any new UI must follow the rules in `docs/PERFORMANCE.md` (opacity/transform-only animation, no blur/backdrop-filter, on-demand WebGL) and be checked under 6× CPU throttle on the production build. Repo: [[public-repo]].
