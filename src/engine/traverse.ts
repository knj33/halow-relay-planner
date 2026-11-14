import { heightFor } from './network';
import { maxFreeSpaceRangeM } from './propagation';
import { IndexHeap, priorityFlood, slopeGrid } from './survey';
import { sampleElevation } from './terrain/grid';
import type { Env, Heights, HeightGrid, RadioProfile, SiteNode } from './types';

/**
 * Crew traverse planning: where a suited person may walk, where they keep radio contact, and the
 * safest covered route from A through the crew waypoints to B. Pure maths on the planning grid.
 */

export interface SafetySettings {
  /** Steeper ground is not walked. */
  maxSlopeDeg: number;
  /** Slope that counts as a cliff or scarp, the source of the cliff buffer. */
  cliffSlopeDeg: number;
  /** Keep this far from cliffs, metres. */
  cliffBufferM: number;
  /** Closed depressions deeper than this count as craters, metres. */
  craterMinDepthM: number;
  /** Keep this far outside crater and depression rims, metres. */
  craterBufferM: number;
  /** Extra effort for rough (locally steep) ground: 0 off, 1 default, up to 3. */
  roughnessWeight: number;
  /** Prefer ground inside radio coverage, and report stretches outside it. */
  requireCoverage: boolean;
}

export const CONSERVATIVE_SAFETY: SafetySettings = {
  maxSlopeDeg: 15,
  cliffSlopeDeg: 25,
  cliffBufferM: 300,
  craterMinDepthM: 3,
  craterBufferM: 150,
  roughnessWeight: 1,
  requireCoverage: true,
};
export const MODERATE_SAFETY: SafetySettings = { ...CONSERVATIVE_SAFETY, maxSlopeDeg: 20, cliffBufferM: 150, craterBufferM: 75 };

export interface SafetyFieldSpec {
  key: Exclude<keyof SafetySettings, 'requireCoverage'>;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
}
export const SAFETY_FIELDS: SafetyFieldSpec[] = [
  { key: 'maxSlopeDeg', label: 'Max walking slope', unit: '°', min: 3, max: 35, step: 1 },
  { key: 'cliffSlopeDeg', label: 'Cliff slope', unit: '°', min: 10, max: 60, step: 1 },
  { key: 'cliffBufferM', label: 'Distance from cliffs', unit: 'm', min: 0, max: 2000, step: 10 },
  { key: 'craterMinDepthM', label: 'Crater min depth', unit: 'm', min: 0.5, max: 200, step: 0.5 },
  { key: 'craterBufferM', label: 'Distance outside rims', unit: 'm', min: 0, max: 2000, step: 10 },
  { key: 'roughnessWeight', label: 'Rough ground penalty', unit: '×', min: 0, max: 3, step: 0.5 },
];

export function isSafetyValid(s: SafetySettings): boolean {
  return SAFETY_FIELDS.every((f) => Number.isFinite(s[f.key]) && s[f.key] >= f.min && s[f.key] <= f.max) && typeof s.requireCoverage === 'boolean';
}

/** Hazard class per grid node. */
export const HAZARD = { safe: 0, steep: 1, cliff: 2, crater: 3, zone: 4 } as const;

/** Settings-independent terrain facts, computed once per grid. */
export interface HazardBase {
  slopeDeg: Float32Array;
  /** Fill depth of closed depressions, metres (0 outside). */
  depthM: Float32Array;
}

export function hazardBase(grid: HeightGrid): HazardBase {
  const slopeDeg = slopeGrid(grid);
  const { filled } = priorityFlood(grid);
  const depthM = new Float32Array(grid.data.length);
  for (let i = 0; i < depthM.length; i++) depthM[i] = filled[i] - grid.data[i];
  return { slopeDeg, depthM };
}

