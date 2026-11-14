import { BODIES } from '../bodies';
import type { BodyId, HeightGrid, TerrainMeta } from '../types';
import { syntheticEarth, syntheticMoon } from './synthetic';

export { gridFromFunction, sampleElevation, sampleBicubic, cellSizeM, inBounds } from './grid';
export * from './geo';
export * from './real';

/**
 * A terrain source produces a HeightGrid in the local metre frame.
 * To add real data, implement this interface (e.g. fetch a GeoTIFF / SRTM / LOLA tile,
 * reproject to a local tangent plane, resample to a regular grid) and call registerTerrainSource.
 * Nothing else in the engine cares where the grid came from.
 */
export interface TerrainSource {
  meta: TerrainMeta;
  load(): Promise<HeightGrid>;
}

const SYNTHETIC_SEEDS: Record<BodyId, number> = { earth: 20261, moon: 19690, mars: 20210 };

const sources = new Map<string, TerrainSource>();
const defaults: Record<BodyId, string> = { earth: 'synthetic-earth', moon: 'synthetic-moon', mars: 'synthetic-mars' };

export function registerTerrainSource(source: TerrainSource, makeDefault = false): void {
  sources.set(source.meta.id, source);
  if (makeDefault) defaults[source.meta.body] = source.meta.id;
}

registerTerrainSource({
  meta: {
    id: 'synthetic-earth',
    label: 'Synthetic demonstration terrain (Earth-like hills)',
    body: 'earth',
    synthetic: true,
    georeferenced: false,
    seed: SYNTHETIC_SEEDS.earth,
    attribution: 'Procedurally generated in the browser. Not a real location.',
  },
  load: async () => syntheticEarth(BODIES.earth.regionSizeM, SYNTHETIC_SEEDS.earth),
});

registerTerrainSource({
  meta: {
    id: 'synthetic-moon',
    label: 'Synthetic demonstration terrain (cratered lunar-like surface)',
    body: 'moon',
    synthetic: true,
    georeferenced: false,
    seed: SYNTHETIC_SEEDS.moon,
    attribution: 'Procedurally generated in the browser. Not a real location.',
  },
  load: async () => syntheticMoon(BODIES.moon.regionSizeM, SYNTHETIC_SEEDS.moon),
});

registerTerrainSource({
  meta: {
    id: 'synthetic-mars',
    label: 'Synthetic demonstration terrain (cratered Mars-like surface)',
    body: 'mars',
    synthetic: true,
    georeferenced: false,
    seed: SYNTHETIC_SEEDS.mars,
    attribution: 'Procedurally generated in the browser. Not a real location.',
  },
  load: async () => syntheticMoon(BODIES.mars.regionSizeM, SYNTHETIC_SEEDS.mars),
});

export function getTerrainSource(body: BodyId, id?: string): TerrainSource {
  const src = sources.get(id ?? defaults[body]);
  if (!src || src.meta.body !== body) throw new Error(`No terrain source "${id ?? defaults[body]}" for ${body}`);
  return src;
}

export function listTerrainSources(body: BodyId): TerrainMeta[] {
  return [...sources.values()].filter((s) => s.meta.body === body).map((s) => s.meta);
}
