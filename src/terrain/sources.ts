import type { BodyId, PlanningArea, TerrainMeta } from '../engine';
import { formatGeo } from '../engine/terrain/geo';

/**
 * Elevation sources for the bodies that use a global simple-cylindrical mosaic read with HTTP range
 * requests (the Moon and Mars). Shared by the browser loader and the native-engine client so both
 * describe a grid the same way. Earth uses Terrarium tiles and is handled separately.
 */

export type MosaicBody = Exclude<BodyId, 'earth'>;

export function isMosaicBody(body: BodyId): body is MosaicBody {
  return body !== 'earth';
}

export interface MosaicRaster {
  /** TerrainMeta id; also the X-Engine-Source the native helper reports. */
  id: string;
  /** Uncompressed, single-band, signed 16-bit (Big)TIFF, one row per strip, west edge at -180°, top at +90°. */
  url: string;
  /** North-south ground size of one source pixel, metres. */
  resM: number;
  credit: string;
  /** Extra caveat appended to the attribution. */
  caveat?: string;
}

export interface MosaicTerrain {
  /** Tried in order; later entries are fallbacks. */
  rasters: MosaicRaster[];
  /** Bundled low-resolution Terrarium pyramid used when every raster fails. */
  coarse: { id: string; url: string; maxZoom: number; credit: string };
  /** Progress wording, e.g. "Lunar elevation blocks". */
  blocksLabel: string;
}

const S3 = 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic';

export const MOSAIC_TERRAIN: Record<MosaicBody, MosaicTerrain> = {
  moon: {
    rasters: [
      {
        id: 'moon-lola-118m',
        // USGS Astrogeology LRO LOLA global DEM, 256 px/deg, signed 16-bit half-metres, public domain.
        url: `${S3}/Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif`,
        resM: 118.45,
        credit: 'LRO LOLA global DEM, 256 px/deg, USGS Astrogeology / NASA GSFC',
      },
    ],
    coarse: {
      id: 'moon-lola-coarse',
      url: `${import.meta.env.BASE_URL}moon-terrain/{z}/{x}/{y}.png`,
      maxZoom: 4,
      credit: 'LRO LOLA 16 px/deg (NASA SVS), bundled',
    },
    blocksLabel: 'Lunar elevation blocks',
  },
  mars: {
    rasters: [
      {
        id: 'mars-hrsc-mola-200m',
        // USGS Astrogeology HRSC + MOLA blended global DEM v2, 296 px/deg, signed 16-bit metres, public domain.
        url: `${S3}/Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif`,
        resM: 200,
        credit: 'Mars HRSC + MOLA blended global DEM v2, USGS Astrogeology (ESA/DLR/FU Berlin Mars Express HRSC, NASA GSFC MGS MOLA)',
        caveat: 'Outside HRSC stereo coverage the blend is MOLA, effectively ~460 m.',
      },
      {
        id: 'mars-mola-463m',
        // USGS Astrogeology MGS MOLA global DEM, 128 px/deg, signed 16-bit metres, public domain.
        url: `${S3}/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif`,
        resM: 463.09,
        credit: 'MGS MOLA global DEM, 128 px/deg, USGS Astrogeology / NASA GSFC',
      },
    ],
    coarse: {
      id: 'mars-mola-coarse',
      url: `${import.meta.env.BASE_URL}mars-terrain/{z}/{x}/{y}.png`,
      maxZoom: 4,
      credit: 'MGS MOLA MEGDR 16 px/deg (NASA PDS Geosciences Node), bundled',
    },
    blocksLabel: 'Mars elevation blocks',
  },
};

export function areaLabel(area: PlanningArea): string {
  return `Real elevation · ${(area.sizeM / 1000).toFixed(0)} km area at ${formatGeo(area.centre)}`;
}

/** TerrainMeta for a grid resampled from one of the mosaic rasters. */
export function mosaicMeta(body: MosaicBody, raster: MosaicRaster, area: PlanningArea, n: number, native = false, fallbackNote = ''): TerrainMeta {
  const spacing = area.sizeM / (n - 1);
  const ew = raster.resM * Math.cos((area.centre.lat * Math.PI) / 180);
  const subsampled = spacing > 1.5 * raster.resM ? ' (rows subsampled for this large area)' : '';
  return {
    id: raster.id,
    label: areaLabel(area),
    body,
    synthetic: false,
    georeferenced: true,
    site: area.centre,
    resolutionM: Math.max(raster.resM, spacing),
    attribution:
      `${raster.credit} (${raster.resM.toFixed(0)} m north-south, ${ew.toFixed(0)} m east-west here), resampled${native ? ' natively' : ''} ` +
      `to a ${n} × ${n} grid at ${spacing.toFixed(0)} m spacing${subsampled}. Features smaller than ~${Math.round(raster.resM)} m are not resolved.` +
      (raster.caveat ? ` ${raster.caveat}` : '') +
      fallbackNote,
  };
}