/** Two-pass chamfer distance (metres) to the nearest source cell; 0 on sources. */
export function distanceTransform(grid: HeightGrid, source: Uint8Array): Float32Array {
  const { cols, rows } = grid;
  const dx = grid.widthM / (cols - 1);
  const dy = grid.heightM / (rows - 1);
  const dd = Math.hypot(dx, dy);
  const d = new Float32Array(cols * rows);
  for (let i = 0; i < d.length; i++) d[i] = source[i] ? 0 : Infinity;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      let v = d[i];
      if (c > 0) v = Math.min(v, d[i - 1] + dx);
      if (r > 0) {
        v = Math.min(v, d[i - cols] + dy);
        if (c > 0) v = Math.min(v, d[i - cols - 1] + dd);
        if (c < cols - 1) v = Math.min(v, d[i - cols + 1] + dd);
      }
      d[i] = v;
    }
  }
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = cols - 1; c >= 0; c--) {
      const i = r * cols + c;
      let v = d[i];
      if (c < cols - 1) v = Math.min(v, d[i + 1] + dx);
      if (r < rows - 1) {
        v = Math.min(v, d[i + cols] + dy);
        if (c < cols - 1) v = Math.min(v, d[i + cols + 1] + dd);
        if (c > 0) v = Math.min(v, d[i + cols - 1] + dd);
      }
      d[i] = v;
    }
  }
  return d;
}

/** Even-odd point-in-polygon. */
function inPolygon(x: number, y: number, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Hazard class per grid node for the given safety settings and no-go zones (grid metres). */
export function hazardClasses(grid: HeightGrid, base: HazardBase, s: SafetySettings, zones: { x: number; y: number }[][]): Uint8Array {
  const { cols, rows } = grid;
  const n = cols * rows;
  const dx = grid.widthM / (cols - 1);
  const dy = grid.heightM / (rows - 1);
  const cliff = new Uint8Array(n);
  const crater = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (base.slopeDeg[i] > s.cliffSlopeDeg) cliff[i] = 1;
    if (base.depthM[i] > s.craterMinDepthM) crater[i] = 1;
  }
  const cliffD = s.cliffBufferM > 0 ? distanceTransform(grid, cliff) : null;
  const craterD = s.craterBufferM > 0 ? distanceTransform(grid, crater) : null;
  const cls = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (base.slopeDeg[i] > s.maxSlopeDeg) cls[i] = HAZARD.steep;
    if (cliff[i] || (cliffD && cliffD[i] <= s.cliffBufferM)) cls[i] = HAZARD.cliff;
    if (crater[i] || (craterD && craterD[i] <= s.craterBufferM)) cls[i] = HAZARD.crater;
  }
  for (const z of zones) {
    if (z.length < 3) continue;
    const xs = z.map((p) => p.x);
    const ys = z.map((p) => p.y);
    const c0 = Math.max(0, Math.floor(Math.min(...xs) / dx));
    const c1 = Math.min(cols - 1, Math.ceil(Math.max(...xs) / dx));
    const r0 = Math.max(0, Math.floor(Math.min(...ys) / dy));
    const r1 = Math.min(rows - 1, Math.ceil(Math.max(...ys) / dy));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (inPolygon(c * dx, r * dy, z)) cls[r * cols + c] = HAZARD.zone;
  }
  return cls;
}

/**
 * How many working nodes can reach a crew radio at each grid node (capped at 255). A node covers a
 * point when the point is within the free-space range at the required margin and the straight line
 * from the node's antenna to a radio `clientHeightM` above the ground clears the terrain, with
 * curvature applied as in the link model. Radial line-of-sight sweep per node: fast, but geometric
 * only (no Fresnel or diffraction allowance), so it is slightly optimistic next to evaluateLink.
 */
