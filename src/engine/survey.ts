import type { HeightGrid } from './types';
import { sampleElevation } from './terrain/grid';

/**
 * Survey layers derived from the planning grid for the 2D survey map: slope, drainage channels,
 * closed depressions, contours and a slope-limited walking route. Pure maths on the grid, no DOM.
 *
 * Everything is in grid metres (x east, y north, row 0 = south edge), like the rest of the engine.
 * These are terrain-analysis derivations, not mapped features: a "channel" is where water would
 * collect if it flowed over today's surface, and a "depression" is a closed hollow (often a crater).
 */

export interface ChannelSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 1 (smallest) to 4 (largest), from the upstream contributing area. */
  order: number;
}

/** A channel traced from its head downstream until it joins a larger one (inclusive) or leaves the grid. */
export interface ChannelLine {
  points: { x: number; y: number }[];
  /** Strength (1 to 4) at each point, growing downstream. */
  orders: number[];
}

export interface Depression {
  id: string;
  /** Deepest point, grid metres. */
  x: number;
  y: number;
  /** Radius of a circle with the same area, metres. */
  radiusM: number;
  /** Fill depth at the deepest point, metres. */
  depthM: number;
}

export interface ContourLevel {
  levelM: number;
  /** Every fifth level is an index contour, drawn heavier. */
  major: boolean;
  /** Flat list of segments: x1, y1, x2, y2, ... in grid metres. */
  segments: Float32Array;
}

export interface SurveyLayers {
  cols: number;
  rows: number;
  /** Slope at each grid node, degrees. */
  slopeDeg: Float32Array;
  channels: ChannelSegment[];
  /** The same channels chained into polylines, for smooth drawing. */
  channelLines: ChannelLine[];
  depressions: Depression[];
  contours: ContourLevel[];
  contourIntervalM: number;
}

export interface SurveyOptions {
  /** Minimum fill depth for a depression to be reported, metres. */
  minDepressionDepthM?: number;
  /** Most depressions reported, largest first. */
  maxDepressions?: number;
  /** Target number of contour levels across the elevation range. */
  contourLevels?: number;
  /**
   * Native resolution of the elevation source, metres. Valleys are judged at this scale, so a coarse
   * source resampled onto a fine grid does not turn its interpolation creases into channels.
   */
  sourceResolutionM?: number;
}

const SQRT2 = Math.SQRT2;
const DC = [1, 1, 0, -1, -1, -1, 0, 1];
const DR = [0, 1, 1, 1, 0, -1, -1, -1];

function spacing(grid: HeightGrid): { dx: number; dy: number } {
  return { dx: grid.widthM / (grid.cols - 1), dy: grid.heightM / (grid.rows - 1) };
}

/** Slope in degrees at every grid node (central differences, one-sided at the edges). */
export function slopeGrid(grid: HeightGrid): Float32Array {
  const { cols, rows, data } = grid;
  const { dx, dy } = spacing(grid);
  const out = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const r0 = r > 0 ? r - 1 : r;
    const r1 = r < rows - 1 ? r + 1 : r;
    for (let c = 0; c < cols; c++) {
      const c0 = c > 0 ? c - 1 : c;
      const c1 = c < cols - 1 ? c + 1 : c;
      const gx = (data[r * cols + c1] - data[r * cols + c0]) / ((c1 - c0) * dx);
      const gy = (data[r1 * cols + c] - data[r0 * cols + c]) / ((r1 - r0) * dy);
      out[r * cols + c] = (Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI;
    }
  }
  return out;
}

/**
 * Lambertian hillshade, 0..1, lit from `azimuthDeg` (clockwise from north) at `altitudeDeg`.
 * `zFactor` exaggerates relief for display only.
 */
