import type { HeightGrid } from '../types';
import type { GeoPoint } from './geo';
import { geoToTile, localToGeo, terrariumToMetres, wrapLon } from './geo';

/** Decoded RGBA tile. Fetching and image decoding are injected so this module stays testable. */
export interface RgbaTile {
  size: number;
  data: Uint8ClampedArray | Uint8Array;
}
export type TileFetcher = (z: number, x: number, y: number) => Promise<RgbaTile>;
export type Progress = (done: number, total: number) => void;

function finishGrid(data: Float32Array, n: number, sizeM: number): HeightGrid {
  let min = Infinity;
  let max = -Infinity;
  for (const v of data) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { cols: n, rows: n, widthM: sizeM, heightM: sizeM, data, minElevM: min, maxElevM: max };
}

/** Latitude/longitude of every node of an n x n grid covering a square centred on a site. */
function gridGeo(centre: GeoPoint, sizeM: number, radiusM: number, n: number): GeoPoint[] {
  const out: GeoPoint[] = new Array(n * n);
  for (let r = 0; r < n; r++) {
    const north = (r / (n - 1) - 0.5) * sizeM;
    for (let c = 0; c < n; c++) out[r * n + c] = localToGeo(centre, (c / (n - 1) - 0.5) * sizeM, north, radiusM);
  }
  return out;
}

/** Zoom level whose ground pixel size at this latitude is at or just finer than the target. */
export function zoomForResolution(latDeg: number, targetMPerPx: number, radiusM: number, maxZoom: number): number {
  const z0 = (2 * Math.PI * radiusM * Math.cos((latDeg * Math.PI) / 180)) / 256;
  return Math.max(0, Math.min(maxZoom, Math.ceil(Math.log2(z0 / targetMPerPx))));
}

export const MAX_TILES = 64;

/**
 * Build a regional height grid from Terrarium-encoded Web Mercator tiles (Mapzen/AWS Terrain
 * Tiles on Earth, or the bundled LOLA pyramid on the Moon). Bilinear resampling into the local
 * metre frame.
 */
export async function loadTerrariumRegion(
  centre: GeoPoint,
  sizeM: number,
  radiusM: number,
  maxZoom: number,
  fetchTile: TileFetcher,
  n = 257,
  onProgress?: Progress,
): Promise<{ grid: HeightGrid; zoom: number; metresPerPixel: number }> {
  if (Math.abs(centre.lat) > 84) throw new Error('Web Mercator elevation tiles do not cover latitudes beyond about 84°.');
  const geo = gridGeo(centre, sizeM, radiusM, n);

  // Pick the finest zoom that does not exceed the tile budget for this area.
  let z = zoomForResolution(centre.lat, sizeM / (n - 1), radiusM, maxZoom);
  let plan: ReturnType<typeof planTiles>;
  for (;;) {
    plan = planTiles(geo, centre, z);
    if (plan.needed.size <= MAX_TILES || z === 0) break;
    z--;
  }
  const { tx, ty, needed } = plan;
  const tilesN = 2 ** z;

  const tiles = new Map<string, RgbaTile>();
  let done = 0;
  await Promise.all(
    [...needed.entries()].map(async ([key, [kx, ky]]) => {
      tiles.set(key, await fetchTile(z, ((kx % tilesN) + tilesN) % tilesN, ky));
      onProgress?.(++done, needed.size);
    }),
  );

  const px = (gx: number, gy: number): number => {
    const kx = Math.floor(gx / 256);
    const ky = Math.max(0, Math.min(tilesN - 1, Math.floor(gy / 256)));
    const t = tiles.get(`${kx}/${ky}`)!;
    const s = t.size / 256;
    const ix = Math.min(t.size - 1, Math.floor((gx - kx * 256) * s));
    const iy = Math.min(t.size - 1, Math.max(0, Math.floor((gy - ky * 256) * s)));
    const k = (iy * t.size + ix) * 4;
    return terrariumToMetres(t.data[k], t.data[k + 1], t.data[k + 2]);
  };

  const data = new Float32Array(geo.length);
  for (let i = 0; i < geo.length; i++) {
    const fx = tx[i] * 256 - 0.5;
    const fy = ty[i] * 256 - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const ax = fx - x0;
    const ay = fy - y0;
    data[i] = (px(x0, y0) * (1 - ax) + px(x0 + 1, y0) * ax) * (1 - ay) + (px(x0, y0 + 1) * (1 - ax) + px(x0 + 1, y0 + 1) * ax) * ay;
  }
  const metresPerPixel = ((2 * Math.PI * radiusM) / (256 * tilesN)) * Math.cos((centre.lat * Math.PI) / 180);
  return { grid: finishGrid(data, n, sizeM), zoom: z, metresPerPixel };
}