export function coverageField(grid: HeightGrid, env: Env, radio: RadioProfile, heights: Heights, nodes: SiteNode[], clientHeightM: number): Uint8Array {
  const { cols, rows } = grid;
  const cx = grid.widthM / (cols - 1);
  const cy = grid.heightM / (rows - 1);
  const cov = new Uint8Array(cols * rows);
  const stamp = new Int32Array(cols * rows).fill(-1);
  const range = maxFreeSpaceRangeM(radio);
  if (!Number.isFinite(range) || range <= 0) return cov;
  const effR = env.radiusM * env.kFactor;
  nodes.forEach((node, k) => {
    if (!node.enabled) return;
    const z0 = sampleElevation(grid, node.x, node.y) + heightFor(node.kind, heights);
    const c0 = node.x / cx;
    const r0 = node.y / cy;
    const rc = Math.ceil(range / Math.min(cx, cy)) + 1;
    const mark = (fc: number, fr: number) => {
      const c = Math.round(fc);
      const r = Math.round(fr);
      if (c < 0 || r < 0 || c >= cols || r >= rows) return;
      const i = r * cols + c;
      if (stamp[i] === k) return;
      stamp[i] = k;
      if (cov[i] < 255) cov[i]++;
    };
    mark(c0, r0);
    const ray = (pc: number, pr: number) => {
      const dc = pc - c0;
      const dr = pr - r0;
      const steps = Math.ceil(Math.max(Math.abs(dc), Math.abs(dr)) * 2);
      let maxTan = -Infinity;
      for (let s = 1; s <= steps; s++) {
        const fc = c0 + (dc * s) / steps;
        const fr = r0 + (dr * s) / steps;
        if (fc < 0 || fr < 0 || fc > cols - 1 || fr > rows - 1) break;
        const d = Math.hypot((fc - c0) * cx, (fr - r0) * cy);
        if (d > range) break;
        const z = sampleElevation(grid, fc * cx, fr * cy) - (d * d) / (2 * effR);
        if ((z + clientHeightM - z0) / d >= maxTan) mark(fc, fr);
        const t = (z - z0) / d;
        if (t > maxTan) maxTan = t;
      }
    };
    for (let i = -rc; i <= rc; i++) {
      ray(c0 + i, r0 - rc);
      ray(c0 + i, r0 + rc);
      ray(c0 - rc, r0 + i);
      ray(c0 + rc, r0 + i);
    }
  });
  return cov;
}

export interface Traverse {
  /** Polyline in grid metres from A through the waypoints to B. */
  points: { x: number; y: number }[];
  lengthM: number;
  maxGradeDeg: number;
  /** True when some stretch had to cross a hazard (steep, cliff or crater buffer, no-go zone). */
  exceedsLimit: boolean;
  /** Distance walked outside radio coverage, metres. */
  uncoveredM: number;
  /** Distance walked through hazards, metres. */
  hazardM: number;
  /** Uncovered stretches and hazard crossings, as polylines in grid metres. */
  gaps: { x: number; y: number }[][];
  hazards: { x: number; y: number }[][];
}

/** Penalties per metre. Hazards outrank coverage gaps, which outrank effort. */
const HAZARD_COST = 1e5;
const GAP_COST = 250;

/**
 * Safest covered route through the stops in order (A, crew waypoints…, B), A* on the grid's
 * 8-neighbour lattice. Cost per metre = effort (grade and roughness) + GAP_COST if outside coverage
 * (when requireCoverage) + HAZARD_COST in any hazard class or on a step steeper than maxSlopeDeg.
 * Penalties instead of walls mean a route always comes back; what it had to cross is reported.
 */
