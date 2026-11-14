import { describe, expect, it } from 'vitest';
import { gridFromFunction, hillshade, sampleBicubic, sampleElevation, slopeGrid, surveyLayers, terrainProfile, walkingRoute } from '../src/engine';
import { flatGrid, ridgeGrid } from './helpers';

/** A 10 km square tilted towards the south, cut by north-south valleys, with a 400 m-wide bowl (crater) in the middle. */
const craterGrid = () =>
  gridFromFunction(101, 101, 10_000, 10_000, (x, y) => 0.02 * y + 15 * Math.cos((2 * Math.PI * x) / 2000) - 60 * Math.exp(-((x - 5000) ** 2 + (y - 5000) ** 2) / 400 ** 2));
/** The same tilt with no valleys at all. */
const planeGrid = () => gridFromFunction(101, 101, 10_000, 10_000, (x, y) => 0.02 * y + 0.005 * x);

describe('survey layers', () => {
  it('reports zero slope and no features on flat ground', () => {
    const grid = flatGrid(10_000, 100);
    const s = surveyLayers(grid);
    expect(Math.max(...slopeGrid(grid))).toBe(0);
    expect(s.depressions).toHaveLength(0);
    expect(s.contours).toHaveLength(0);
  });

  it('measures slope in degrees', () => {
    const grid = gridFromFunction(51, 51, 1000, 1000, (x) => x); // 45° ramp to the east
    const slope = slopeGrid(grid);
    expect(slope[25 * 51 + 25]).toBeCloseTo(45, 3);
  });

  it('lights slopes facing the sun more than slopes facing away', () => {
    const grid = ridgeGrid();
    const shade = hillshade(grid, 270, 35); // sun in the west
    const row = 100 * 201;
    const westFace = shade[row + 95]; // x ≈ 4750 m, rising to the east, faces west
    const eastFace = shade[row + 105];
    expect(westFace).toBeGreaterThan(eastFace);
  });

  it('finds the bowl as a depression at the right place and depth', () => {
    const s = surveyLayers(craterGrid());
    expect(s.depressions.length).toBeGreaterThan(0);
    const d = s.depressions[0];
    expect(Math.abs(d.x - 5000)).toBeLessThan(200);
    expect(Math.abs(d.y - 5000)).toBeLessThan(200);
    expect(d.depthM).toBeGreaterThan(30);
    expect(d.radiusM).toBeGreaterThan(150);
    expect(d.radiusM).toBeLessThan(800);
  });

  it('draws drainage channels flowing downhill', () => {
    const s = surveyLayers(craterGrid());
    expect(s.channels.length).toBeGreaterThan(0);
    // The surface falls to the south, so channels must run north to south overall.
    const southward = s.channels.filter((c) => c.y2 < c.y1).length;
    expect(southward / s.channels.length).toBeGreaterThan(0.6);
  });

  it('draws no channels on a plane, where flow routing would only produce straight artefacts', () => {
    expect(surveyLayers(planeGrid()).channels).toHaveLength(0);
  });

  it('runs channels along valley floors', () => {
    const s = surveyLayers(craterGrid());
    // Valley floors are where cos(2πx/2000) = -1, i.e. x ≈ 1000, 3000, ... m.
    const offFloor = s.channels.map((c) => Math.abs(((c.x1 % 2000) + 2000) % 2000 - 1000));
    expect(offFloor.filter((d) => d < 300).length / offFloor.length).toBeGreaterThan(0.9);
  });

  it('chains every channel segment into polylines', () => {
    const s = surveyLayers(craterGrid());
    const lineSegments = s.channelLines.reduce((n, l) => n + l.points.length - 1, 0);
    expect(lineSegments).toBe(s.channels.length);
    for (const l of s.channelLines) expect(l.orders).toHaveLength(l.points.length);
  });

  it('places contours at a round interval inside the elevation range', () => {
    const grid = craterGrid();
    const s = surveyLayers(grid);
    expect(s.contours.length).toBeGreaterThan(5);
    for (const c of s.contours) {
      expect(c.levelM).toBeGreaterThanOrEqual(grid.minElevM);
      expect(c.levelM).toBeLessThanOrEqual(grid.maxElevM);
      expect(c.segments.length % 4).toBe(0);
    }
  });
});

