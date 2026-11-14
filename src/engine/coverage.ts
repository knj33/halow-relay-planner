import type { BackhaulSettings, Satellite } from './backhaul';
import { satelliteGeometry, terrainHorizonDeg } from './backhaul';
import { evaluateLink, maxFreeSpaceRangeM } from './propagation';
import { sampleElevation } from './terrain/grid';
import type { Antenna, Env, HeightGrid, RadioProfile } from './types';

export interface CoverageMap {
  /** Cells per side. Cell (cx, cy) is stored at cy * res + cx, with cy = 0 at the south edge. */
  res: number;
  /** 0 = no usable link, 1 = Fresnel-obstructed link, 2 = clear link. */
  cells: Uint8Array;
  /** Percentage of cells with any usable link. */
  coveredPct: number;
}

/**
 * For each cell centre, can a client radio at clientHeightM close a link to at least one
 * infrastructure antenna? Uses exactly the same link model as the relay links.
 */
export function coverageMap(
  grid: HeightGrid,
  env: Env,
  radio: RadioProfile,
  infrastructure: Antenna[],
  clientHeightM: number,
  res: number,
): CoverageMap {
  const cells = new Uint8Array(res * res);
  const maxRange = maxFreeSpaceRangeM(radio);
  let covered = 0;
  for (let cy = 0; cy < res; cy++) {
    const y = ((cy + 0.5) / res) * grid.heightM;
    for (let cx = 0; cx < res; cx++) {
      const x = ((cx + 0.5) / res) * grid.widthM;
      let best = 0;
      for (const n of infrastructure) {
        if (Math.hypot(n.x - x, n.y - y) > maxRange) continue;
        const r = evaluateLink(grid, env, radio, { x, y, heightM: clientHeightM }, n);
        if (r.status === 'good') {
          best = 2;
          break;
        }
        if (r.status === 'marginal') best = 1;
      }
      cells[cy * res + cx] = best;
      if (best > 0) covered++;
    }
  }
  return { res, cells, coveredPct: (covered / (res * res)) * 100 };
}

/** Percentage of cells from which at least one satellite clears the terrain mask. */
export function skyCoverage(
  grid: HeightGrid,
  env: Env,
  satellites: Satellite[],
  settings: BackhaulSettings,
  terminalHeightM: number,
  res: number,
): CoverageMap {
  const cells = new Uint8Array(res * res);
  let covered = 0;
  for (let cy = 0; cy < res; cy++) {
    const y = ((cy + 0.5) / res) * grid.heightM;
    for (let cx = 0; cx < res; cx++) {
      const x = ((cx + 0.5) / res) * grid.widthM;
      const altM = sampleElevation(grid, x, y) + terminalHeightM;
      const ok = satellites.some((sat) => {
        const g = satelliteGeometry(env.radiusM, { x, y, altM }, sat);
        if (g.elevationDeg < settings.minElevationDeg) return false;
        return g.elevationDeg >= terrainHorizonDeg(grid, env, x, y, terminalHeightM, g.azimuthDeg) + settings.minElevationDeg;
      });
      if (ok) {
        cells[cy * res + cx] = 2;
        covered++;
      }
    }
  }
  return { res, cells, coveredPct: (covered / (res * res)) * 100 };
}