export function safeTraverse(grid: HeightGrid, base: HazardBase, cls: Uint8Array, coverage: Uint8Array | null, stops: { x: number; y: number }[], s: SafetySettings): Traverse | null {
  if (stops.length < 2) return null;
  const { cols, rows, data } = grid;
  const n = cols * rows;
  const dx = grid.widthM / (cols - 1);
  const dy = grid.heightM / (rows - 1);
  const tanMax = Math.tan((s.maxSlopeDeg * Math.PI) / 180);
  const useCov = s.requireCoverage && !!coverage;
  const DC = [1, 1, 0, -1, -1, -1, 0, 1];
  const DR = [0, 1, 1, 1, 0, -1, -1, -1];
  const RUN = DC.map((c, d) => (d % 2 === 0 ? (c !== 0 ? dx : dy) : Math.hypot(dx, dy)));
  const g = new Float64Array(n);
  const f = new Float64Array(n);
  const from = new Int32Array(n);
  const closed = new Uint8Array(n);
  const idx = (p: { x: number; y: number }) => Math.max(0, Math.min(rows - 1, Math.round(p.y / dy))) * cols + Math.max(0, Math.min(cols - 1, Math.round(p.x / dx)));

  const stepCost = (i: number, j: number, run: number) => {
    const tg = Math.abs(data[j] - data[i]) / run;
    const gradeDeg = (Math.atan(tg) * 180) / Math.PI;
    const rough = base.slopeDeg[j] / Math.max(1, s.maxSlopeDeg);
    let c = run * (1 + (gradeDeg / 10) ** 2 + 0.5 * s.roughnessWeight * rough * rough);
    if (cls[j] !== HAZARD.safe || tg > tanMax) c += run * HAZARD_COST;
    if (useCov && coverage![j] === 0) c += run * GAP_COST;
    return c;
  };

  const leg = (a: number, b: number): number[] => {
    g.fill(Infinity);
    from.fill(-1);
    closed.fill(0);
    const br = (b / cols) | 0;
    const bc = b - br * cols;
    const h = (i: number) => {
      const r = (i / cols) | 0;
      return Math.hypot((i - r * cols - bc) * dx, (r - br) * dy);
    };
    g[a] = 0;
    f[a] = h(a);
    const heap = new IndexHeap(f);
    heap.push(a);
    while (heap.size) {
      const i = heap.pop();
      if (closed[i]) continue;
      closed[i] = 1;
      if (i === b) break;
      const r = (i / cols) | 0;
      const c = i - r * cols;
      for (let d = 0; d < 8; d++) {
        const cc = c + DC[d];
        const rr = r + DR[d];
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
        const j = rr * cols + cc;
        if (closed[j]) continue;
        const cost = g[i] + stepCost(i, j, RUN[d]);
        if (cost < g[j]) {
          g[j] = cost;
          f[j] = cost + h(j);
          from[j] = i;
          heap.push(j);
        }
      }
    }
    const path: number[] = [];
    for (let i = b; i !== -1; i = from[i]) path.push(i);
    return path.reverse();
  };

  const cells: number[] = [];
  for (let k = 0; k + 1 < stops.length; k++) {
    const p = leg(idx(stops[k]), idx(stops[k + 1]));
    cells.push(...(cells.length ? p.slice(1) : p));
  }
  const pt = (i: number) => {
    const r = (i / cols) | 0;
    return { x: (i - r * cols) * dx, y: r * dy };
  };
  const points = cells.map(pt);
  let lengthM = 0;
  let maxTan = 0;
  let uncoveredM = 0;
  let hazardM = 0;
  const gaps: { x: number; y: number }[][] = [];
  const hazards: { x: number; y: number }[][] = [];
  let gapOpen = false;
  let hazOpen = false;
  for (let k = 1; k < cells.length; k++) {
    const i = cells[k - 1];
    const j = cells[k];
    const run = Math.hypot(points[k].x - points[k - 1].x, points[k].y - points[k - 1].y);
    if (run === 0) continue;
    lengthM += run;
    const tg = Math.abs(data[j] - data[i]) / run;
    maxTan = Math.max(maxTan, tg);
    const isGap = !!coverage && coverage[j] === 0;
    const isHaz = cls[j] !== HAZARD.safe || tg > tanMax;
    if (isGap) {
      uncoveredM += run;
      if (!gapOpen) gaps.push([points[k - 1]]);
      gaps[gaps.length - 1].push(points[k]);
    }
    if (isHaz) {
      hazardM += run;
      if (!hazOpen) hazards.push([points[k - 1]]);
      hazards[hazards.length - 1].push(points[k]);
    }
    gapOpen = isGap;
    hazOpen = isHaz;
  }
  return { points, lengthM, maxGradeDeg: (Math.atan(maxTan) * 180) / Math.PI, exceedsLimit: hazardM > 0, uncoveredM, hazardM, gaps, hazards };
}

export interface HazardBreakdown {
  /** Metres by hazard class: ground over the walking slope, cliff buffer, crater buffer, no-go zone. */
  steep: number;
  cliff: number;
  crater: number;
  zone: number;
}

export interface TraverseExplanation {
  /** Grid spacing the search worked on, metres. */
  cellM: number;
  /** Crew waypoints between A and B. */
  waypoints: number;
  path: { lengthM: number; hazardM: number; gapM: number; gapStretches: number; longestGapM: number; hazards: HazardBreakdown; maxGradeDeg: number; meanGradeDeg: number };
  /** The same stops joined by straight lines, measured against the same hazard and coverage maps. */
  straight: { lengthM: number; hazardM: number; gapM: number; hazards: HazardBreakdown };
  /** Extra walking (metres) the search accepts to avoid one metre without signal. */
  gapTradeM: number;
  /** Extra walking or signal loss (metres) the search accepts to avoid one metre of hazard. */
  hazardTradeM: number;
}

