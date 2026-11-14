import type { HeightGrid, SurveyLayers } from '../engine';
import type { TileDone, TileInit, TileJob } from '../worker/tiles.worker';
import { NO_GO_SLOPE_DEG, SHADE_Z, smooth } from './draw';

/**
 * Detail cache for the survey map: the whole planning area pre-rendered as a tile pyramid in
 * background workers and kept in memory, so zooming only copies finished pixels and never waits.
 *
 * Level l covers the area with 2^l × 2^l tiles of TILE px. The top level is MAX_SIDE px across
 * (8192 px: about 270 MB of tiles, plus about 90 MB for the levels below). Detail beyond the
 * elevation source's resolution is interpolation: smooth shading and sharp lines, not new data.
 *
 * Pixels live in ordinary memory. Only tiles being drawn are uploaded into a small pool of tile
 * canvases (least recently used out): holding the whole pyramid as GPU-backed bitmaps starves the GPU.
 */
export const TILE = 512;
export const MAX_SIDE = 8192;
/** Tile canvases kept ready for drawing (about 1 MB of GPU memory each). */
const GPU_TILES = 96;

type Listener = () => void;

export class SurveyTileCache {
  readonly maxLevel = Math.round(Math.log2(MAX_SIDE / TILE));
  readonly total: number;
  done = 0;
  bytes = 0;
  private readonly tiles = new Map<string, Uint8ClampedArray<ArrayBuffer>>();
  /** Insertion order = recency: the first entry is the least recently drawn. */
  private readonly ready = new Map<string, HTMLCanvasElement>();
  private readonly perLevel: number[];
  private readonly workers: Worker[] = [];
  private readonly queue: TileJob[] = [];
  private readonly listeners = new Set<Listener>();
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    readonly grid: HeightGrid,
    readonly layers: SurveyLayers,
    readonly dpr: number,
  ) {
    let id = 0;
    for (let l = 0; l <= this.maxLevel; l++) {
      const n = 2 ** l;
      for (let ty = 0; ty < n; ty++) for (let tx = 0; tx < n; tx++) this.queue.push({ type: 'tile', id: id++, level: l, tx, ty });
    }
    this.total = this.queue.length;
    this.perLevel = new Array(this.maxLevel + 1).fill(0);

    const channels = layers.channelLines.map((line) => {
      const pts = smooth(line.points, 3);
      const flat = new Float32Array(pts.length * 2);
      pts.forEach((p, k) => {
        flat[2 * k] = p.x;
        flat[2 * k + 1] = p.y;
      });
      const orders = new Uint8Array(Math.max(0, pts.length - 1));
      for (let j = 0; j < orders.length; j++) orders[j] = line.orders[Math.min(line.orders.length - 1, Math.floor((j * line.orders.length) / pts.length))];
      return { pts: flat, orders };
    });
    const init: TileInit = { type: 'init', grid, channels, contourIntervalM: layers.contourIntervalM, steepDeg: NO_GO_SLOPE_DEG, shadeZ: SHADE_Z, dpr, tileSize: TILE };

    const count = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
    for (let w = 0; w < count; w++) {
      const worker = new Worker(new URL('../worker/tiles.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (ev: MessageEvent<TileDone>) => this.receive(worker, ev.data);
      worker.onerror = () => this.next(worker);
      worker.postMessage(init);
      this.workers.push(worker);
      this.next(worker);
      this.next(worker);
    }
  }

  private next(worker: Worker) {
    if (this.disposed) return;
    const job = this.queue.shift();
    if (job) worker.postMessage(job);
  }

  private receive(worker: Worker, t: TileDone) {
    if (this.disposed) return;
    this.tiles.set(`${t.level}/${t.tx}/${t.ty}`, t.pixels);
    this.perLevel[t.level]++;
    this.done++;
    this.bytes += TILE * TILE * 4;
    this.next(worker);
    if (this.done === this.total) for (const w of this.workers) w.terminate();
    if (!this.notifyTimer) {
      this.notifyTimer = setTimeout(() => {
        this.notifyTimer = null;
        for (const l of this.listeners) l();
      }, this.done === this.total ? 0 : 60);
    }
  }

  has(level: number, tx: number, ty: number): boolean {
    return this.tiles.has(`${level}/${tx}/${ty}`);
  }

  /** A drawable canvas for a cached tile, uploading it into the pool if needed. */
  private drawable(level: number, tx: number, ty: number): HTMLCanvasElement | undefined {
    const key = `${level}/${tx}/${ty}`;
    const hit = this.ready.get(key);
    if (hit) {
      this.ready.delete(key);
      this.ready.set(key, hit);
      return hit;
    }
    const px = this.tiles.get(key);
    if (!px) return undefined;
    let c: HTMLCanvasElement;
    if (this.ready.size >= GPU_TILES) {
      const [oldKey, old] = this.ready.entries().next().value as [string, HTMLCanvasElement];
      this.ready.delete(oldKey);
      c = old;
    } else {
      c = document.createElement('canvas');
      c.width = TILE;
      c.height = TILE;
    }
    c.getContext('2d')!.putImageData(new ImageData(px, TILE, TILE), 0, 0);
    this.ready.set(key, c);
    return c;
  }

  /** True once every tile of the level has been rendered. */
  levelComplete(level: number): boolean {
    return this.perLevel[level] === 4 ** level;
  }

  /** Highest level with every tile rendered, or -1. */
  completeLevel(): number {
    let best = -1;
    for (let l = 0; l <= this.maxLevel; l++) if (this.levelComplete(l)) best = l;
    return best;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Draw the visible part of the cache. View: west edge and north edge in grid metres, S = canvas px per metre. */
  draw(ctx: CanvasRenderingContext2D, x0: number, yTop: number, S: number, vw: number, vh: number): void {
    const W = this.grid.widthM;
    const H = this.grid.heightM;
    const want = Math.min(this.maxLevel, Math.max(0, Math.ceil(Math.log2((S * W) / TILE))));
    ctx.setTransform(S, 0, 0, S, -x0 * S, -(H - yTop) * S);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const pad = 0.6 / S; // hide hairline seams between tiles
    for (let l = 0; l <= want; l++) {
      const n = 2 ** l;
      const tw = W / n;
      const th = H / n;
      const nTop = H - yTop;
      const x1 = Math.max(0, Math.floor(x0 / tw));
      const x2 = Math.min(n - 1, Math.floor((x0 + vw) / tw));
      const y1 = Math.max(0, Math.floor(nTop / th));
      const y2 = Math.min(n - 1, Math.floor((nTop + vh) / th));
      for (let ty = y1; ty <= y2; ty++) {
        for (let tx = x1; tx <= x2; tx++) {
          const c = this.drawable(l, tx, ty);
          if (c) ctx.drawImage(c, tx * tw, ty * th, tw + pad, th + pad);
        }
      }
    }
  }

  /** The whole area at one level as a single canvas (for the 3D texture). */
  compose(level: number): HTMLCanvasElement {
    const n = 2 ** level;
    const c = document.createElement('canvas');
    c.width = n * TILE;
    c.height = n * TILE;
    const ctx = c.getContext('2d')!;
    for (let ty = 0; ty < n; ty++) for (let tx = 0; tx < n; tx++) {
      const px = this.tiles.get(`${level}/${tx}/${ty}`);
      if (px) ctx.putImageData(new ImageData(px, TILE, TILE), tx * TILE, ty * TILE);
    }
    return c;
  }

  dispose(): void {
    this.disposed = true;
    if (this.notifyTimer) clearTimeout(this.notifyTimer);
    for (const w of this.workers) w.terminate();
    this.tiles.clear();
    this.ready.clear();
    this.listeners.clear();
  }
}

let current: SurveyTileCache | null = null;

/** One cache at a time, shared by the 2D survey and the 3D view; a new grid replaces it. */
export function tileCacheFor(grid: HeightGrid, layers: SurveyLayers): SurveyTileCache {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (current && current.grid === grid && current.layers === layers && current.dpr === dpr) return current;
  current?.dispose();
  current = new SurveyTileCache(grid, layers, dpr);
  return current;
}