export function hillshade(grid: HeightGrid, azimuthDeg = 315, altitudeDeg = 35, zFactor = 1): Float32Array {
  const { cols, rows, data } = grid;
  const { dx, dy } = spacing(grid);
  const az = (azimuthDeg * Math.PI) / 180;
  const alt = (altitudeDeg * Math.PI) / 180;
  const lx = Math.sin(az) * Math.cos(alt);
  const ly = Math.cos(az) * Math.cos(alt);
  const lz = Math.sin(alt);
  const out = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const r0 = r > 0 ? r - 1 : r;
    const r1 = r < rows - 1 ? r + 1 : r;
    for (let c = 0; c < cols; c++) {
      const c0 = c > 0 ? c - 1 : c;
      const c1 = c < cols - 1 ? c + 1 : c;
      const gx = (zFactor * (data[r * cols + c1] - data[r * cols + c0])) / ((c1 - c0) * dx);
      const gy = (zFactor * (data[r1 * cols + c] - data[r0 * cols + c])) / ((r1 - r0) * dy);
      const n = Math.hypot(gx, gy, 1);
      const v = (-gx * lx - gy * ly + lz) / n;
      out[r * cols + c] = v > 0 ? v : 0;
    }
  }
  return out;
}

/** Binary min-heap of grid indices keyed by a float array. */
export class IndexHeap {
  private items: number[] = [];
  constructor(private key: Float32Array | Float64Array) {}
  get size() {
    return this.items.length;
  }
  push(i: number) {
    const a = this.items;
    const k = this.key;
    a.push(i);
    let j = a.length - 1;
    while (j > 0) {
      const p = (j - 1) >> 1;
      if (k[a[p]] <= k[a[j]]) break;
      [a[p], a[j]] = [a[j], a[p]];
      j = p;
    }
  }
  pop(): number {
    const a = this.items;
    const k = this.key;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let j = 0;
      for (;;) {
        const l = 2 * j + 1;
        const r = l + 1;
        let m = j;
        if (l < a.length && k[a[l]] < k[a[m]]) m = l;
        if (r < a.length && k[a[r]] < k[a[m]]) m = r;
        if (m === j) break;
        [a[m], a[j]] = [a[j], a[m]];
        j = m;
      }
    }
    return top;
  }
}

/**
 * Priority-flood from the grid edge. Returns the depression-filled surface, the cell each cell was
 * reached from (its downstream neighbour; -1 for edge outlets) and the visiting order (outlets first).
 */
export function priorityFlood(grid: HeightGrid): { filled: Float32Array; parent: Int32Array; order: Int32Array } {
  const { cols, rows, data } = grid;
  const n = cols * rows;
  const filled = new Float32Array(data);
  const parent = new Int32Array(n).fill(-1);
  const seen = new Uint8Array(n);
  const order = new Int32Array(n);
  let k = 0;
  const heap = new IndexHeap(filled);
  for (let c = 0; c < cols; c++) {
    for (const r of [0, rows - 1]) {
      const i = r * cols + c;
      if (!seen[i]) {
        seen[i] = 1;
        heap.push(i);
      }
    }
  }
  for (let r = 1; r < rows - 1; r++) {
    for (const c of [0, cols - 1]) {
      const i = r * cols + c;
      if (!seen[i]) {
        seen[i] = 1;
        heap.push(i);
      }
    }
  }
  while (heap.size) {
    const i = heap.pop();
    order[k++] = i;
    const r = (i / cols) | 0;
    const c = i - r * cols;
    for (let d = 0; d < 8; d++) {
      const cc = c + DC[d];
      const rr = r + DR[d];
      if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
      const j = rr * cols + cc;
      if (seen[j]) continue;
      seen[j] = 1;
      parent[j] = i;
      if (filled[j] < filled[i]) filled[j] = filled[i];
      heap.push(j);
    }
  }
  return { filled, parent, order };
}

function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}

