/// <reference lib="webworker" />
/**
 * Renders survey-map tiles for the detail cache. Every pixel is shaded from the bicubic surface and
 * contours are drawn per pixel at their true distance, so each zoom level is sharp rather than an
 * enlarged copy of the grid. Channels are stroked as smooth polylines on top.
 */
import { sampleBicubic } from '../engine/terrain/grid';
import type { HeightGrid } from '../engine/types';
import { ramp } from '../survey/draw';

export interface TileInit {
  type: 'init';
  grid: HeightGrid;
  /** Smoothed channel polylines: flat x,y pairs in grid metres, plus one strength (1..4) per segment. */
  channels: { pts: Float32Array; orders: Uint8Array }[];
  contourIntervalM: number;
  steepDeg: number;
  shadeZ: number;
  dpr: number;
  tileSize: number;
}
export interface TileJob {
  type: 'tile';
  id: number;
  level: number;
  tx: number;
  ty: number;
}
export interface TileDone {
  id: number;
  level: number;
  tx: number;
  ty: number;
  /** RGBA pixels, TILE × TILE. Kept in ordinary memory by the cache (not GPU-backed bitmaps). */
  pixels: Uint8ClampedArray<ArrayBuffer>;
}

let init: TileInit | null = null;
let channelPaths: Path2D[] = [];

const AZ = (315 * Math.PI) / 180;
const ALT = (38 * Math.PI) / 180;
const LX = Math.sin(AZ) * Math.cos(ALT);
const LY = Math.cos(AZ) * Math.cos(ALT);
const LZ = Math.sin(ALT);

/** The colour ramp as a 257-entry lookup table, to avoid an allocation per pixel. */
const LUT = new Float32Array(257 * 3);
for (let k = 0; k <= 256; k++) {
  const c = ramp(k / 256);
  LUT[k * 3] = c[0];
  LUT[k * 3 + 1] = c[1];
  LUT[k * 3 + 2] = c[2];
}

function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function render(job: TileJob): Uint8ClampedArray<ArrayBuffer> {
  const { grid, contourIntervalM: I, steepDeg, shadeZ, dpr, tileSize: T } = init!;
  const side = T * 2 ** job.level;
  const W = grid.widthM;
  const H = grid.heightM;
  const mx = W / side; // metres per tile pixel
  const my = H / side;
  const relief = Math.max(1, grid.maxElevM - grid.minElevM);
  const tanSteep = Math.tan((steepDeg * Math.PI) / 180);
  const hatch = Math.max(4, Math.round(8 * dpr));
  const img = new ImageData(T, T);
  const d = img.data;
  const s: [number, number, number] = [0, 0, 0];
  for (let j = 0; j < T; j++) {
    const gj = job.ty * T + j;
    const y = H - (gj + 0.5) * my;
    for (let i = 0; i < T; i++) {
      const gi = job.tx * T + i;
      const x = (gi + 0.5) * mx;
      sampleBicubic(grid, x, y, s);
      const z = s[0];
      const gx = s[1];
      const gy = s[2];
      // Lambertian shade with display exaggeration, the same light as the grid hillshade.
      const ex = gx * shadeZ;
      const ey = gy * shadeZ;
      const shade = Math.max(0, (-ex * LX - ey * LY + LZ) / Math.hypot(ex, ey, 1));
      const t = Math.max(0, Math.min(1, 0.04 + 0.8 * shade + 0.2 * ((z - grid.minElevM) / relief) - 0.08));
      const li = ((t * 256) | 0) * 3;
      let r = LUT[li] * 0.84 + 22 * 0.16;
      let g = LUT[li + 1] * 0.84 + 17 * 0.16;
      let b = LUT[li + 2] * 0.84 + 14 * 0.16;
      // Steep ground: diagonal hatch at a fixed on-screen spacing.
      const gm = Math.hypot(gx, gy);
      if (gm > tanSteep && (gi + gj) % hatch === 0) {
        r = r * 0.2 + 169 * 0.8;
        g = g * 0.2 + 196 * 0.8;
        b = b * 0.2 + 195 * 0.8;
      }
      // Contours: anti-aliased by the pixel distance to the nearest level along the slope.
      const zpp = gm * Math.min(mx, my);
      if (zpp > 1e-9) {
        const L = Math.round(z / I) * I;
        const dist = Math.abs(z - L) / zpp;
        const major = Math.round(L / I) % 5 === 0;
        const half = ((major ? 1.1 : 0.7) * dpr) / 2;
        const a = Math.max(0, Math.min(1, half + 0.5 - dist)) * (major ? 0.62 : 0.26);
        if (a > 0) {
          r = r * (1 - a) + 217 * a;
          g = g * (1 - a) + 180 * a;
          b = b * (1 - a) + 108 * a;
        }
      }
      // Grain texture (display only, deterministic per pixel).
      const n = 1 + (hash(gi, gj) - 0.5) * 0.11;
      const o = (j * T + i) * 4;
      d[o] = r * n;
      d[o + 1] = g * n;
      d[o + 2] = b * n;
      d[o + 3] = 255;
    }
  }
  const canvas = new OffscreenCanvas(T, T);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.putImageData(img, 0, 0);
  // Channels: grid metres → tile pixels, north up.
  ctx.setTransform(1 / mx, 0, 0, -1 / my, -job.tx * T, H / my - job.ty * T);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const px = (v: number) => v * dpr * Math.min(mx, my);
  for (let o = 1; o <= 4; o++) {
    ctx.strokeStyle = 'rgba(169,196,195,0.09)';
    ctx.lineWidth = px(3 + o * 2.4);
    ctx.stroke(channelPaths[o - 1]);
  }
  for (let o = 1; o <= 4; o++) {
    ctx.strokeStyle = `rgba(169,196,195,${0.4 + o * 0.14})`;
    ctx.lineWidth = px(0.6 + o * 0.38);
    ctx.stroke(channelPaths[o - 1]);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return ctx.getImageData(0, 0, T, T).data;
}

self.onmessage = (ev: MessageEvent<TileInit | TileJob>) => {
  const m = ev.data;
  if (m.type === 'init') {
    init = m;
    channelPaths = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
    for (const ch of m.channels) {
      for (let k = 0; k < ch.orders.length && 2 * k + 3 < ch.pts.length; k++) {
        const p = channelPaths[ch.orders[k] - 1];
        p.moveTo(ch.pts[2 * k], ch.pts[2 * k + 1]);
        p.lineTo(ch.pts[2 * k + 2], ch.pts[2 * k + 3]);
      }
    }
    return;
  }
  const pixels = render(m);
  const done: TileDone = { id: m.id, level: m.level, tx: m.tx, ty: m.ty, pixels };
  (self as unknown as Worker).postMessage(done, [pixels.buffer]);
};
