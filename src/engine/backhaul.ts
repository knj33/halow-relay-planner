import { SPEED_OF_LIGHT } from './propagation';
import { cellSizeM, inBounds, sampleElevation } from './terrain/grid';
import type { BodyId, Env, HeightGrid } from './types';

/**
 * A satellite frozen at one instant, described by its sub-satellite point in the local frame
 * (which may lie far outside the planning region) and its altitude. This is an illustrative
 * snapshot for exploring geometry. It is not an ephemeris and does not describe a real constellation.
 */
export interface Satellite {
  id: string;
  name: string;
  /** Sub-satellite point, local east, metres. */
  x: number;
  /** Sub-satellite point, local north, metres. */
  y: number;
  altitudeM: number;
}

export interface BackhaulSettings {
  /** Base-station HaLow antenna height above ground, metres. */
  baseAntennaHeightM: number;
  /** Smallest usable elevation above the local terrain horizon, degrees. */
  minElevationDeg: number;
}

export const DEFAULT_BACKHAUL: BackhaulSettings = { baseAntennaHeightM: 6, minElevationDeg: 10 };

export function defaultSatellites(body: BodyId): Satellite[] {
  if (body === 'earth') {
    return [
      { id: 'leo-1', name: 'LEO-1 (illustrative)', x: 160_000, y: 310_000, altitudeM: 550_000 },
      { id: 'leo-2', name: 'LEO-2 (illustrative)', x: -620_000, y: 180_000, altitudeM: 550_000 },
      { id: 'leo-3', name: 'LEO-3 (illustrative)', x: 420_000, y: -700_000, altitudeM: 550_000 },
      { id: 'leo-4', name: 'LEO-4 (illustrative)', x: -1_900_000, y: -900_000, altitudeM: 550_000 },
    ];
  }
  if (body === 'mars') {
    // Two low relay orbiters and one high, areostationary-like relay. Not real spacecraft positions.
    return [
      { id: 'mro-1', name: 'Mars relay 1 (illustrative)', x: 350_000, y: -280_000, altitudeM: 300_000 },
      { id: 'mro-2', name: 'Mars relay 2 (illustrative)', x: -800_000, y: 450_000, altitudeM: 400_000 },
      { id: 'mro-3', name: 'Mars relay 3 (illustrative)', x: -2_400_000, y: -1_800_000, altitudeM: 17_000_000 },
    ];
  }
  return [
    { id: 'lro-1', name: 'Lunar relay 1 (illustrative)', x: 700_000, y: -450_000, altitudeM: 2_000_000 },
    { id: 'lro-2', name: 'Lunar relay 2 (illustrative)', x: -1_300_000, y: 1_000_000, altitudeM: 4_500_000 },
    { id: 'lro-3', name: 'Lunar relay 3 (illustrative)', x: -2_600_000, y: -2_200_000, altitudeM: 800_000 },
  ];
}

export interface SatLook {
  satId: string;
  name: string;
  slantRangeM: number;
  /** Elevation above the local horizontal, degrees. */
  elevationDeg: number;
  /** Azimuth clockwise from local north, degrees. */
  azimuthDeg: number;
  /** Elevation of the terrain skyline in that azimuth, degrees. */
  horizonDeg: number;
  visible: boolean;
  oneWayDelayMs: number;
  reason: string;
}

export interface StationBackhaul {
  stationId: string;
  /** Closest satellite that clears the terrain mask, or null. */
  chosen: SatLook | null;
  looks: SatLook[];
}

/** Spherical-body geometry from a surface station to a satellite. */
export function satelliteGeometry(
  radiusM: number,
  station: { x: number; y: number; altM: number },
  sat: Satellite,
): { slantRangeM: number; elevationDeg: number; azimuthDeg: number } {
  const dx = sat.x - station.x;
  const dy = sat.y - station.y;
  const theta = Math.hypot(dx, dy) / radiusM;
  const rg = radiusM + station.altM;
  const rs = radiusM + sat.altitudeM;
  const slant = Math.sqrt(rg * rg + rs * rs - 2 * rg * rs * Math.cos(theta));
  const sinEl = (rs * Math.cos(theta) - rg) / slant;
  const az = (Math.atan2(dx, dy) * 180) / Math.PI;
  return {
    slantRangeM: slant,
    elevationDeg: (Math.asin(Math.max(-1, Math.min(1, sinEl))) * 180) / Math.PI,
    azimuthDeg: (az + 360) % 360,
  };
}

/** Elevation angle of the terrain skyline seen from a point, looking along an azimuth. Geometric (no refraction). */
export function terrainHorizonDeg(
  grid: HeightGrid,
  env: Env,
  x: number,
  y: number,
  heightM: number,
  azimuthDeg: number,
): number {
  const z0 = sampleElevation(grid, x, y) + heightM;
  const az = (azimuthDeg * Math.PI) / 180;
  const sx = Math.sin(az);
  const sy = Math.cos(az);
  const step = cellSizeM(grid);
  let maxAngle = -Math.PI / 2;
  for (let d = step; ; d += step) {
    const px = x + sx * d;
    const py = y + sy * d;
    if (!inBounds(grid, px, py)) break;
    const apparent = sampleElevation(grid, px, py) - (d * d) / (2 * env.radiusM);
    const ang = Math.atan2(apparent - z0, d);
    if (ang > maxAngle) maxAngle = ang;
  }
  return Math.max(0, (maxAngle * 180) / Math.PI);
}

/** Look angles to every satellite and the closest one that clears terrain by the minimum elevation. */
export function pickSatellite(
  grid: HeightGrid,
  env: Env,
  station: { id: string; x: number; y: number; heightM: number },
  satellites: Satellite[],
  settings: BackhaulSettings,
): StationBackhaul {
  const altM = sampleElevation(grid, station.x, station.y) + station.heightM;
  const looks: SatLook[] = satellites.map((sat) => {
    const g = satelliteGeometry(env.radiusM, { x: station.x, y: station.y, altM }, sat);
    const horizonDeg = terrainHorizonDeg(grid, env, station.x, station.y, station.heightM, g.azimuthDeg);
    const needed = horizonDeg + settings.minElevationDeg;
    const visible = g.elevationDeg >= needed;
    return {
      satId: sat.id,
      name: sat.name,
      ...g,
      horizonDeg,
      visible,
      oneWayDelayMs: (g.slantRangeM / SPEED_OF_LIGHT) * 1000,
      reason: visible
        ? 'Above the terrain mask.'
        : g.elevationDeg <= 0
          ? 'Below the horizon.'
          : `Elevation ${g.elevationDeg.toFixed(1)}° is under the required ${needed.toFixed(1)}° (terrain skyline ${horizonDeg.toFixed(1)}° + ${settings.minElevationDeg}° minimum).`,
    };
  });
  const visible = looks.filter((l) => l.visible).sort((p, q) => p.slantRangeM - q.slantRangeM);
  return { stationId: station.id, chosen: visible[0] ?? null, looks };
}
