import { hillshade } from '../engine';
import type { CoverageMap, HeightGrid, SurveyLayers } from '../engine';
import { COVERAGE_COLOR } from '../theme';

/**
 * Canvas drawing shared by the 2D survey map and the globe's draped survey overlay.
 * Layers are built once per grid (rasters, Path2D in grid metres) and drawn under any view transform.
 */

/** Display-only relief exaggeration for the hillshade. */
export const SHADE_Z = 3;
/** Walking slope limit drawn as hatching, degrees (matches walkingRoute's default). */
export const NO_GO_SLOPE_DEG = 25;

export type Pt = { x: number; y: number };

const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** Rust ramp for the shaded relief: shadow, mid, lit, highlight. */
const RAMP: [number, number[]][] = [
  [0, [26, 15, 11]],
  [0.38, [88, 46, 30]],
  [0.72, [170, 100, 68]],
  [1, [228, 168, 128]],
];
export function ramp(t: number): number[] {
  for (let k = 1; k < RAMP.length; k++) {
    if (t <= RAMP[k][0]) {
      const [t0, c0] = RAMP[k - 1];
      const [t1, c1] = RAMP[k];
      const u = (t - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * u, c0[1] + (c1[1] - c0[1]) * u, c0[2] + (c1[2] - c0[2]) * u];
    }
  }
  return RAMP[RAMP.length - 1][1];
}

/** Chaikin corner cutting, for drawing lattice paths as smooth lines. */
export function smooth(points: Pt[], rounds = 2): Pt[] {
  let p = points;
  for (let r = 0; r < rounds && p.length > 2; r++) {
    const out: Pt[] = [p[0]];
    for (let i = 0; i + 1 < p.length; i++) {
      const a = p[i];
      const b = p[i + 1];
      out.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y }, { x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y });
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export interface SurveyRasters {
  /** Shaded relief, one pixel per grid node, north at the top. */
  terrain: HTMLCanvasElement;
  /** Alpha mask of ground steeper than the walking limit, or null when there is none. */
  steep: HTMLCanvasElement | null;
}

export function buildRasters(grid: HeightGrid, layers: SurveyLayers): SurveyRasters {
  const { cols, rows, data, minElevM, maxElevM } = grid;
  const shade = hillshade(grid, 315, 38, SHADE_Z);
  const relief = Math.max(1, maxElevM - minElevM);
  const img = new ImageData(cols, rows);
  const mask = new ImageData(cols, rows);
  let steep = 0;
  for (let r = 0; r < rows; r++) {
    const dst = (rows - 1 - r) * cols;
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const t = Math.max(0, Math.min(1, 0.04 + 0.8 * shade[i] + 0.2 * ((data[i] - minElevM) / relief) - 0.08));
      const [R, G, B] = ramp(t);
      const o = (dst + c) * 4;
      img.data[o] = R;
      img.data[o + 1] = G;
      img.data[o + 2] = B;
      img.data[o + 3] = 255;
      if (layers.slopeDeg[i] > NO_GO_SLOPE_DEG) {
        mask.data[o + 3] = 255;
        steep++;
      }
    }
  }
  const terrain = canvasOf(cols, rows);
  terrain.getContext('2d')!.putImageData(img, 0, 0);
  let steepCanvas: HTMLCanvasElement | null = null;
  if (steep) {
    steepCanvas = canvasOf(cols, rows);
    steepCanvas.getContext('2d')!.putImageData(mask, 0, 0);
  }
  return { terrain, steep: steepCanvas };
}

export function coverageCanvas(coverage: CoverageMap): HTMLCanvasElement {
  const { res, cells } = coverage;
  const img = new ImageData(res, res);
  const cols3 = [hex(COVERAGE_COLOR.none), hex(COVERAGE_COLOR.marginal), hex(COVERAGE_COLOR.good)];
  for (let cy = 0; cy < res; cy++) {
    for (let cx = 0; cx < res; cx++) {
      const v = cells[cy * res + cx];
      const o = ((res - 1 - cy) * res + cx) * 4;
      const [R, G, B] = cols3[v];
      img.data[o] = R;
      img.data[o + 1] = G;
      img.data[o + 2] = B;
      img.data[o + 3] = v === 0 ? 70 : 92;
    }
  }
  const c = canvasOf(res, res);
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c;
}

export interface SurveyPaths {
  minor: Path2D;
  major: Path2D;
  /** Channels by strength 1..4. */
  channels: Path2D[];
}

/** Contours and channels as Path2D in grid metres (y north-up). */
export function buildPaths(layers: SurveyLayers): SurveyPaths {
  const minor = new Path2D();
  const major = new Path2D();
  for (const lvl of layers.contours) {
    const p = lvl.major ? major : minor;
    const s = lvl.segments;
    for (let i = 0; i < s.length; i += 4) {
      p.moveTo(s[i], s[i + 1]);
      p.lineTo(s[i + 2], s[i + 3]);
    }
  }
  const channels = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
  for (const line of layers.channelLines) {
    const pts = smooth(line.points, 3);
    for (let j = 0; j + 1 < pts.length; j++) {
      const ord = line.orders[Math.min(line.orders.length - 1, Math.floor((j * line.orders.length) / pts.length))];
      const p = channels[ord - 1];
      p.moveTo(pts[j].x, pts[j].y);
      p.lineTo(pts[j + 1].x, pts[j + 1].y);
    }
  }
  return { minor, major, channels };
}

