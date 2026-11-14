import { describe, expect, it } from 'vitest';
import { CONSERVATIVE_SAFETY, HAZARD, coverageField, distanceTransform, explainTraverse, gridFromFunction, hazardBase, hazardClasses, safeTraverse } from '../src/engine';
import { MOON, heights, node, radio } from './helpers';

const flat = () => gridFromFunction(101, 101, 10_000, 10_000, () => 0);
/** A 120 m-deep, ~1.6 km-wide bowl in the middle of a flat 10 km square. */
const crater = () => gridFromFunction(101, 101, 10_000, 10_000, (x, y) => -120 * Math.exp(-((x - 5000) ** 2 + (y - 5000) ** 2) / 800 ** 2));
const allCovered = (n: number) => new Uint8Array(n).fill(1);
const lowestY = (pts: { y: number }[]) => Math.min(...pts.map((p) => p.y));
const highestY = (pts: { y: number }[]) => Math.max(...pts.map((p) => p.y));

describe('hazard map', () => {
  it('measures distance to the nearest source cell', () => {
    const g = flat();
    const src = new Uint8Array(101 * 101);
    for (let r = 0; r < 101; r++) src[r * 101 + 50] = 1; // a north-south line at x = 5 km
    const d = distanceTransform(g, src);
    expect(d[50 * 101 + 50]).toBe(0);
    expect(d[50 * 101 + 60]).toBeCloseTo(1000, 0);
  });

  it('marks a crater and a buffer around its rim, and a drawn no-go zone', () => {
    const g = crater();
    const base = hazardBase(g);
    const zone = [
      { x: 500, y: 500 },
      { x: 1500, y: 500 },
      { x: 1500, y: 1500 },
      { x: 500, y: 1500 },
    ];
    const cls = hazardClasses(g, base, CONSERVATIVE_SAFETY, [zone]);
    expect(cls[50 * 101 + 50]).toBe(HAZARD.crater); // centre
    expect(cls[10 * 101 + 10]).toBe(HAZARD.zone);
    expect(cls[90 * 101 + 90]).toBe(HAZARD.safe);
    const noBuffer = hazardClasses(g, base, { ...CONSERVATIVE_SAFETY, craterBufferM: 0 }, []);
    const count = (a: Uint8Array) => a.reduce((n, v) => n + (v === HAZARD.crater ? 1 : 0), 0);
    expect(count(cls)).toBeGreaterThan(count(noBuffer));
  });
});

describe('coverage field', () => {
  it('covers open ground near a node and nothing behind a high ridge', () => {
    // 300 m wall across x = 5 km; node at x = 3 km.
    const g = gridFromFunction(101, 101, 10_000, 10_000, (x) => (Math.abs(x - 5000) < 150 ? 300 : 0));
    const cov = coverageField(g, MOON, radio, heights, [node('A', 'A', 3000, 5000)], 1.5);
    expect(cov[50 * 101 + 40]).toBe(1); // 1 km east of the node, before the wall
    expect(cov[50 * 101 + 70]).toBe(0); // 2 km behind the wall
  });

  it('counts each covering node once', () => {
    const g = flat();
    const cov = coverageField(g, MOON, radio, heights, [node('A', 'A', 4000, 5000), node('B', 'B', 6000, 5000)], 1.5);
    expect(cov[50 * 101 + 50]).toBe(2);
    const off = coverageField(g, MOON, radio, heights, [node('A', 'A', 4000, 5000, false)], 1.5);
    expect(off[50 * 101 + 40]).toBe(0);
  });
});

