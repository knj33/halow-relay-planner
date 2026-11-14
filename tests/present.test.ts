import { describe, expect, it } from 'vitest';
import {
  beatOf,
  clampPosition,
  commandForKey,
  commandForSwipe,
  direction,
  fitStage,
  formatHash,
  goto,
  isFirst,
  isLast,
  last,
  mountWindow,
  next,
  parseHash,
  prev,
  progress,
  totalBeats,
} from '../src/present/engine';
import { DECKS } from '../src/present/decks';

// Three slides: no builds, two builds, one build.
const deck = [{}, { steps: 2 }, { steps: 1 }];

describe('presentation navigation', () => {
  it('walks every build forward, then back, symmetrically', () => {
    const seen = [{ slide: 0, step: 0 }];
    let p = seen[0];
    while (!isLast(deck, p)) seen.push((p = next(deck, p)));
    expect(seen).toEqual([
      { slide: 0, step: 0 },
      { slide: 1, step: 0 },
      { slide: 1, step: 1 },
      { slide: 1, step: 2 },
      { slide: 2, step: 0 },
      { slide: 2, step: 1 },
    ]);
    const back = [p];
    while (!isFirst(p)) back.push((p = prev(deck, p)));
    expect(back.reverse()).toEqual(seen);
  });

  it('stops at both ends', () => {
    expect(prev(deck, { slide: 0, step: 0 })).toEqual({ slide: 0, step: 0 });
    expect(next(deck, last(deck))).toEqual(last(deck));
  });

  it('going back onto a slide shows it fully built', () => {
    expect(prev(deck, { slide: 2, step: 0 })).toEqual({ slide: 1, step: 2 });
  });

  it('clamps nonsense positions (bad deep links) into the deck', () => {
    expect(clampPosition(deck, { slide: 99, step: 99 })).toEqual({ slide: 2, step: 1 });
    expect(clampPosition(deck, { slide: -4, step: -1 })).toEqual({ slide: 0, step: 0 });
    expect(clampPosition(deck, { slide: NaN, step: 3 })).toEqual({ slide: 0, step: 0 });
    expect(clampPosition([], { slide: 3, step: 1 })).toEqual({ slide: 0, step: 0 });
    expect(goto(deck, 1, true)).toEqual({ slide: 1, step: 2 });
  });

  it('measures progress in presses', () => {
    expect(totalBeats(deck)).toBe(5);
    expect(beatOf(deck, { slide: 1, step: 2 })).toBe(3);
    expect(progress(deck, { slide: 0, step: 0 })).toBe(0);
    expect(progress(deck, last(deck))).toBe(1);
    expect(progress([{}], { slide: 0, step: 0 })).toBe(1);
  });

  it('reports direction of travel', () => {
    expect(direction({ slide: 0, step: 0 }, { slide: 2, step: 0 })).toBe(1);
    expect(direction({ slide: 1, step: 2 }, { slide: 1, step: 1 })).toBe(-1);
    expect(direction({ slide: 1, step: 1 }, { slide: 1, step: 1 })).toBe(0);
  });

  it('mounts only the current slide and its neighbours', () => {
    expect(mountWindow(10, 0)).toEqual([0, 1]);
    expect(mountWindow(10, 5)).toEqual([4, 5, 6]);
    expect(mountWindow(10, 9)).toEqual([8, 9]);
    expect(mountWindow(1, 0)).toEqual([0]);
  });
});

describe('presentation links', () => {
  it('round-trips positions through the hash', () => {
    for (const [d, p] of [
      [null, { slide: 0, step: 0 }],
      [null, { slide: 4, step: 2 }],
      ['launch-talk', { slide: 11, step: 0 }],
    ] as const) {
      expect(parseHash(formatHash(d, p))).toEqual({ deck: d, position: p });
    }
  });

  it('reads the short forms people type', () => {
    expect(parseHash('#/present')).toEqual({ deck: null, position: { slide: 0, step: 0 } });
    expect(parseHash('#/present/3')).toEqual({ deck: null, position: { slide: 2, step: 0 } });
    expect(parseHash('#/present/3.1')).toEqual({ deck: null, position: { slide: 2, step: 1 } });
    expect(parseHash('#/present/sample')).toEqual({ deck: 'sample', position: { slide: 0, step: 0 } });
    expect(parseHash('#/Present/Sample/2/')).toEqual({ deck: 'sample', position: { slide: 1, step: 0 } });
  });

  it('ignores hashes that are not presentation links', () => {
    for (const h of ['', '#', '#/plan', '#/presenter', '#/present/a b', '#present/2']) expect(parseHash(h)).toBeNull();
  });
});

describe('presentation input', () => {
  it('maps presenter keys and clicker keys', () => {
    expect(commandForKey('ArrowRight')).toBe('next');
    expect(commandForKey('PageDown')).toBe('next');
    expect(commandForKey(' ')).toBe('next');
    expect(commandForKey(' ', true)).toBe('prev');
    expect(commandForKey('PageUp')).toBe('prev');
    expect(commandForKey('Home')).toBe('first');
    expect(commandForKey('End')).toBe('last');
    expect(commandForKey('Escape')).toBe('exit');
    expect(commandForKey('x')).toBeNull();
  });

  it('accepts only deliberate horizontal swipes', () => {
    expect(commandForSwipe(-120, 10)).toBe('next');
    expect(commandForSwipe(120, -10)).toBe('prev');
    expect(commandForSwipe(30, 0)).toBeNull();
    expect(commandForSwipe(80, 90)).toBeNull();
  });

  it('letterboxes the stage into any viewport', () => {
    expect(fitStage(1920, 1080, 1920, 1080)).toEqual({ scale: 1, x: 0, y: 0 });
    const wide = fitStage(2560, 1080, 1920, 1080);
    expect(wide.scale).toBe(1);
    expect(wide.x).toBe(320);
    const tall = fitStage(960, 1080, 1920, 1080);
    expect(tall.scale).toBe(0.5);
    expect(tall.y).toBeCloseTo(270);
  });
});

describe('bundled decks', () => {
  it('have unique, URL-safe ids and valid slides', () => {
    const ids = new Set<string>();
    for (const d of DECKS) {
      expect(d.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(/^\d+$/.test(d.id)).toBe(false); // would read as a slide number in the URL
      expect(ids.has(d.id)).toBe(false);
      ids.add(d.id);
      expect(d.slides.length).toBeGreaterThan(0);
      const slideIds = new Set(d.slides.map((s) => s.id));
      expect(slideIds.size).toBe(d.slides.length);
      for (const s of d.slides) {
        expect(s.title.length).toBeGreaterThan(0);
        expect(Number.isInteger(s.steps ?? 0) && (s.steps ?? 0) >= 0).toBe(true);
      }
    }
  });
});
