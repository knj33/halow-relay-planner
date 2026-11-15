import type { ReactNode } from 'react';
import type { PresentationBridge } from './bridge';

/**
 * How a slide uses the screen.
 *
 * - `stage`: a normal slide, drawn on the fixed 1920×1080 stage over an opaque backdrop. The
 *   planner underneath is hidden and stops rendering entirely.
 * - `live`: the planner itself is the slide. The stage shrinks to a caption card, the app stays
 *   interactive underneath, and `onEnter` usually drives it (loads the demo, fails a node...).
 */
export type SlideKind = 'stage' | 'live';

/** Transition into this slide. Only opacity and transform animate, so every transition runs on the compositor. */
export type Transition = 'fade' | 'slide' | 'rise' | 'none';

/** Presentation language. A deck that lists more than one in `langs` gets a language toggle. */
export type Lang = 'ka' | 'en';

export interface SlideContext {
  /** Language the deck is being shown in. */
  lang: Lang;
  /** Build step currently shown, 0..steps. */
  step: number;
  /** Zero-based slide index. */
  index: number;
  /** Total slides in the deck. */
  count: number;
  /** True only for the slide on screen; neighbours are mounted ahead of time but not active. */
  active: boolean;
  /** True when rendered as an overview thumbnail. Skip anything costly (video, canvas loops). */
  thumbnail: boolean;
}

export interface SlideDef {
  /** Stable id, unique in the deck. Used for React keys and to find a slide from code. */
  id: string;
  /** Show this slide only in these languages (default: all). */
  langs?: Lang[];
  /** Short title for the overview, the speaker view and the document title. */
  title: string;
  kind?: SlideKind;
  /** Number of build steps (fragments) after the slide first appears. Default 0. */
  steps?: number;
  transition?: Transition;
  /** Speaker notes, shown in the notes panel and the speaker window, never on the stage. */
  notes?: string;
  /** Optional per-slide backdrop colour (CSS). Defaults to the deck's. */
  background?: string;
  /** Slide content, laid out on the 1920×1080 stage (or inside the caption card for `live`). */
  render: (ctx: SlideContext) => ReactNode;
  /**
   * Called when the slide becomes current (not when it is pre-mounted or shown as a thumbnail).
   * Use it to drive the planner through the bridge. May be async; navigation never waits for it.
   */
  onEnter?: (app: PresentationBridge, ctx: SlideContext) => void | Promise<void>;
  /**
   * Called when the build step changes on the current slide (not on entry: `onEnter` covers that).
   * `step` is the new step. Lets a build drive the planner, for example step 1 fails a relay.
   */
  onStep?: (app: PresentationBridge, step: number, ctx: SlideContext) => void;
  /** Called when another slide becomes current. */
  onLeave?: (app: PresentationBridge) => void;
  /**
   * Autoplay: while this slide is current and has build steps left, advance one step after this
   * many milliseconds without navigation. Any navigation restarts the wait; it never leaves the slide.
   */
  autoAdvanceMs?: number;
}

export interface Deck {
  /** URL-safe id (`#/present/<id>/3`). */
  id: string;
  title: string;
  /** Logical stage size in CSS px. Default 1920×1080 (16:9). */
  width?: number;
  height?: number;
  /** Backdrop colour behind stage slides. */
  background?: string;
  slides: SlideDef[];
  /** Languages the deck is written in, first = default. Two or more show a language toggle. */
  langs?: Lang[];
  /** A faint note in the bottom-right corner, per language (none where absent). */
  notice?: Partial<Record<Lang, string>>;
  /** Called once when the deck opens, whatever slide it opens at. Use it to preload live slides. */
  onOpen?: (app: PresentationBridge) => void | Promise<void>;
}