/** Marching-squares contour segments for one level. */
function contourSegments(grid: HeightGrid, level: number, out: number[]): void {
  const { cols, rows, data } = grid;
  const { dx, dy } = spacing(grid);
  const lerp = (a: number, b: number) => (level - a) / (b - a);
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const i = r * cols + c;
      const z0 = data[i]; // (c, r)      south-west
      const z1 = data[i + 1]; // (c+1, r)    south-east
      const z2 = data[i + cols + 1]; // (c+1, r+1)  north-east
      const z3 = data[i + cols]; // (c, r+1)    north-west
      const idx = (z0 >= level ? 1 : 0) | (z1 >= level ? 2 : 0) | (z2 >= level ? 4 : 0) | (z3 >= level ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const x = c * dx;
      const y = r * dy;
      // Edge crossing points: S (z0-z1), E (z1-z2), N (z3-z2), W (z0-z3).
      const S = () => [x + lerp(z0, z1) * dx, y];
      const E = () => [x + dx, y + lerp(z1, z2) * dy];
      const N = () => [x + lerp(z3, z2) * dx, y + dy];
      const W = () => [x, y + lerp(z0, z3) * dy];
      const seg = (a: number[], b: number[]) => out.push(a[0], a[1], b[0], b[1]);
      switch (idx) {
        case 1:
        case 14:
          seg(W(), S());
          break;
        case 2:
        case 13:
          seg(S(), E());
          break;
        case 3:
        case 12:
          seg(W(), E());
          break;
        case 4:
        case 11:
          seg(E(), N());
          break;
        case 5:
          seg(W(), N());
          seg(S(), E());
          break;
        case 6:
        case 9:
          seg(S(), N());
          break;
        case 7:
        case 8:
          seg(W(), N());
          break;
        case 10:
          seg(W(), S());
          seg(E(), N());
          break;
      }
    }
  }
}

/** Bilinear resample of a grid to roughly `spacingM` between points (at least 5 per side). */
export function resampleGrid(grid: HeightGrid, spacingM: number): HeightGrid {
  const cols = Math.max(5, Math.round(grid.widthM / spacingM) + 1);
  const rows = Math.max(5, Math.round(grid.heightM / spacingM) + 1);
  const data = new Float32Array(cols * rows);
  let min = Infinity;
  let max = -Infinity;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const e = sampleElevation(grid, (c / (cols - 1)) * grid.widthM, (r / (rows - 1)) * grid.heightM);
      data[r * cols + c] = e;
      if (e < min) min = e;
      if (e > max) max = e;
    }
  }
  return { cols, rows, widthM: grid.widthM, heightM: grid.heightM, data, minElevM: min, maxElevM: max };
}