const zeroHaz = (): HazardBreakdown => ({ steep: 0, cliff: 0, crater: 0, zone: 0 });
const addHaz = (h: HazardBreakdown, cls: number, steepStep: boolean, run: number) => {
  if (cls === HAZARD.zone) h.zone += run;
  else if (cls === HAZARD.crater) h.crater += run;
  else if (cls === HAZARD.cliff) h.cliff += run;
  else if (cls === HAZARD.steep || steepStep) h.steep += run;
};
const sumHaz = (h: HazardBreakdown) => h.steep + h.cliff + h.crater + h.zone;

/**
 * Facts behind a crew path, for a plain-language "why this path" summary: what the chosen path
 * crosses, what the straight line through the same stops would cross, and the trade-offs the cost
 * weights imply. Everything is measured on the same grid, hazard map and coverage map as the search.
 */
export function explainTraverse(grid: HeightGrid, cls: Uint8Array, coverage: Uint8Array | null, stops: { x: number; y: number }[], t: Traverse, s: SafetySettings): TraverseExplanation {
  const { cols, rows, data } = grid;
  const dx = grid.widthM / (cols - 1);
  const dy = grid.heightM / (rows - 1);
  const tanMax = Math.tan((s.maxSlopeDeg * Math.PI) / 180);
  const at = (x: number, y: number) => Math.max(0, Math.min(rows - 1, Math.round(y / dy))) * cols + Math.max(0, Math.min(cols - 1, Math.round(x / dx)));

  const ph = zeroHaz();
  let gapStretches = 0;
  let longest = 0;
  let run = 0;
  let gradeSum = 0;
  for (let k = 1; k < t.points.length; k++) {
    const a = t.points[k - 1];
    const b = t.points[k];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (!d) continue;
    const i = at(a.x, a.y);
    const j = at(b.x, b.y);
    const tg = Math.abs(data[j] - data[i]) / d;
    gradeSum += ((Math.atan(tg) * 180) / Math.PI) * d;
    addHaz(ph, cls[j], tg > tanMax, d);
    if (coverage && coverage[j] === 0) {
      if (run === 0) gapStretches++;
      run += d;
      longest = Math.max(longest, run);
    } else run = 0;
  }

  const sh = zeroHaz();
  let sLen = 0;
  let sGap = 0;
  const step = Math.min(dx, dy) / 2;
  for (let k = 0; k + 1 < stops.length; k++) {
    const a = stops[k];
    const b = stops[k + 1];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    sLen += L;
    const n = Math.max(1, Math.ceil(L / step));
    let prev = at(a.x, a.y);
    for (let m = 1; m <= n; m++) {
      const x = a.x + ((b.x - a.x) * m) / n;
      const y = a.y + ((b.y - a.y) * m) / n;
      const j = at(x, y);
      const tg = Math.abs(data[j] - data[prev]) / (L / n);
      addHaz(sh, cls[j], tg > tanMax, L / n);
      if (coverage && coverage[j] === 0) sGap += L / n;
      prev = j;
    }
  }

  // Effort per metre on the worst walkable ground: grade at the limit, full roughness.
  const maxEffort = 1 + (s.maxSlopeDeg / 10) ** 2 + 0.5 * s.roughnessWeight;
  return {
    cellM: Math.min(dx, dy),
    waypoints: Math.max(0, stops.length - 2),
    path: { lengthM: t.lengthM, hazardM: sumHaz(ph), gapM: t.uncoveredM, gapStretches, longestGapM: longest, hazards: ph, maxGradeDeg: t.maxGradeDeg, meanGradeDeg: t.lengthM ? gradeSum / t.lengthM : 0 },
    straight: { lengthM: sLen, hazardM: sumHaz(sh), gapM: sGap, hazards: sh },
    gapTradeM: s.requireCoverage ? Math.round(GAP_COST / maxEffort) : 0,
    hazardTradeM: Math.round(HAZARD_COST / (GAP_COST + maxEffort)),
  };
}
