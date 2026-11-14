import { BODIES, gridPointsFor } from '../engine';
import type { BodyId, HeightGrid, PlanningArea, TerrainMeta } from '../engine';
import { formatGeo } from '../engine/terrain/geo';
import type { EquirectRaster, RgbaTile, TileFetcher } from '../engine/terrain/real';
import { loadEquirectRegion, loadTerrariumRegion } from '../engine/terrain/real';
import { openRangeTiff } from './rangeTiff';
import { MOSAIC_TERRAIN, areaLabel, mosaicMeta } from './sources';
import type { MosaicBody, MosaicRaster } from './sources';

/** Browser adapters that fetch real elevation for a planning area. The resampling maths is in the engine. */

const EARTH_TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

const tileCache = new Map<string, Promise<RgbaTile>>();

function pngTiles(template: string): TileFetcher {
  return (z, x, y) => {
    const url = template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
    let p = tileCache.get(url);
    if (!p) {
      p = (async () => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Elevation tile ${z}/${x}/${y} failed (HTTP ${res.status}).`);
        const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
        const canvas = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(bmp, 0, 0);
        return { size: bmp.width, data: ctx.getImageData(0, 0, bmp.width, bmp.height).data };
      })();
      p.catch(() => tileCache.delete(url));
      tileCache.set(url, p);
    }
    return p;
  };
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000} s.`)), ms))]);
}

/** Opened mosaics, keyed by URL. The header is read once; row blocks stay cached across areas. */
const rasters = new Map<string, Promise<EquirectRaster>>();
function openRaster(url: string): Promise<EquirectRaster> {
  let p = rasters.get(url);
  if (!p) {
    p = openRangeTiff(url, -180);
    p.catch(() => rasters.delete(url));
    rasters.set(url, p);
  }
  return p;
}

export interface AreaTerrain {
  grid: HeightGrid;
  meta: TerrainMeta;
}

export async function loadAreaTerrain(body: BodyId, area: PlanningArea, onProgress?: (text: string) => void): Promise<AreaTerrain> {
  const R = BODIES[body].radiusM;
  const { centre: site, sizeM } = area;
  const n = gridPointsFor(body, sizeM);
  const spacing = sizeM / (n - 1);
  if (body === 'earth') {
    const r = await withTimeout(
      loadTerrariumRegion(site, sizeM, R, 14, pngTiles(EARTH_TERRARIUM), n, (d, t) => onProgress?.(`Elevation tiles ${d} / ${t}`)),
      90_000,
      'Elevation download',
    );
    return {
      grid: r.grid,
      meta: {
        id: 'earth-terrarium',
        label: areaLabel(area),
        body,
        synthetic: false,
        georeferenced: true,
        site,
        resolutionM: Math.max(r.metresPerPixel, spacing),
        attribution: `Mapzen Terrain Tiles on AWS (SRTM, GMTED, ETOPO1 and other open sources), zoom ${r.zoom} (~${r.metresPerPixel.toFixed(0)} m/px here), resampled to a ${n} × ${n} grid at ${spacing.toFixed(0)} m spacing. Bare-earth-like surface: no buildings or vegetation.`,
      },
    };
  }
  return loadMosaicTerrain(body, area, n, onProgress);
}

/** The Moon and Mars: range-read the best available global mosaic, then fall back to the bundled pyramid. */
async function loadMosaicTerrain(body: MosaicBody, area: PlanningArea, n: number, onProgress?: (text: string) => void): Promise<AreaTerrain> {
  const R = BODIES[body].radiusM;
  const src = MOSAIC_TERRAIN[body];
  const failures: string[] = [];
  for (const [i, raster] of src.rasters.entries()) {
    try {
      onProgress?.(i === 0 ? 'Reading elevation mosaic header…' : `Primary elevation unavailable; trying ${raster.credit.split(',')[0]}…`);
      const r = await withTimeout(
        openRaster(raster.url).then((ras) => loadEquirectRegion(area.centre, area.sizeM, R, ras, n, (d, t) => onProgress?.(`${src.blocksLabel} ${d} / ${t}`))),
        240_000,
        'Elevation download',
      );
      return { grid: r.grid, meta: mosaicMeta(body, raster, area, n, false, fallbackNote(src.rasters, i, failures)) };
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }

  // Fall back to the bundled low-resolution pyramid rather than inventing terrain.
  onProgress?.('Detailed elevation unavailable; using the bundled coarse map…');
  const r = await loadTerrariumRegion(area.centre, area.sizeM, R, src.coarse.maxZoom, pngTiles(src.coarse.url), n);
  return {
    grid: r.grid,
    meta: {
      id: src.coarse.id,
      label: `Coarse elevation (~${(r.metresPerPixel / 1000).toFixed(1)} km/px) at ${formatGeo(area.centre)}`,
      body,
      synthetic: false,
      georeferenced: true,
      site: area.centre,
      resolutionM: r.metresPerPixel,
      attribution: `${src.coarse.credit}. The detailed dataset was unavailable (${failures.join('; ')}). At ~${(r.metresPerPixel / 1000).toFixed(1)} km per pixel this is far too coarse for link planning: treat results as orientation only.`,
    },
  };
}

function fallbackNote(all: MosaicRaster[], used: number, failures: string[]): string {
  if (used === 0) return '';
  return ` Used as a fallback: ${all[0].credit.split(',')[0]} was unavailable (${failures.join('; ')}).`;
}