export function surveyLayers(grid: HeightGrid, opts: SurveyOptions = {}): SurveyLayers {
  const { cols, rows, data } = grid;
  const n = cols * rows;
  const { dx, dy } = spacing(grid);
  const cellArea = dx * dy;
  const relief = Math.max(1e-6, grid.maxElevM - grid.minElevM);

  const slopeDeg = slopeGrid(grid);
  // Drainage and depressions are analysed at the elevation source's own resolution: on a coarse
  // source resampled onto a fine grid, bilinear creases would otherwise become rows of fake channels.
  const drainage = (g: HeightGrid) => {
  const { cols, rows, data } = g;
  const n = cols * rows;
  const { dx, dy } = spacing(g);
  const cellArea = dx * dy;
  const { filled, parent, order } = priorityFlood(g);

  // Drainage: accumulate contributing cells downstream, in reverse flood order (ridges first).
  const acc = new Float32Array(n).fill(1);
  for (let k = n - 1; k >= 0; k--) {
    const i = order[k];
    const p = parent[i];
    if (p >= 0) acc[p] += acc[i];
  }
  const minDepth = opts.minDepressionDepthM ?? Math.max(2, relief * 0.01);
  const threshold = Math.max(24, Math.round(n / 260));
  const strengthOf = (i: number) => Math.min(4, 1 + Math.floor(Math.log2(acc[i] / threshold) / 1.5));
  // A channel needs a valley: on a plane, D8 routing draws straight parallel lines that are not
  // channels at all. Concavity = mean of the 8 points two cells away minus the point itself.
  const concaveMin = Math.max(0.3, relief * 0.0008);
  const ring = 2;
  const concave = (i: number) => {
    const r = (i / cols) | 0;
    const c = i - r * cols;
    let sum = 0;
    let cnt = 0;
    for (let d = 0; d < 8; d++) {
      const cc = c + ring * DC[d];
      const rr = r + ring * DR[d];
      if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
      sum += data[rr * cols + cc];
      cnt++;
    }
    // A one-sided ring at the edge would read a plane as concave, so the outer two cells carry no channels.
    return cnt === 8 && sum / cnt - data[i] > concaveMin;
  };
  // Inside a filled hollow the flood direction is arbitrary; channels stop at the rim.
  const isChannel = (i: number) => {
    const p = parent[i];
    return p >= 0 && acc[i] >= threshold && concave(i) && !(filled[i] - data[i] > minDepth && filled[p] - data[p] > minDepth);
  };
  const xy = (i: number) => {
    const r = (i / cols) | 0;
    return { x: (i - r * cols) * dx, y: r * dy };
  };
  const channels: ChannelSegment[] = [];
  const feeds = new Uint8Array(n); // has an upstream channel cell
  for (let i = 0; i < n; i++) {
    if (!isChannel(i)) continue;
    const a = xy(i);
    const b = xy(parent[i]);
    channels.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, order: strengthOf(i) });
    feeds[parent[i]] = 1;
  }
  // Chain into polylines: start at heads, walk downstream, stop after joining a traced line.
  const traced = new Uint8Array(n);
  const channelLines: ChannelLine[] = [];
  const trace = (start: number) => {
    const points = [xy(start)];
    const orders = [strengthOf(start)];
    traced[start] = 1;
    let i = start;
    while (isChannel(i)) {
      const p = parent[i];
      points.push(xy(p));
      orders.push(acc[p] >= threshold ? strengthOf(p) : orders[orders.length - 1]);
      if (traced[p]) break;
      traced[p] = 1;
      i = p;
    }
    if (points.length > 1) channelLines.push({ points, orders });
  };
  for (let i = 0; i < n; i++) if (isChannel(i) && !feeds[i]) trace(i);
  for (let i = 0; i < n; i++) if (isChannel(i) && !traced[i]) trace(i); // loops or headless pieces

  // Depressions: connected regions where the filled surface stands above the terrain.
  const label = new Int32Array(n).fill(-1);
  const found: Depression[] = [];
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    if (label[i] !== -1 || filled[i] - data[i] <= minDepth) continue;
    let count = 0;
    let deepest = i;
    stack.push(i);
    label[i] = found.length;
    while (stack.length) {
      const j = stack.pop()!;
      count++;
      if (filled[j] - data[j] > filled[deepest] - data[deepest]) deepest = j;
      const r = (j / cols) | 0;
      const c = j - r * cols;
      for (let d = 0; d < 8; d++) {
        const cc = c + DC[d];
        const rr = r + DR[d];
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
        const k = rr * cols + cc;
        if (label[k] !== -1 || filled[k] - data[k] <= minDepth * 0.25) continue;
        label[k] = found.length;
        stack.push(k);
      }
    }
    const radiusM = Math.sqrt((count * cellArea) / Math.PI);
    const r = (deepest / cols) | 0;
    const c = deepest - r * cols;
    found.push({ id: '', x: c * dx, y: r * dy, radiusM, depthM: filled[deepest] - data[deepest] });
  }
  const minRadius = 1.5 * Math.max(dx, dy);
  const depressions = found
    .filter((d) => d.radiusM >= minRadius)
    .sort((a, b) => b.radiusM - a.radiusM)
    .slice(0, opts.maxDepressions ?? 24)
    .map((d, k) => ({ ...d, id: `D${k + 1}` }));
  return { channels, channelLines, depressions };
  };
  const src = opts.sourceResolutionM ?? 0;
  const coarse = src > 1.5 * Math.min(dx, dy);
  const { channels, channelLines, depressions } = drainage(coarse ? resampleGrid(grid, src) : grid);

  // Contours at a round interval giving roughly the requested number of levels.
  const target = opts.contourLevels ?? 16;
  const contourIntervalM = niceStep(relief / target);
  const contours: ContourLevel[] = [];
  const first = Math.ceil(grid.minElevM / contourIntervalM) * contourIntervalM;
  for (let level = first; level < grid.maxElevM; level += contourIntervalM) {
    const segs: number[] = [];
    contourSegments(grid, level, segs);
    if (segs.length) {
      const index = Math.round(level / contourIntervalM);
      contours.push({ levelM: level, major: index % 5 === 0, segments: new Float32Array(segs) });
    }
  }

  return { cols, rows, slopeDeg, channels, channelLines, depressions, contours, contourIntervalM };
}

export interface WalkRoute {
  /** Polyline in grid metres from the first to the last waypoint. */
  points: { x: number; y: number }[];
  lengthM: number;
  /** Steepest step grade along the route, degrees. */
  maxGradeDeg: number;
  /** True when no route under the slope limit exists and the limit had to be dropped for some leg. */
  exceedsLimit: boolean;
}