let grain: HTMLCanvasElement | null = null;
/** A deterministic 192 px noise tile (seeded LCG), built once. Texture only; it carries no data. */
function grainTile(): HTMLCanvasElement {
  if (grain) return grain;
  const size = 192;
  const c = canvasOf(size, size);
  const img = new ImageData(size, size);
  let seed = 1337;
  for (let i = 0; i < size * size; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const v = 96 + (seed >>> 24) * 0.25;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  c.getContext('2d')!.putImageData(img, 0, 0);
  grain = c;
  return c;
}

const hatchTiles = new Map<number, HTMLCanvasElement>();
function hatchTile(dpr: number): HTMLCanvasElement {
  const ps = Math.round(8 * dpr);
  let c = hatchTiles.get(ps);
  if (c) return c;
  c = canvasOf(ps, ps);
  const p = c.getContext('2d')!;
  p.strokeStyle = 'rgba(169,196,195,0.8)';
  p.lineWidth = dpr;
  p.beginPath();
  p.moveTo(-1, ps + 1);
  p.lineTo(ps + 1, -1);
  p.moveTo(-1, 1);
  p.lineTo(1, -1);
  p.moveTo(ps - 1, ps + 1);
  p.lineTo(ps + 1, ps - 1);
  p.stroke();
  hatchTiles.set(ps, c);
  return c;
}

let scratch: HTMLCanvasElement | null = null;

/** Which part of the grid the canvas shows: west edge and north edge in grid metres, canvas pixels per metre. */
export interface ViewXf {
  x0: number;
  yTop: number;
  S: number;
}

export interface DrawOptions {
  view: ViewXf;
  /** Device pixels per CSS pixel; line widths are given in CSS pixels. */
  dpr: number;
  terrain: boolean;
  grain: boolean;
  coverage?: HTMLCanvasElement | null;
  /** Optional walking route to draw into the raster (the globe overlay has no SVG layer). */
  walk?: Pt[] | null;
  /** Scale all line widths, e.g. thicker on the globe texture. */
  lineScale?: number;
}

export function drawSurvey(ctx: CanvasRenderingContext2D, grid: HeightGrid, rasters: SurveyRasters, paths: SurveyPaths, o: DrawOptions): void {
  const { width: cw, height: ch } = ctx.canvas;
  const { x0, yTop, S } = o.view;
  const W = grid.widthM;
  const H = grid.heightM;
  const px = (v: number) => (v * o.dpr * (o.lineScale ?? 1)) / S;
  const imageXf = () => ctx.setTransform(S, 0, 0, S, -x0 * S, -(H - yTop) * S);
  const vectorXf = () => ctx.setTransform(S, 0, 0, -S, -x0 * S, yTop * S);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (o.terrain) {
    imageXf();
    ctx.drawImage(rasters.terrain, 0, 0, W, H);
    ctx.fillStyle = 'rgba(22,17,14,0.16)';
    ctx.fillRect(0, 0, W, H);
  }
  if (o.coverage) {
    imageXf();
    ctx.drawImage(o.coverage, 0, 0, W, H);
  }
  if (rasters.steep) {
    if (!scratch) scratch = canvasOf(cw, ch);
    if (scratch.width !== cw || scratch.height !== ch) {
      scratch.width = cw;
      scratch.height = ch;
    }
    const t = scratch.getContext('2d')!;
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.globalCompositeOperation = 'source-over';
    t.clearRect(0, 0, cw, ch);
    t.imageSmoothingEnabled = true;
    t.setTransform(S, 0, 0, S, -x0 * S, -(H - yTop) * S);
    t.drawImage(rasters.steep, 0, 0, W, H);
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.globalCompositeOperation = 'source-in';
    t.fillStyle = t.createPattern(hatchTile(o.dpr), 'repeat')!;
    t.fillRect(0, 0, cw, ch);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(scratch, 0, 0);
  }

  vectorXf();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(217,180,108,0.26)';
  ctx.lineWidth = px(0.7);
  ctx.stroke(paths.minor);
  ctx.strokeStyle = 'rgba(217,180,108,0.62)';
  ctx.lineWidth = px(1.1);
  ctx.stroke(paths.major);
  for (let order = 1; order <= 4; order++) {
    ctx.strokeStyle = 'rgba(169,196,195,0.09)';
    ctx.lineWidth = px(3 + order * 2.4);
    ctx.stroke(paths.channels[order - 1]);
  }
  for (let order = 1; order <= 4; order++) {
    ctx.strokeStyle = `rgba(169,196,195,${0.4 + order * 0.14})`;
    ctx.lineWidth = px(0.6 + order * 0.38);
    ctx.stroke(paths.channels[order - 1]);
  }

  if (o.walk && o.walk.length > 1) {
    const w = new Path2D();
    const pts = smooth(o.walk, 3);
    w.moveTo(pts[0].x, pts[0].y);
    for (const p of pts.slice(1)) w.lineTo(p.x, p.y);
    ctx.strokeStyle = 'rgba(251,241,228,0.35)';
    ctx.lineWidth = px(9);
    ctx.stroke(w);
    ctx.strokeStyle = '#fbf1e4';
    ctx.lineWidth = px(2.4);
    ctx.stroke(w);
  }

  if (o.grain) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = ctx.createPattern(grainTile(), 'repeat')!;
    ctx.fillRect(0, 0, cw, ch);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}
