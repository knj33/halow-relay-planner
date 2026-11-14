import { EXAMPLE_HALOW_PROFILE, gridFromFunction, makeEnv } from '../src/engine';
import type { Heights, HeightGrid, RadioProfile, SiteNode } from '../src/engine';

export const EARTH = makeEnv('earth');
export const MOON = makeEnv('moon');
export const radio: RadioProfile = { ...EXAMPLE_HALOW_PROFILE };
export const heights: Heights = { nodeM: 10, baseM: 10, clientM: 1.5 };

export const flatGrid = (sizeM = 10_000, elev = 0): HeightGrid => gridFromFunction(201, 201, sizeM, sizeM, () => elev);

/** A north-south ridge across the middle of a 10 km square, 200 m high. */
export const ridgeGrid = (peakM = 200): HeightGrid =>
  gridFromFunction(201, 201, 10_000, 10_000, (x) => peakM * Math.exp(-(((x - 5000) / 400) ** 2)));

export const node = (id: string, kind: SiteNode['kind'], x: number, y: number, enabled = true): SiteNode => ({ id, kind, x, y, enabled, origin: 'manual' });
