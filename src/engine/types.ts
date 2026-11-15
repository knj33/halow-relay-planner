/** Shared engine types. All physical quantities are SI (metres, Hz, dB) unless the name says otherwise. */

export type BodyId = 'earth' | 'moon' | 'mars';

/** Every body, in the order the body switch shows them. */
export const BODY_IDS: readonly BodyId[] = ['earth', 'moon', 'mars'];
/**
 * Bodies offered in the UI. Earth and the Moon are hidden, not removed: their code paths, tests and
 * data stay intact, so adding them back here restores the body switch.
 */
export const VISIBLE_BODIES: readonly BodyId[] = ['mars'];

export interface Body {
  id: BodyId;
  name: string;
  /** Mean radius used for curvature, metres. */
  radiusM: number;
  /** Default effective-radius factor. 4/3 is the usual Earth standard atmosphere value; 1 means no refraction. */
  defaultKFactor: number;
  /** k is locked to 1 on the Moon (no atmosphere) and on Mars (refraction is negligible). */
  kFactorEditable: boolean;
  /** Short explanation of the k-factor shown next to the setting. */
  kFactorNote: string;
  /** Side length of the square planning region, metres. */
  regionSizeM: number;
}

/** Curvature environment handed to the propagation code. */
export interface Env {
  radiusM: number;
  kFactor: number;
}

/**
 * Regular elevation grid in a local east/north frame.
 * x runs east from 0..widthM, y runs north from 0..heightM, row 0 is y = 0.
 */
export interface HeightGrid {
  cols: number;
  rows: number;
  widthM: number;
  heightM: number;
  /** Elevation in metres, row-major, length cols * rows. */
  data: Float32Array;
  minElevM: number;
  maxElevM: number;
}

export interface TerrainMeta {
  id: string;
  label: string;
  body: BodyId;
  synthetic: boolean;
  georeferenced: boolean;
  seed?: number;
  attribution: string;
  /** Centre of the region for georeferenced sources, degrees. */
  site?: { lat: number; lon: number };
  /** Native ground resolution of the source data, metres per pixel. */
  resolutionM?: number;
}

export interface RadioProfile {
  name: string;
  frequencyMHz: number;
  txPowerDbm: number;
  txAntennaGainDbi: number;
  rxAntennaGainDbi: number;
  /** Antenna height above local ground for endpoints and relays, metres. */
  antennaHeightM: number;
  rxSensitivityDbm: number;
  txCableLossDb: number;
  rxCableLossDb: number;
  requiredMarginDb: number;
}

export type NodeKind = 'A' | 'B' | 'relay' | 'base';

export interface SiteNode {
  id: string;
  kind: NodeKind;
  /** Local east coordinate, metres. */
  x: number;
  /** Local north coordinate, metres. */
  y: number;
  enabled: boolean;
  origin: 'manual' | 'auto';
}

/** A node as stored and exported: geographic position on the body surface, degrees. */
export interface GeoNode {
  id: string;
  kind: NodeKind;
  lat: number;
  lon: number;
  enabled: boolean;
  origin: 'manual' | 'auto';
}

export interface Antenna {
  x: number;
  y: number;
  /** Height above local ground, metres. */
  heightM: number;
}

export type LinkStatus = 'good' | 'marginal' | 'fail';

export interface LinkResult {
  status: LinkStatus;
  /** Antenna-to-antenna slant distance, metres. */
  distanceM: number;
  fsplDb: number;
  /** Single knife-edge estimate for the worst intrusion, dB (0 when the Fresnel zone is clear). */
  diffractionLossDb: number;
  rxPowerDbm: number;
  /** rxPower - sensitivity. Compare against requiredMarginDb. */
  marginDb: number;
  losClear: boolean;
  /** Smallest ray-to-terrain clearance along the path, metres (negative = obstructed). */
  minClearanceM: number;
  /** Distance from the first antenna to the worst point, metres. */
  worstAtM: number;
  fresnelClear: boolean;
  /** Smallest clearance / first-Fresnel-radius ratio along the path. */
  worstFresnelFraction: number;
  /** True when the ray would clear the terrain on a flat body, i.e. curvature is what blocks it. */
  blockedByCurvature: boolean;
  reasons: string[];
}

export interface Heights {
  nodeM: number;
  baseM: number;
  clientM: number;
}

/** A stop the crew walks through between A and B, in order. */
export interface Waypoint {
  id: string;
  lat: number;
  lon: number;
}

/** A hand-drawn area the crew must not enter (polygon, at least three points). */
export interface NoGoZone {
  id: string;
  points: { lat: number; lon: number }[];
}
