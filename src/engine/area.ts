import { BODIES } from './bodies';
import { geoToLocal, localToGeo } from './terrain/geo';
import type { GeoPoint } from './terrain/geo';
import type { BodyId, GeoNode, SiteNode } from './types';

/**
 * A square planning area on the body surface. All link calculations run on an elevation grid
 * covering this square in a local east/north metre frame; grid x = east + sizeM/2, y = north + sizeM/2.
 */
export interface PlanningArea {
  centre: GeoPoint;
  sizeM: number;
}

export interface AreaLimits {
  /** Allowed side lengths, metres, smallest first. */
  steps: number[];
  /** Target elevation grid spacing, metres (matched to the source data resolution). */
  targetSpacingM: number;
  /** Most grid points per side. Bounds memory and, on the Moon and Mars, the number of range requests. */
  maxGridPoints: number;
}

const km = (v: number) => v * 1000;

export const AREA_LIMITS: Record<BodyId, AreaLimits> = {
  earth: { steps: [5, 10, 15, 20, 30, 40, 60, 80, 100, 120, 150].map(km), targetSpacingM: 75, maxGridPoints: 769 },
  moon: { steps: [4, 6, 8, 10, 12, 15, 20, 30, 40, 50, 60].map(km), targetSpacingM: 118, maxGridPoints: 257 },
  // Same area ladder as the Moon; the HRSC+MOLA blend is 200 m per pixel.
  mars: { steps: [4, 6, 8, 10, 12, 15, 20, 30, 40, 50, 60].map(km), targetSpacingM: 200, maxGridPoints: 257 },
};

export const NATIVE_AREA_LIMITS: Record<BodyId, AreaLimits> = {
  earth: { ...AREA_LIMITS.earth, steps: [...AREA_LIMITS.earth.steps, 200_000, 250_000, 300_000], maxGridPoints: 1537 },
  moon: { ...AREA_LIMITS.moon, steps: [...AREA_LIMITS.moon.steps, 80_000, 100_000, 120_000], maxGridPoints: 769 },
  mars: { ...AREA_LIMITS.mars, steps: [...AREA_LIMITS.mars.steps, 80_000, 100_000, 120_000], maxGridPoints: 769 },
};

export function areaLimitsFor(body: BodyId, native = false): AreaLimits {
  return (native ? NATIVE_AREA_LIMITS : AREA_LIMITS)[body];
}

export function maxAreaM(body: BodyId, native = false): number {
  const s = areaLimitsFor(body, native).steps;
  return s[s.length - 1];
}

/** Grid points per side for an area: as fine as the source allows, capped per body. */
export function gridPointsFor(body: BodyId, sizeM: number, native = false): number {
  const L = areaLimitsFor(body, native);
  return Math.max(65, Math.min(L.maxGridPoints, Math.round(sizeM / L.targetSpacingM) + 1));
}

/** Planner candidate divisions per side: roughly one candidate site per 1.2 km, 6 to 32 per side. */
export function autoCandidateDivisions(sizeM: number): number {
  return Math.max(6, Math.min(32, Math.round(sizeM / 1200)));
}

/** Coverage map cells per side: roughly 300 m cells, 24 to 64 per side. */
export function coverageResFor(sizeM: number): number {
  return Math.max(24, Math.min(64, Math.round(sizeM / 300)));
}

export function geoToGrid(area: PlanningArea, p: GeoPoint, radiusM: number): { x: number; y: number } {
  const { east, north } = geoToLocal(area.centre, p, radiusM);
  return { x: east + area.sizeM / 2, y: north + area.sizeM / 2 };
}

export function gridToGeo(area: PlanningArea, x: number, y: number, radiusM: number): GeoPoint {
  return localToGeo(area.centre, x - area.sizeM / 2, y - area.sizeM / 2, radiusM);
}

export function inArea(area: PlanningArea, p: GeoPoint, radiusM: number, insetM = 0): boolean {
  const { x, y } = geoToGrid(area, p, radiusM);
  return x >= insetM && y >= insetM && x <= area.sizeM - insetM && y <= area.sizeM - insetM;
}

export type FitResult = { ok: true; area: PlanningArea; changed: boolean } | { ok: false; spanM: number; maxM: number };

/**
 * Smallest allowed square that holds every point with a working margin. Keeps the current area
 * when it still fits, so placing nodes inside an area never triggers a new terrain download.
 */
export function fitArea(body: BodyId, points: GeoPoint[], current: PlanningArea | null, native = false): FitResult | null {
  if (points.length === 0) return null;
  const R = BODIES[body].radiusM;
  const L = areaLimitsFor(body, native);
  if (current) {
    const inset = Math.min(1000, current.sizeM * 0.05);
    if (points.every((p) => inArea(current, p, R, inset))) return { ok: true, area: current, changed: false };
  }
  const ref = current?.centre ?? points[0];
  const local = points.map((p) => geoToLocal(ref, p, R));
  const minE = Math.min(...local.map((l) => l.east));
  const maxE = Math.max(...local.map((l) => l.east));
  const minN = Math.min(...local.map((l) => l.north));
  const maxN = Math.max(...local.map((l) => l.north));
  const span = Math.max(maxE - minE, maxN - minN);
  const need = span + 2 * Math.max(1500, 0.15 * span);
  const size = L.steps.find((s) => s >= need);
  if (size === undefined) return { ok: false, spanM: span, maxM: maxAreaM(body, native) };
  const centre = localToGeo(ref, (minE + maxE) / 2, (minN + maxN) / 2, R);
  return { ok: true, area: { centre, sizeM: size }, changed: true };
}

/** Convert stored geographic nodes to the engine's grid frame. Nodes outside the area are left out. */
export function toEngineNodes(body: BodyId, area: PlanningArea, nodes: GeoNode[]): { inside: SiteNode[]; outside: string[] } {
  const R = BODIES[body].radiusM;
  const inside: SiteNode[] = [];
  const outside: string[] = [];
  for (const n of nodes) {
    const { x, y } = geoToGrid(area, n, R);
    if (x < 0 || y < 0 || x > area.sizeM || y > area.sizeM) outside.push(n.id);
    else inside.push({ id: n.id, kind: n.kind, x, y, enabled: n.enabled, origin: n.origin });
  }
  return { inside, outside };
}