/**
 * Least-effort walking route through the waypoints in order, on the grid's 8-neighbour lattice.
 * Step cost = distance × (1 + (grade / 15°)²); steps steeper than `maxGradeDeg` are impassable
 * unless no route exists without them, in which case the leg is retried without the limit.
 */
export function walkingRoute(grid: HeightGrid, waypoints: { x: number; y: number }[], maxGradeDeg = 25): WalkRoute | null {
  if (waypoints.length < 2) return null;
  const { cols, rows, data } = grid;
  const { dx, dy } = spacing(grid);
  const n = cols * rows;
  const toIndex = (p: { x: number; y: number }) => {
    const c = Math.max(0, Math.min(cols - 1, Math.round(p.x / dx)));
    const r = Math.max(0, Math.min(rows - 1, Math.round(p.y / dy)));
    return r * cols + c;
  };
  const tanLimit = Math.tan((maxGradeDeg * Math.PI) / 180);
  const g = new Float64Array(n);
  const f = new Float64Array(n);
  const from = new Int32Array(n);
  const closed = new Uint8Array(n);

  const leg = (s: number, t: number, limited: boolean): number[] | null => {
    g.fill(Infinity);
    from.fill(-1);
    closed.fill(0);
    const tr = (t / cols) | 0;
    const tc = t - tr * cols;
    const h = (i: number) => {
      const r = (i / cols) | 0;
      return Math.hypot((i - r * cols - tc) * dx, (r - tr) * dy);
    };
    g[s] = 0;
    f[s] = h(s);
    const heap = new IndexHeap(f);
    heap.push(s);
    while (heap.size) {
      const i = heap.pop();
      if (closed[i]) continue;
      closed[i] = 1;
      if (i === t) break;
      const r = (i / cols) | 0;
      const c = i - r * cols;
      for (let d = 0; d < 8; d++) {
        const cc = c + DC[d];
        const rr = r + DR[d];
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
        const j = rr * cols + cc;
        if (closed[j]) continue;
        const run = d % 2 === 0 ? (DC[d] !== 0 ? dx : dy) : Math.hypot(dx, dy);
        const tanGrade = Math.abs(data[j] - data[i]) / run;
        if (limited && tanGrade > tanLimit) continue;
        const grade = (Math.atan(tanGrade) * 180) / Math.PI;
        const cost = g[i] + run * (1 + (grade / 15) ** 2);
        if (cost < g[j]) {
          g[j] = cost;
          f[j] = cost + h(j);
          from[j] = i;
          heap.push(j);
        }
      }
    }
    if (!closed[t]) return null;
    const path: number[] = [];
    for (let i = t; i !== -1; i = from[i]) path.push(i);
    return path.reverse();
  };

  const cells: number[] = [];
  let exceedsLimit = false;
  for (let k = 0; k + 1 < waypoints.length; k++) {
    const s = toIndex(waypoints[k]);
    const t = toIndex(waypoints[k + 1]);
    let path = leg(s, t, true);
    if (!path) {
      exceedsLimit = true;
      path = leg(s, t, false);
    }
    if (!path) return null;
    cells.push(...(cells.length ? path.slice(1) : path));
  }

  const points = cells.map((i) => {
    const r = (i / cols) | 0;
    return { x: (i - r * cols) * dx, y: r * dy };
  });
  let lengthM = 0;
  let maxTan = 0;
  for (let k = 1; k < cells.length; k++) {
    const run = Math.hypot(points[k].x - points[k - 1].x, points[k].y - points[k - 1].y);
    lengthM += run;
    if (run > 0) maxTan = Math.max(maxTan, Math.abs(data[cells[k]] - data[cells[k - 1]]) / run);
  }
  return { points, lengthM, maxGradeDeg: (Math.atan(maxTan) * 180) / Math.PI, exceedsLimit };
}

/** Elevation samples along the straight line from a to b: distance from a and terrain height, metres. */
export function terrainProfile(grid: HeightGrid, a: { x: number; y: number }, b: { x: number; y: number }, samples = 160): { d: number; z: number }[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const out: { d: number; z: number }[] = [];
  for (let k = 0; k <= samples; k++) {
    const t = k / samples;
    out.push({ d: t * len, z: sampleElevation(grid, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t) });
  }
  return out;
}
