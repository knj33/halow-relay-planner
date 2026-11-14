import { modelAssumptions } from './assumptions';
import type { BackhaulSettings, Satellite } from './backhaul';
import { BODIES, isBodyId } from './bodies';
import type { CostModel } from './cost';
import { COST_FIELDS, isCostValid } from './cost';
import type { PlannerOptions } from './planner';
import { RADIO_FIELDS, validateRadio } from './radio';
import type { PlanningArea } from './area';
import { NATIVE_AREA_LIMITS } from './area';
import type { BodyId, GeoNode, NoGoZone, RadioProfile, TerrainMeta, Waypoint } from './types';
import type { SafetySettings } from './traverse';
import { CONSERVATIVE_SAFETY, SAFETY_FIELDS } from './traverse';

export const SCHEMA = 'halow-relay-planner/deployment';
export const SCHEMA_VERSION = 2;
/** Largest planning area accepted on import (the bundled 200 km demo). */
export const PREMADE_MAX_AREA_M = 200_000;

export interface DeploymentState {
  body: BodyId;
  kFactor: number;
  radio: RadioProfile;
  planner: PlannerOptions;
  cost: CostModel;
  backhaul: BackhaulSettings;
  satellites: Satellite[];
  nodes: GeoNode[];
  /** Square planning area that the elevation grid covers; null before any node is placed. */
  area: PlanningArea | null;
  /** Grow the area automatically to hold every node. */
  autoFit: boolean;
  /** Crew stops between A and B, in order. */
  waypoints: Waypoint[];
  /** Areas the crew must not enter. */
  zones: NoGoZone[];
  /** Rules for the crew's walking route. */
  safety: SafetySettings;
}

export interface DeploymentFile {
  schema: typeof SCHEMA;
  version: number;
  exportedAt: string;
  environment: {
    body: BodyId;
    bodyRadiusM: number;
    kFactor: number;
    units: string;
    planningArea: PlanningArea | null;
    autoFit: boolean;
    terrain: TerrainMeta | null;
    satellites: Satellite[];
  };
  radio: RadioProfile;
  planner: PlannerOptions;
  backhaul: BackhaulSettings;
  cost: CostModel;
  safety: SafetySettings;
  deployment: { nodes: GeoNode[]; waypoints: Waypoint[]; noGoZones: NoGoZone[] };
  modelAssumptions: ReturnType<typeof modelAssumptions>;
}

export function exportDeployment(state: DeploymentState, terrain: TerrainMeta | null, exportedAt = new Date()): DeploymentFile {
  return {
    schema: SCHEMA,
    version: SCHEMA_VERSION,
    exportedAt: exportedAt.toISOString(),
    environment: {
      body: state.body,
      bodyRadiusM: BODIES[state.body].radiusM,
      kFactor: state.kFactor,
      units: 'node positions in degrees latitude/longitude; distances, heights and area size in metres',
      planningArea: state.area,
      autoFit: state.autoFit,
      terrain,
      satellites: state.satellites,
    },
    radio: state.radio,
    planner: state.planner,
    backhaul: state.backhaul,
    cost: state.cost,
    safety: state.safety,
    deployment: { nodes: state.nodes, waypoints: state.waypoints, noGoZones: state.zones },
    modelAssumptions: modelAssumptions(state.body, terrain),
  };
}