describe('walking route', () => {
  it('walks straight across flat ground', () => {
    const route = walkingRoute(flatGrid(), [
      { x: 1000, y: 5000 },
      { x: 9000, y: 5000 },
    ])!;
    expect(route.lengthM).toBeCloseTo(8000, -1);
    expect(route.exceedsLimit).toBe(false);
  });

  it('detours around a cliff that exceeds the slope limit', () => {
    // A 300 m-high wall across x = 5 km, except for a gap in the south.
    const grid = gridFromFunction(101, 101, 10_000, 10_000, (x, y) => (Math.abs(x - 5000) < 150 && y > 2500 ? 300 : 0));
    const route = walkingRoute(grid, [
      { x: 2000, y: 8000 },
      { x: 8000, y: 8000 },
    ])!;
    expect(route.exceedsLimit).toBe(false);
    expect(Math.min(...route.points.map((p) => p.y))).toBeLessThan(2600);
    expect(route.maxGradeDeg).toBeLessThanOrEqual(25);
  });

  it('flags a route that must cross terrain steeper than the limit', () => {
    const grid = gridFromFunction(101, 101, 10_000, 10_000, (x) => (Math.abs(x - 5000) < 150 ? 300 : 0));
    const route = walkingRoute(grid, [
      { x: 2000, y: 5000 },
      { x: 8000, y: 5000 },
    ])!;
    expect(route.exceedsLimit).toBe(true);
  });

  it('samples a terrain profile between two points', () => {
    const p = terrainProfile(ridgeGrid(200), { x: 0, y: 5000 }, { x: 10_000, y: 5000 }, 100);
    expect(p).toHaveLength(101);
    expect(p[50].z).toBeCloseTo(200, 0);
    expect(p[100].d).toBeCloseTo(10_000, 3);
  });
});

describe('coarse sources', () => {
  it('does not turn bilinear creases of a coarse source into channels', () => {
    // A 2 km-pixel source (random heights on a 6 x 6 lattice) resampled bilinearly onto a 100 m grid.
    const lattice = [3, 9, 1, 7, 4, 8, 6, 2, 8, 3, 9, 1, 5, 7, 2, 6, 1, 9, 8, 1, 9, 4, 7, 3, 2, 6, 3, 8, 5, 7, 9, 4, 7, 1, 6, 2].map((v) => v * 20);
    const at = (i: number, j: number) => lattice[Math.min(5, j) * 6 + Math.min(5, i)];
    const grid = gridFromFunction(101, 101, 10_000, 10_000, (x, y) => {
      const fx = x / 2000;
      const fy = y / 2000;
      const i = Math.floor(fx);
      const j = Math.floor(fy);
      const tx = fx - i;
      const ty = fy - j;
      return (at(i, j) * (1 - tx) + at(i + 1, j) * tx) * (1 - ty) + (at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx) * ty;
    });
    const fine = surveyLayers(grid).channels.length;
    const aware = surveyLayers(grid, { sourceResolutionM: 2000 }).channels.length;
    expect(aware).toBeLessThan(fine);
  });
});

describe('bicubic sampling', () => {
  it('passes through grid samples and gives the slope of a plane exactly', () => {
    const grid = gridFromFunction(21, 21, 2000, 2000, (x, y) => 0.3 * x - 0.1 * y + 50);
    const [z, gx, gy] = sampleBicubic(grid, 700, 1300);
    expect(z).toBeCloseTo(0.3 * 700 - 0.1 * 1300 + 50, 6);
    expect(gx).toBeCloseTo(0.3, 6);
    expect(gy).toBeCloseTo(-0.1, 6);
    expect(sampleBicubic(grid, 400, 600)[0]).toBeCloseTo(sampleElevation(grid, 400, 600), 6);
  });
});
