/**
 * Presentation engine core: pure navigation maths, no DOM and no React, so it is unit-tested in Node
 * (tests/present.test.ts) and shared by the presenter, the overview and the cross-window sync.
 *
 * A deck is a list of slides; a slide has `steps` build steps (fragments revealed one by one,
 * default 0). A position is `{ slide, step }` with `0 <= step <= steps`. "Next" reveals the next
 * fragment, then moves to the next slide at step 0; "previous" hides the last fragment, then moves
 * to the previous slide fully built (the convention of reveal.js and Keynote).
 */

export interface Position {
  slide: number;
  step: number;
}

/** The part of a slide the engine needs: how many build steps it has. */
export interface StepCount {
  steps?: number;
}

export const START: Position = { slide: 0, step: 0 };

const stepsOf = (s: StepCount | undefined) => Math.max(0, Math.floor(s?.steps ?? 0));

/** Clamp any position (for example one parsed from a URL) into the deck. */
export function clampPosition(slides: readonly StepCount[], p: Position): Position {
  if (!slides.length) return START;
  const slide = Math.min(slides.length - 1, Math.max(0, Math.floor(Number.isFinite(p.slide) ? p.slide : 0)));
  const step = Math.min(stepsOf(slides[slide]), Math.max(0, Math.floor(Number.isFinite(p.step) ? p.step : 0)));
  return { slide, step };
}

export function next(slides: readonly StepCount[], p: Position): Position {
  const c = clampPosition(slides, p);
  if (c.step < stepsOf(slides[c.slide])) return { slide: c.slide, step: c.step + 1 };
  if (c.slide < slides.length - 1) return { slide: c.slide + 1, step: 0 };
  return c;
}

export function prev(slides: readonly StepCount[], p: Position): Position {
  const c = clampPosition(slides, p);
  if (c.step > 0) return { slide: c.slide, step: c.step - 1 };
  if (c.slide > 0) return { slide: c.slide - 1, step: stepsOf(slides[c.slide - 1]) };
  return c;
}

/** Jump straight to a slide, skipping its builds (step 0) or showing it fully built. */
export function goto(slides: readonly StepCount[], slide: number, built = false): Position {
  const c = clampPosition(slides, { slide, step: 0 });
  return built ? { slide: c.slide, step: stepsOf(slides[c.slide]) } : c;
}

export const first = (): Position => START;
export const last = (slides: readonly StepCount[]): Position => goto(slides, slides.length - 1, true);

export const samePosition = (a: Position, b: Position) => a.slide === b.slide && a.step === b.step;
export const isFirst = (p: Position) => p.slide === 0 && p.step === 0;
export function isLast(slides: readonly StepCount[], p: Position): boolean {
  return !slides.length || (p.slide === slides.length - 1 && p.step >= stepsOf(slides[p.slide]));
}

/** Total number of "next" presses from the first position to the last; used for the progress bar. */
export function totalBeats(slides: readonly StepCount[]): number {
  return slides.reduce((a, s) => a + 1 + stepsOf(s), 0) - 1;
}

/** How many "next" presses `p` is from the start. */
export function beatOf(slides: readonly StepCount[], p: Position): number {
  const c = clampPosition(slides, p);
  let n = 0;
  for (let i = 0; i < c.slide; i++) n += 1 + stepsOf(slides[i]);
  return n + c.step;
}

/** Progress from 0 (first position) to 1 (last position). */
export function progress(slides: readonly StepCount[], p: Position): number {
  const t = totalBeats(slides);
  return t <= 0 ? 1 : beatOf(slides, p) / t;
}

/** Direction of travel between two positions: +1 forward, -1 back, 0 same. Drives the transition direction. */
export function direction(a: Position, b: Position): -1 | 0 | 1 {
  if (a.slide !== b.slide) return b.slide > a.slide ? 1 : -1;
  return a.step === b.step ? 0 : b.step > a.step ? 1 : -1;
}

/**
 * Slides to keep mounted around the current one. Only these exist in the DOM: the current slide,
 * plus its neighbours so that the next transition never waits on a first render.
 */
export function mountWindow(count: number, current: number, radius = 1): number[] {
  const out: number[] = [];
  for (let i = Math.max(0, current - radius); i <= Math.min(count - 1, current + radius); i++) out.push(i);
  return out;
}

// ---------- URL hash: #/present[/<deck>]/<slide>[.<step>] (slide 1-based, as people say it) ----------

export interface HashState {
  deck: string | null;
  position: Position;
}

const HASH_RE = /^#\/present(?:\/([a-z0-9][a-z0-9-]*))?(?:\/(\d+)(?:\.(\d+))?)?\/?$/i;

/** Parse a location hash. Returns null when the hash is not a presentation link. */
export function parseHash(hash: string): HashState | null {
  const m = HASH_RE.exec(hash.trim());
  if (!m) return null;
  // "#/present/3" means slide 3, not a deck named "3".
  const deck = m[1] && !/^\d+$/.test(m[1]) ? m[1].toLowerCase() : null;
  const slideText = m[1] && /^\d+$/.test(m[1]) ? m[1] : m[2];
  const stepText = m[1] && /^\d+$/.test(m[1]) ? m[2] : m[3];
  const slide = slideText ? Math.max(0, Number(slideText) - 1) : 0;
  const step = stepText ? Number(stepText) : 0;
  return { deck, position: { slide, step } };
}

export function formatHash(deck: string | null, p: Position): string {
  return `#/present${deck ? `/${deck}` : ''}/${p.slide + 1}${p.step ? `.${p.step}` : ''}`;
}

// ---------- Input mapping ----------

export type Command = 'next' | 'prev' | 'first' | 'last' | 'overview' | 'fullscreen' | 'notes' | 'blank' | 'help' | 'exit' | 'live';

/**
 * Keyboard map, following PowerPoint, Keynote and reveal.js so presenters' habits (and handheld
 * clickers, which send PageDown/PageUp or arrow keys) work unchanged.
 */
export function commandForKey(key: string, shift = false): Command | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
    case 'PageDown':
    case ' ':
    case 'Enter':
    case 'n':
    case 'N':
      return shift && key === ' ' ? 'prev' : 'next';
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'PageUp':
    case 'Backspace':
    case 'p':
    case 'P':
      return 'prev';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    case 'o':
    case 'O':
    case 'g':
    case 'G':
      return 'overview';
    case 'f':
    case 'F':
      return 'fullscreen';
    case 's':
    case 'S':
      return 'notes';
    case 'b':
    case 'B':
    case '.':
      return 'blank';
    case 'l':
    case 'L':
      return 'live';
    case '?':
      return 'help';
    case 'Escape':
      return 'exit';
    default:
      return null;
  }
}

/** Horizontal swipe → command. Needs enough distance and a mostly horizontal gesture. */
export function commandForSwipe(dx: number, dy: number, minPx = 50): 'next' | 'prev' | null {
  if (Math.abs(dx) < minPx || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx < 0 ? 'next' : 'prev';
}

/**
 * Fit a fixed logical stage (for example 1920×1080) into a viewport, letterboxed. Slides are laid
 * out once at the logical size and scaled with a single compositor transform, so text never
 * re-wraps between screens and resizing costs no layout.
 */
export function fitStage(viewW: number, viewH: number, stageW: number, stageH: number) {
  const scale = Math.max(0.01, Math.min(viewW / stageW, viewH / stageH));
  return { scale, x: (viewW - stageW * scale) / 2, y: (viewH - stageH * scale) / 2 };
}