export type ImportResult = { ok: true; state: DeploymentState; warnings: string[] } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validate untrusted JSON before it touches application state. */
export function importDeployment(raw: unknown): ImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ['File is not a JSON object.'] };
  if (raw.schema !== SCHEMA) return { ok: false, errors: [`Not a relay-planner deployment file (schema "${String(raw.schema)}").`] };
  if (raw.version !== SCHEMA_VERSION) return { ok: false, errors: [`Unsupported file version ${String(raw.version)}.`] };

  const env = raw.environment;
  if (!isObj(env) || !isBodyId(env.body)) return { ok: false, errors: ['environment.body must be "earth", "moon" or "mars".'] };
  const body = env.body;

  let kFactor = BODIES[body].defaultKFactor;
  if (BODIES[body].kFactorEditable) {
    if (isNum(env.kFactor) && env.kFactor >= 0.5 && env.kFactor <= 10) kFactor = env.kFactor;
    else errors.push('environment.kFactor must be between 0.5 and 10.');
  } else if (env.kFactor !== 1) {
    warnings.push(`Ignored a non-unity k-factor: no atmospheric refraction is assumed on ${body === 'moon' ? 'the Moon' : BODIES[body].name}.`);
  }
  let area: PlanningArea | null = null;
  const pa = env.planningArea;
  if (pa != null) {
    const steps = NATIVE_AREA_LIMITS[body].steps;
    if (
      isObj(pa) &&
      isObj(pa.centre) &&
      isNum(pa.centre.lat) &&
      isNum(pa.centre.lon) &&
      Math.abs(pa.centre.lat) <= 84 &&
      Math.abs(pa.centre.lon) <= 180 &&
      isNum(pa.sizeM) &&
      // The premade demo's 200 km area is allowed exactly, so its exports round-trip.
      ((pa.sizeM >= steps[0] && pa.sizeM <= steps[steps.length - 1]) || pa.sizeM === PREMADE_MAX_AREA_M)
    ) {
      area = { centre: { lat: pa.centre.lat, lon: pa.centre.lon }, sizeM: pa.sizeM };
    } else errors.push(`environment.planningArea must have a centre within ±84° latitude and a size of ${steps[0] / 1000}–${steps[steps.length - 1] / 1000} km.`);
  }
  const autoFit = env.autoFit !== false;

  const radio = raw.radio;
  if (!isObj(radio)) errors.push('radio section is missing.');
  else {
    const r = radio as unknown as RadioProfile;
    const bad = validateRadio(r);
    for (const f of RADIO_FIELDS) if (bad[f.key]) errors.push(`radio.${f.key}: ${bad[f.key]}`);
    if (typeof radio.name !== 'string') errors.push('radio.name must be text.');
  }

  const planner = raw.planner;
  if (
    !isObj(planner) ||
    !isNum(planner.gridDivisions) ||
    !(planner.gridDivisions === 0 || (planner.gridDivisions >= 4 && planner.gridDivisions <= 32)) ||
    typeof planner.requireFresnel !== 'boolean' ||
    typeof planner.redundancy !== 'boolean'
  ) {
    errors.push('planner section is missing or invalid.');
  }

  const backhaul = raw.backhaul;
  if (
    !isObj(backhaul) ||
    !isNum(backhaul.baseAntennaHeightM) ||
    backhaul.baseAntennaHeightM <= 0 ||
    backhaul.baseAntennaHeightM > 200 ||
    !isNum(backhaul.minElevationDeg) ||
    backhaul.minElevationDeg < 0 ||
    backhaul.minElevationDeg > 80
  ) {
    errors.push('backhaul section is missing or invalid.');
  }

  const cost = raw.cost;
  if (!isObj(cost) || !COST_FIELDS.every((f) => isNum(cost[f.key])) || !isCostValid(cost as unknown as CostModel)) {
    errors.push('cost section is missing or has out-of-range values.');
  }

  const sats: Satellite[] = [];
  if (!Array.isArray(env.satellites)) errors.push('environment.satellites must be a list.');
  else {
    env.satellites.forEach((s, i) => {
      if (isObj(s) && typeof s.id === 'string' && typeof s.name === 'string' && isNum(s.x) && isNum(s.y) && isNum(s.altitudeM) && s.altitudeM > 0) {
        sats.push({ id: s.id, name: s.name, x: s.x, y: s.y, altitudeM: s.altitudeM });
      } else errors.push(`environment.satellites[${i}] is invalid.`);
    });
  }

  const nodes: GeoNode[] = [];
  const dep = raw.deployment;
  if (!isObj(dep) || !Array.isArray(dep.nodes)) errors.push('deployment.nodes must be a list.');
  else {
    const ids = new Set<string>();
    dep.nodes.forEach((n, i) => {
      const where = `deployment.nodes[${i}]`;
      if (!isObj(n) || typeof n.id !== 'string' || !isNum(n.lat) || !isNum(n.lon)) return void errors.push(`${where} needs an id and numeric lat/lon.`);
      if (n.kind !== 'A' && n.kind !== 'B' && n.kind !== 'relay' && n.kind !== 'base') return void errors.push(`${where}.kind is invalid.`);
      if (Math.abs(n.lat) > 84 || Math.abs(n.lon) > 180) return void errors.push(`${where} is outside ±84° latitude / ±180° longitude.`);
      if (ids.has(n.id)) return void errors.push(`${where} repeats id "${n.id}".`);
      ids.add(n.id);
      nodes.push({ id: n.id, kind: n.kind, lat: n.lat, lon: n.lon, enabled: n.enabled !== false, origin: n.origin === 'auto' ? 'auto' : 'manual' });
    });
    for (const k of ['A', 'B'] as const) {
      if (nodes.filter((n) => n.kind === k).length > 1) errors.push(`More than one endpoint ${k}.`);
    }
  }

  // Crew route additions are optional: files written before they existed import with none.
  const geoOk = (p: unknown): p is { lat: number; lon: number } => isObj(p) && isNum(p.lat) && isNum(p.lon) && Math.abs(p.lat) <= 84 && Math.abs(p.lon) <= 180;
  const waypoints: Waypoint[] = [];
  const zones: NoGoZone[] = [];
  if (isObj(dep)) {
    if (dep.waypoints !== undefined) {
      if (!Array.isArray(dep.waypoints)) errors.push('deployment.waypoints must be a list.');
      else
        dep.waypoints.forEach((w, i) => {
          const wid = isObj(w) ? w.id : undefined;
          if (typeof wid === 'string' && geoOk(w)) waypoints.push({ id: wid, lat: w.lat, lon: w.lon });
          else errors.push(`deployment.waypoints[${i}] needs an id and lat/lon within ±84° / ±180°.`);
        });
    }
    if (dep.noGoZones !== undefined) {
      if (!Array.isArray(dep.noGoZones)) errors.push('deployment.noGoZones must be a list.');
      else
        dep.noGoZones.forEach((z, i) => {
          if (isObj(z) && typeof z.id === 'string' && Array.isArray(z.points) && z.points.length >= 3 && z.points.length <= 500 && z.points.every(geoOk)) {
            zones.push({ id: z.id, points: (z.points as { lat: number; lon: number }[]).map((p) => ({ lat: p.lat, lon: p.lon })) });
          } else errors.push(`deployment.noGoZones[${i}] needs an id and 3–500 points within ±84° / ±180°.`);
        });
    }
  }
  let safety: SafetySettings = { ...CONSERVATIVE_SAFETY };
  const sf = raw.safety;
  if (sf !== undefined) {
    if (isObj(sf) && SAFETY_FIELDS.every((f) => isNum(sf[f.key]) && (sf[f.key] as number) >= f.min && (sf[f.key] as number) <= f.max) && typeof sf.requireCoverage === 'boolean') {
      safety = { ...(Object.fromEntries(SAFETY_FIELDS.map((f) => [f.key, sf[f.key]])) as unknown as SafetySettings), requireCoverage: sf.requireCoverage };
    } else errors.push('safety section has missing or out-of-range values.');
  }

  if (errors.length) return { ok: false, errors };
  const p = planner as Record<string, unknown>;
  const b = backhaul as Record<string, unknown>;
  return {
    ok: true,
    warnings,
    state: {
      body,
      kFactor,
      radio: Object.fromEntries([['name', (radio as Record<string, unknown>).name], ...RADIO_FIELDS.map((f) => [f.key, (radio as Record<string, unknown>)[f.key]])]) as unknown as RadioProfile,
      planner: { gridDivisions: Math.round(p.gridDivisions as number), requireFresnel: p.requireFresnel as boolean, redundancy: p.redundancy as boolean },
      backhaul: { baseAntennaHeightM: b.baseAntennaHeightM as number, minElevationDeg: b.minElevationDeg as number },
      cost: Object.fromEntries(COST_FIELDS.map((f) => [f.key, (cost as Record<string, unknown>)[f.key]])) as unknown as CostModel,
      satellites: sats,
      nodes,
      area,
      autoFit,
      waypoints,
      zones,
      safety,
    },
  };
}
