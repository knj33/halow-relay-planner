import type { HeightGrid } from '../types';
import { gridFromFunction } from './grid';
import { fbm, mulberry32 } from './noise';

const GRID_N = 257;

/** Rolling hills with a ridge system. Purely procedural; it does not represent any real place. */
export function syntheticEarth(sizeM: number, seed: number): HeightGrid {
  return gridFromFunction(GRID_N, GRID_N, sizeM, sizeM, (x, y) => {
    const n = fbm(x / 7000, y / 7000, seed, 5);
    const r = 1 - Math.abs(fbm(x / 5000 + 31.7, y / 5000 - 12.3, seed + 17, 4));
    return 350 + 420 * n + 260 * r * r;
  });
}

interface Crater {
  x: number;
  y: number;
  r: number;
}

/** Gentle undulation plus bowl craters with raised rims. Purely procedural; not a real lunar site. */
export function syntheticMoon(sizeM: number, seed: number): HeightGrid {
  const rnd = mulberry32(seed);
  const craters: Crater[] = [];
  for (let i = 0; i < 16; i++) {
    const u = rnd();
    craters.push({ x: rnd() * sizeM, y: rnd() * sizeM, r: 250 + 1350 * u * u });
  }
  return gridFromFunction(GRID_N, GRID_N, sizeM, sizeM, (x, y) => {
    let e = 70 * fbm(x / 4000, y / 4000, seed, 4) + 18 * fbm(x / 900, y / 900, seed + 7, 3);
    for (const c of craters) {
      const d = Math.hypot(x - c.x, y - c.y) / c.r;
      if (d >= 2) continue;
      const depth = 0.22 * c.r;
      const rim = 0.05 * c.r;
      if (d < 1) e += -depth * (1 - d * d) + rim * d * d;
      else e += rim * Math.pow(2 - d, 3);
    }
    return e;
  });
}