function planTiles(geo: GeoPoint[], centre: GeoPoint, z: number) {
  const n = 2 ** z;
  const centreTx = geoToTile(centre, z).x;
  // Continuous tile coordinates, unwrapped around the centre so areas can straddle the antimeridian.
  const tx = new Float64Array(geo.length);
  const ty = new Float64Array(geo.length);
  const needed = new Map<string, [number, number]>();
  geo.forEach((p, i) => {
    const t = geoToTile(p, z);
    let x = t.x;
    if (x - centreTx > n / 2) x -= n;
    else if (centreTx - x > n / 2) x += n;
    tx[i] = x;
    ty[i] = t.y;
    // Pixel centres sit at +0.5, so bilinear lookup may touch the neighbouring tile.
    for (const ox of [-0.5 / 256, 0.5 / 256]) {
      for (const oy of [-0.5 / 256, 0.5 / 256]) {
        const kx = Math.floor(x + ox);
        const ky = Math.max(0, Math.min(n - 1, Math.floor(t.y + oy)));
        needed.set(`${kx}/${ky}`, [kx, ky]);
      }
    }
  });
  return { tx, ty, needed };
}

/** A global equirectangular raster that can be read row by row (e.g. a remote GeoTIFF). */
export interface EquirectRaster {
  width: number;
  height: number;
  /** Longitude of the left edge, degrees. Latitude is assumed to run +90 (top) to -90. */
  westDeg: number;
  /** Metres per stored unit. */
  scale: number;
  /** Read columns x0..x1-1 of each listed row. */
  readRows(rows: number[], x0: number, x1: number, onProgress?: Progress): Promise<Map<number, ArrayLike<number>>>;
}

/**
 * Build a regional height grid from a global equirectangular raster. When the grid is coarser
 * than the source, only the nearest source row to each grid row is read (bilinear in longitude,
 * nearest in latitude); otherwise full bilinear interpolation is used.
 */
export async function loadEquirectRegion(
  centre: GeoPoint,
  sizeM: number,
  radiusM: number,
  raster: EquirectRaster,
  n = 257,
  onProgress?: Progress,
): Promise<{ grid: HeightGrid; rowsRead: number }> {
  const { width: W, height: H } = raster;
  const geo = gridGeo(centre, sizeM, radiusM, n);
  const centreFx = ((wrapLon(centre.lon - raster.westDeg - 180) + 180) / 360) * W;
  const fx = new Float64Array(geo.length);
  const fy = new Float64Array(geo.length);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  geo.forEach((p, i) => {
    let x = ((wrapLon(p.lon - raster.westDeg - 180) + 180) / 360) * W;
    if (x - centreFx > W / 2) x -= W;
    else if (centreFx - x > W / 2) x += W;
    fx[i] = x - 0.5;
    fy[i] = Math.max(0, Math.min(H - 1, ((90 - p.lat) / 180) * H - 0.5));
    minX = Math.min(minX, fx[i]);
    maxX = Math.max(maxX, fx[i]);
    minY = Math.min(minY, fy[i]);
    maxY = Math.max(maxY, fy[i]);
  });
  const x0 = Math.floor(minX);
  const x1 = Math.floor(maxX) + 2;
  if (x0 < 0 || x1 > W) throw new Error('Area crosses the edge of the elevation mosaic; move it a little away from the ±180° meridian.');
  if (x1 - x0 > 20_000) throw new Error('Area is too close to a pole for this cylindrical elevation mosaic.');

  const decimate = (maxY - minY) / (n - 1) > 1.5;
  const rowsNeeded = new Set<number>();
  for (let i = 0; i < geo.length; i++) {
    if (decimate) rowsNeeded.add(Math.round(fy[i]));
    else {
      const ya = Math.floor(fy[i]);
      rowsNeeded.add(ya);
      rowsNeeded.add(Math.min(H - 1, ya + 1));
    }
  }
  const rows = await raster.readRows([...rowsNeeded].sort((a, b) => a - b), x0, x1, onProgress);
  const at = (x: number, y: number) => rows.get(y)![x - x0] * raster.scale;

  const data = new Float32Array(geo.length);
  for (let i = 0; i < geo.length; i++) {
    const xa = Math.floor(fx[i]);
    const ax = fx[i] - xa;
    if (decimate) {
      const y = Math.round(fy[i]);
      data[i] = at(xa, y) * (1 - ax) + at(xa + 1, y) * ax;
    } else {
      const ya = Math.floor(fy[i]);
      const yb = Math.min(H - 1, ya + 1);
      const ay = fy[i] - ya;
      data[i] = (at(xa, ya) * (1 - ax) + at(xa + 1, ya) * ax) * (1 - ay) + (at(xa, yb) * (1 - ax) + at(xa + 1, yb) * ax) * ay;
    }
  }
  return { grid: finishGrid(data, n, sizeM), rowsRead: rowsNeeded.size };
}