describe('safe traverse', () => {
  it('walks around a crater instead of through it', () => {
    const g = crater();
    const base = hazardBase(g);
    const cls = hazardClasses(g, base, CONSERVATIVE_SAFETY, []);
    const t = safeTraverse(g, base, cls, allCovered(g.data.length), [{ x: 1000, y: 5000 }, { x: 9000, y: 5000 }], CONSERVATIVE_SAFETY)!;
    expect(t.hazardM).toBe(0);
    expect(t.exceedsLimit).toBe(false);
    expect(lowestY(t.points) < 3500 || highestY(t.points) > 6500).toBe(true);
    expect(t.lengthM).toBeGreaterThan(8000);
  });

  it('goes around a drawn no-go zone', () => {
    const g = flat();
    const base = hazardBase(g);
    const zone = [
      { x: 4000, y: 2000 },
      { x: 6000, y: 2000 },
      { x: 6000, y: 8000 },
      { x: 4000, y: 8000 },
    ];
    const cls = hazardClasses(g, base, CONSERVATIVE_SAFETY, [zone]);
    const t = safeTraverse(g, base, cls, allCovered(g.data.length), [{ x: 1000, y: 5000 }, { x: 9000, y: 5000 }], CONSERVATIVE_SAFETY)!;
    expect(t.hazardM).toBe(0);
    expect(lowestY(t.points) < 2100 || highestY(t.points) > 7900).toBe(true);
  });

  it('prefers a covered detour over a shorter uncovered line', () => {
    const g = flat();
    const base = hazardBase(g);
    const cls = hazardClasses(g, base, CONSERVATIVE_SAFETY, []);
    // Covered everywhere except a band across the middle, with a covered gap in the band at y > 8 km.
    const cov = new Uint8Array(g.data.length).fill(1);
    for (let r = 0; r < 80; r++) for (let c = 45; c <= 55; c++) cov[r * 101 + c] = 0;
    const t = safeTraverse(g, base, cls, cov, [{ x: 1000, y: 5000 }, { x: 9000, y: 5000 }], CONSERVATIVE_SAFETY)!;
    expect(t.uncoveredM).toBe(0);
    expect(highestY(t.points)).toBeGreaterThan(7900);
  });

  it('still returns a route, with the gap flagged, when full coverage is impossible', () => {
    const g = flat();
    const base = hazardBase(g);
    const cls = hazardClasses(g, base, CONSERVATIVE_SAFETY, []);
    const cov = new Uint8Array(g.data.length).fill(1);
    for (let r = 0; r < 101; r++) for (let c = 45; c <= 55; c++) cov[r * 101 + c] = 0;
    const t = safeTraverse(g, base, cls, cov, [{ x: 1000, y: 5000 }, { x: 9000, y: 5000 }], CONSERVATIVE_SAFETY)!;
    expect(t.uncoveredM).toBeGreaterThan(900);
    expect(t.uncoveredM).toBeLessThan(1500); // crosses the band straight, not along it
    expect(t.gaps.length).toBe(1);
  });

  it('visits waypoints in order', () => {
    const g = flat();
    const base = hazardBase(g);
    const cls = hazardClasses(g, base, CONSERVATIVE_SAFETY, []);
    const t = safeTraverse(g, base, cls, null, [{ x: 1000, y: 1000 }, { x: 5000, y: 9000 }, { x: 9000, y: 1000 }], CONSERVATIVE_SAFETY)!;
    expect(highestY(t.points)).toBeCloseTo(9000, -2);
  });
});

describe('why-this-path facts', () => {
  it('shows the straight line crossing the crater the chosen path avoided', () => {
    const g = crater();
    const base = hazardBase(g);
    const cls = hazardClasses(g, base, CONSERVATIVE_SAFETY, []);
    const stops = [{ x: 1000, y: 5000 }, { x: 9000, y: 5000 }];
    const t = safeTraverse(g, base, cls, allCovered(g.data.length), stops, CONSERVATIVE_SAFETY)!;
    const e = explainTraverse(g, cls, allCovered(g.data.length), stops, t, CONSERVATIVE_SAFETY);
    expect(e.path.hazardM).toBe(0);
    expect(e.straight.hazards.crater).toBeGreaterThan(1000);
    expect(e.straight.lengthM).toBeCloseTo(8000, 0);
    expect(e.path.lengthM).toBeGreaterThan(e.straight.lengthM);
    expect(e.waypoints).toBe(0);
    expect(e.hazardTradeM).toBeGreaterThan(e.gapTradeM);
  });

  it('shows the straight line losing signal where the chosen path keeps it', () => {
    const g = flat();
    const base = hazardBase(g);
    const cls = hazardClasses(g, base, CONSERVATIVE_SAFETY, []);
    const cov = new Uint8Array(g.data.length).fill(1);
    for (let r = 0; r < 80; r++) for (let c = 45; c <= 55; c++) cov[r * 101 + c] = 0;
    const stops = [{ x: 1000, y: 5000 }, { x: 9000, y: 5000 }];
    const t = safeTraverse(g, base, cls, cov, stops, CONSERVATIVE_SAFETY)!;
    const e = explainTraverse(g, cls, cov, stops, t, CONSERVATIVE_SAFETY);
    expect(e.path.gapM).toBe(0);
    expect(e.path.gapStretches).toBe(0);
    expect(e.straight.gapM).toBeGreaterThan(900);
  });
});
