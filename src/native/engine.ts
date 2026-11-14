import type { BodyId, HeightGrid, PlanningArea, TerrainMeta } from '../engine';
import { MOSAIC_TERRAIN, areaLabel, isMosaicBody, mosaicMeta } from '../terrain/sources';

/**
 * Client for the optional native Relay Engine (native/relay-engine.c).
 *
 * The web app is fully functional without it. When the engine is running on
 * 127.0.0.1 it downloads and resamples terrain in parallel with native code and
 * returns the same height grid the browser loader produces.
 */

export const ENGINE_BASE = 'http://127.0.0.1:8765';
const PROBE_TIMEOUT_MS = 1200;

export interface EngineInfo {
  ok: boolean;
  name: string;
  version: string;
  arch: string;
  avx2: boolean;
  threads: number;
  pid: number;
  /** Bodies the helper can load. Helpers older than 0.3.0 do not report this and only know Earth and the Moon. */
  bodies: BodyId[];
}

const LEGACY_BODIES: BodyId[] = ['earth', 'moon'];

/** True when the detected helper can stream terrain for this body. */
export function engineSupports(info: EngineInfo | null, body: BodyId): boolean {
  return !!info && info.bodies.includes(body);
}

export type EngineStatus = 'unknown' | 'checking' | 'available' | 'unavailable';

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

export async function probeEngine(): Promise<EngineInfo | null> {
  const { signal, cancel } = withTimeout(PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${ENGINE_BASE}/health`, { cache: 'no-store', signal });
    if (!res.ok) return null;
    const info = (await res.json()) as Partial<EngineInfo>;
    if (!info?.ok) return null;
    return {
      ok: true,
      name: info.name ?? 'relay-engine',
      version: info.version ?? 'unknown',
      arch: info.arch ?? 'unknown',
      avx2: !!info.avx2,
      threads: Number(info.threads) || 1,
      pid: Number(info.pid) || 0,
      bodies: Array.isArray(info.bodies) ? (info.bodies as unknown[]).filter((b): b is BodyId => b === 'earth' || b === 'moon' || b === 'mars') : LEGACY_BODIES,
    };
  } catch {
    return null;
  } finally {
    cancel();
  }
}

/** Parse the HRG1 binary response. Exported for tests. */
export function parseGridResponse(buf: ArrayBuffer): HeightGrid {
  if (buf.byteLength < 32) throw new Error('Relay Engine returned a truncated grid.');
  const magic = new TextDecoder().decode(new Uint8Array(buf, 0, 4));
  const view = new DataView(buf);
  const version = view.getUint32(4, true);
  if (magic !== 'HRG1' || version !== 1) throw new Error('Relay Engine returned an unknown grid format.');
  const cols = view.getUint32(8, true);
  const rows = view.getUint32(12, true);
  const widthM = view.getFloat32(16, true);
  const heightM = view.getFloat32(20, true);
  const minElevM = view.getFloat32(24, true);
  const maxElevM = view.getFloat32(28, true);
  const expected = 32 + cols * rows * 4;
  if (cols < 2 || rows < 2 || cols > 2048 || rows > 2048 || buf.byteLength < expected) {
    throw new Error('Relay Engine returned an invalid grid size.');
  }
  const data = new Float32Array(buf, 32, cols * rows);
  if (![widthM, heightM, minElevM, maxElevM].every(Number.isFinite) || widthM <= 0 || heightM <= 0 || minElevM > maxElevM || !data.every(Number.isFinite)) {
    throw new Error('Relay Engine returned invalid elevation values.');
  }
  return { cols, rows, widthM, heightM, minElevM, maxElevM, data };
}

function metaFor(body: BodyId, area: PlanningArea, n: number, source: string, zoom: number, mpp: number): TerrainMeta {
  if (isMosaicBody(body)) {
    const rasters = MOSAIC_TERRAIN[body].rasters;
    const raster = rasters.find((r) => r.id === source) ?? rasters[0];
    const note = raster.id === source ? '' : ` (source reported as ${source})`;
    return mosaicMeta(body, raster, area, n, true, note);
  }
  const spacing = area.sizeM / (n - 1);
  return {
    id: 'earth-terrarium',
    label: areaLabel(area),
    body,
    synthetic: false,
    georeferenced: true,
    site: area.centre,
    resolutionM: Math.max(mpp, spacing),
    attribution: `Mapzen Terrain Tiles on AWS (SRTM, GMTED, ETOPO1 and other open sources), zoom ${zoom} (~${mpp.toFixed(0)} m/px here), resampled natively to a ${n} × ${n} grid at ${spacing.toFixed(0)} m spacing. Bare-earth-like surface: no buildings or vegetation.`,
  };
}

export interface EngineTerrain {
  grid: HeightGrid;
  meta: TerrainMeta;
  elapsedMs: number;
  source: string;
}

export async function loadTerrainFromEngine(
  body: BodyId,
  area: PlanningArea,
  n: number,
  onProgress?: (text: string) => void,
): Promise<EngineTerrain> {
  onProgress?.(body === 'earth' ? 'Native engine: streaming terrain tiles…' : 'Native engine: reading elevation mosaic rows…');
  const { signal, cancel } = withTimeout(180_000);
  try {
    const res = await fetch(`${ENGINE_BASE}/terrain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, lat: area.centre.lat, lon: area.centre.lon, sizeM: area.sizeM, n }),
      signal,
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const j = (await res.json()) as { error?: string };
        if (j.error) detail += `: ${j.error}`;
      } catch {
        /* ignore */
      }
      throw new Error(detail);
    }
    const grid = parseGridResponse(await res.arrayBuffer());
    if (grid.cols !== n || grid.rows !== n || Math.abs(grid.widthM - area.sizeM) > 1 || Math.abs(grid.heightM - area.sizeM) > 1) {
      throw new Error('Relay Engine returned a different planning area or grid size. Update the engine.');
    }
    const zoom = Number(res.headers.get('X-Engine-Zoom') || 0);
    const mpp = Number(res.headers.get('X-Engine-Mpp') || 0);
    const elapsedMs = Number(res.headers.get('X-Engine-Ms') || 0);
    const source = res.headers.get('X-Engine-Source') || (isMosaicBody(body) ? MOSAIC_TERRAIN[body].rasters[0].id : 'earth-terrarium');
    return {
      grid,
      meta: metaFor(body, area, n, source, zoom, mpp),
      elapsedMs,
      source,
    };
  } finally {
    cancel();
  }
}

/** The optional browser extension marks the document; this is a hint, not a requirement. */
export function hasEngineExtension(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.halowEngineExtension === '1';
}
