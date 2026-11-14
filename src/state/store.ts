import { create } from 'zustand';
import {
  BODIES,
  CONSERVATIVE_SAFETY,
  DEFAULT_BACKHAUL,
  DEFAULT_PLANNER,
  EXAMPLE_HALOW_PROFILE,
  defaultCostModel,
  defaultSatellites,
  fitArea,
  gridPointsFor,
  gridToGeo,
  maxAreaM,
} from '../engine';
import type {
  BackhaulSettings,
  BodyId,
  CostModel,
  DeploymentState,
  GeoNode,
  HeightGrid,
  NodeKind,
  PlanResult,
  PlannerOptions,
  NoGoZone,
  PlanningArea,
  RadioProfile,
  SafetySettings,
  Satellite,
  TerrainMeta,
  Waypoint,
} from '../engine';
import type { GeoPoint } from '../engine/terrain/geo';
import { localToGeo, wrapLon } from '../engine/terrain/geo';
import type { EngineInfo, EngineStatus } from '../native/engine';
import { engineSupports, loadTerrainFromEngine, probeEngine } from '../native/engine';
import { DEMO_PRESET, DEMO_SITES, DEMO_SPAN, PRESETS } from '../presets';

export type Tool = 'select' | 'setA' | 'setB' | 'relay' | 'base' | 'waypoint' | 'zone' | 'move' | 'fail' | 'delete';
export type Overlay = 'off' | 'mesh' | 'direct';

export interface PlanState {
  status: 'idle' | 'running' | 'ok' | 'no-route' | 'error';
  result?: PlanResult;
  message?: string;
}

export interface Notice {
  kind: 'info' | 'error';
  text: string;
}

export interface FlyTarget {
  lat: number;
  lon: number;
  /** Camera height above the surface, metres. */
  heightM: number;
  seq: number;
}

const ENGINE_ENABLED_KEY = 'halow.engine.enabled';
const ENGINE_PROMPT_KEY = 'halow.engine.promptDismissed';

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* private mode */
  }
}

interface State extends DeploymentState {
  terrain: HeightGrid | null;
  terrainMeta: TerrainMeta | null;
  /** The area the loaded grid belongs to (may lag behind `area` while a new one loads). */
  terrainArea: PlanningArea | null;
  terrainStatus: 'idle' | 'loading' | 'ready' | 'error';
  terrainError: string | null;
  terrainProgress: string | null;
  /** Optional native Relay Engine (localhost). */
  engineStatus: EngineStatus;
  engineInfo: EngineInfo | null;
  engineEnabled: boolean;
  enginePrompt: boolean;
  tool: Tool;
  selectedId: string | null;
  overlay: Overlay;
  globeRelief: number;
  plan: PlanState;
  notice: Notice | null;
  nextId: number;
  fly: FlyTarget | null;
  /** Surface point under the centre of the view, for keyboard placement. */
  viewCentre: GeoPoint | null;
  /** Vertices of the no-go zone being drawn, or null. */
  zoneDraft: GeoPoint[] | null;

  addWaypoint: (lat: number, lon: number) => void;
  removeWaypoint: (id: string) => void;
  /** Move a waypoint earlier (-1) or later (+1) in the visiting order. */
  moveWaypoint: (id: string, dir: -1 | 1) => void;
  addZonePoint: (lat: number, lon: number) => void;
  /** Close the zone being drawn (needs three points). */
  finishZone: () => void;
  cancelZone: () => void;
  removeZone: (id: string) => void;
  setSafety: (patch: Partial<SafetySettings>) => void;

  setBody: (body: BodyId) => void;
  setTool: (tool: Tool) => void;
  select: (id: string | null) => void;
  surfaceClick: (lat: number, lon: number) => void;
  nodeClick: (id: string) => void;
  placeNode: (kind: NodeKind, lat: number, lon: number, origin?: 'manual' | 'auto') => string;
  updateNode: (id: string, patch: Partial<Pick<GeoNode, 'lat' | 'lon' | 'enabled'>>) => void;
  removeNode: (id: string) => void;
  /** Recompute the planning area from the nodes and load terrain when it changed. */
  syncArea: () => Promise<void>;
  /** Fixed-size area centred on a point (turns auto-fit off). */
  setFixedArea: (centre: GeoPoint, sizeM: number) => Promise<void>;
  setAutoFit: (on: boolean) => void;
  /** Resize the area around its centre (or the first node) and switch auto-fit off. */
  setAreaSize: (sizeM: number) => Promise<void>;
  /** Move the camera so the whole planning area is in view. */
  zoomToArea: () => void;
  /** Geographic centre of the view, used when no area exists yet. */
  flyToPreset: (site: GeoPoint) => void;
  loadDemo: () => void;
  loadTerrain: () => Promise<void>;
  applyPlan: (result: PlanResult, area: PlanningArea) => void;
  setPlan: (plan: PlanState) => void;
  setRadio: (patch: Partial<RadioProfile>) => void;
  resetRadio: () => void;
  setPlanner: (patch: Partial<PlannerOptions>) => void;
  setCost: (patch: Partial<CostModel>) => void;
  resetCost: () => void;
  setBackhaul: (patch: Partial<BackhaulSettings>) => void;
  setKFactor: (k: number) => void;
  setOverlay: (o: Overlay) => void;
  setGlobeRelief: (v: number) => void;
  setNotice: (n: Notice | null) => void;
  flyTo: (lat: number, lon: number, heightM: number) => void;
  setViewCentre: (p: GeoPoint | null) => void;
  probeEngine: () => Promise<void>;
  setEngineEnabled: (on: boolean) => void;
  dismissEnginePrompt: () => void;
  resetDeployment: () => void;
  importState: (s: DeploymentState) => Promise<void>;
  /** Load the bundled premade scenario (public/demo): 200 km on Mars with relays already planned. */
  loadPremadeDemo: () => Promise<void>;
}

/** The premade demo manifest written by scripts/demo/build-demo-site.gen.ts. */
export interface PremadeDemo {
  schema: 'halow-relay-planner/premade-demo';
  version: 1;
  site: { name: string; lat: number; lon: number; source: string };
  body: BodyId;
  area: PlanningArea;
  grid: { file: string; cols: number; rows: number; widthM: number; heightM: number; minElevM: number; maxElevM: number; offsetM: number; scaleM: number; format: 'int16le' };
  terrainMeta: TerrainMeta;
  radio: RadioProfile;
  planner: PlannerOptions;
  roles: Record<string, string>;
  nodes: GeoNode[];
  plan: PlanResult;
  summary: { topology: string; hops: number; weakestMarginDb: number | null; disjointPaths: number; relays: number };
}

/** Decode the bundled int16 grid (0.25 m steps above a whole-metre offset). */
export function decodePremadeGrid(m: PremadeDemo, buf: ArrayBuffer): HeightGrid {
  const q = new Int16Array(buf);
  if (q.length !== m.grid.cols * m.grid.rows) throw new Error('The premade demo elevation file is incomplete.');
  const data = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) data[i] = m.grid.offsetM + q[i] * m.grid.scaleM;
  return { cols: m.grid.cols, rows: m.grid.rows, widthM: m.grid.widthM, heightM: m.grid.heightM, data, minElevM: m.grid.minElevM, maxElevM: m.grid.maxElevM };
}

let terrainToken = 0;
let flySeq = 0;

function freshEnvironment(body: BodyId) {
  return {
    body,
    kFactor: BODIES[body].defaultKFactor,
    cost: defaultCostModel(body),
    satellites: defaultSatellites(body) as Satellite[],
    nodes: [] as GeoNode[],
    area: null as PlanningArea | null,
    autoFit: true,
    terrain: null as HeightGrid | null,
    terrainMeta: null as TerrainMeta | null,
    terrainArea: null as PlanningArea | null,
    terrainStatus: 'idle' as State['terrainStatus'],
    terrainError: null as string | null,
    terrainProgress: null as string | null,
    selectedId: null as string | null,
    plan: { status: 'idle' } as PlanState,
    tool: 'setA' as Tool,
    overlay: 'off' as Overlay,
    viewCentre: null as GeoPoint | null,
    waypoints: [] as Waypoint[],
    zones: [] as NoGoZone[],
    zoneDraft: null as GeoPoint[] | null,
  };
}

/** True when the native engine is on, answering, and able to load terrain for the current body. */
export const nativeActive = (s: Pick<State, 'engineEnabled' | 'engineStatus' | 'engineInfo' | 'body'>) =>
  s.engineEnabled && s.engineStatus === 'available' && engineSupports(s.engineInfo, s.body);

/** Camera height for "fly to a place", metres. */
const PRESET_VIEW_M: Record<BodyId, number> = { earth: 40_000, moon: 25_000, mars: 35_000 };

export const sameArea =(a: PlanningArea | null, b: PlanningArea | null) =>
  !!a && !!b && a.sizeM === b.sizeM && Math.abs(a.centre.lat - b.centre.lat) < 1e-9 && Math.abs(a.centre.lon - b.centre.lon) < 1e-9;

const clampLat = (lat: number) => Math.max(-84, Math.min(84, lat));

export const useStore = create<State>((set, get) => ({
  ...freshEnvironment('earth'),
  radio: { ...EXAMPLE_HALOW_PROFILE },
  planner: { ...DEFAULT_PLANNER },
  safety: { ...CONSERVATIVE_SAFETY },
  backhaul: { ...DEFAULT_BACKHAUL },
  globeRelief: 1,
  engineStatus: 'unknown',
  engineInfo: null,
  engineEnabled: readFlag(ENGINE_ENABLED_KEY, true),
  enginePrompt: readFlag(ENGINE_PROMPT_KEY, false) ? false : true,
  notice: null,
  nextId: 1,
  fly: null,

  setBody: (body) => {
    if (body === get().body) return;
    const hadNodes = get().nodes.length > 0;
    terrainToken++;
    set({
      ...freshEnvironment(body),
      notice: hadNodes ? { kind: 'info', text: `Switched to the ${BODIES[body].name}. The previous deployment was cleared because it belonged to a different body.` } : null,
    });
  },

  setTool: (tool) => set({ tool }),
  select: (id) => set({ selectedId: id }),

  surfaceClick: (lat, lon) => {
    const { tool, selectedId, nodes } = get();
    if (tool === 'setA') {
      get().placeNode('A', lat, lon);
      set({ tool: nodes.some((n) => n.kind === 'B') ? 'select' : 'setB' });
    } else if (tool === 'setB') {
      get().placeNode('B', lat, lon);
      set({ tool: 'select' });
    } else if (tool === 'relay') get().placeNode('relay', lat, lon);
    else if (tool === 'base') get().placeNode('base', lat, lon);
    else if (tool === 'waypoint') get().addWaypoint(lat, lon);
    else if (tool === 'zone') get().addZonePoint(lat, lon);
    else if (tool === 'move' && selectedId) get().updateNode(selectedId, { lat, lon });
    else if (tool === 'select') set({ selectedId: null });
  },

  addWaypoint: (lat, lon) => {
    const id = `wp-${get().nextId}`;
    set((s) => ({ waypoints: [...s.waypoints, { id, lat: clampLat(lat), lon: wrapLon(lon) }], nextId: s.nextId + 1 }));
  },
  removeWaypoint: (id) => set((s) => ({ waypoints: s.waypoints.filter((w) => w.id !== id) })),
  moveWaypoint: (id, dir) =>
    set((s) => {
      const i = s.waypoints.findIndex((w) => w.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.waypoints.length) return {};
      const w = [...s.waypoints];
      [w[i], w[j]] = [w[j], w[i]];
      return { waypoints: w };
    }),
  addZonePoint: (lat, lon) => set((s) => ({ zoneDraft: [...(s.zoneDraft ?? []), { lat: clampLat(lat), lon: wrapLon(lon) }] })),
  finishZone: () => {
    const d = get().zoneDraft;
    if (!d || d.length < 3) {
      set({ notice: { kind: 'info', text: 'A no-go zone needs at least three corners. Click the map to add more, or press Esc to cancel.' } });
      return;
    }
    set((s) => ({ zones: [...s.zones, { id: `zone-${s.nextId}`, points: d }], zoneDraft: null, nextId: s.nextId + 1 }));
  },
  cancelZone: () => set({ zoneDraft: null }),
  removeZone: (id) => set((s) => ({ zones: s.zones.filter((z) => z.id !== id) })),
  setSafety: (patch) => set((s) => ({ safety: { ...s.safety, ...patch } })),

  nodeClick: (id) => {
    if (get().tool === 'delete') get().removeNode(id);
    else set({ selectedId: id });
  },

  placeNode: (kind, lat, lon, origin = 'manual') => {
    const p = { lat: clampLat(lat), lon: wrapLon(lon) };
    if (kind === 'A' || kind === 'B') {
      const existing = get().nodes.find((n) => n.kind === kind);
      if (existing) {
        get().updateNode(existing.id, p);
        return existing.id;
      }
      set((s) => ({ nodes: [...s.nodes, { id: kind, kind, ...p, enabled: true, origin: 'manual' }], selectedId: kind, plan: { status: 'idle' } }));
      void get().syncArea();
      return kind;
    }
    const id = `${kind}-${get().nextId}`;
    set((s) => ({ nodes: [...s.nodes, { id, kind, ...p, enabled: true, origin }], nextId: s.nextId + 1, selectedId: origin === 'manual' ? id : s.selectedId, plan: { status: 'idle' } }));
    if (origin === 'manual') void get().syncArea();
    return id;
  },

  updateNode: (id, patch) => {
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (n.id !== id) return n;
        const moved = patch.lat !== undefined || patch.lon !== undefined;
        return {
          ...n,
          enabled: patch.enabled ?? n.enabled,
          lat: patch.lat !== undefined && Number.isFinite(patch.lat) ? clampLat(patch.lat) : n.lat,
          lon: patch.lon !== undefined && Number.isFinite(patch.lon) ? wrapLon(patch.lon) : n.lon,
          origin: moved ? 'manual' : n.origin,
        };
      }),
      plan: { status: 'idle' },
    }));
    if (patch.lat !== undefined || patch.lon !== undefined) void get().syncArea();
  },

  removeNode: (id) => {
    set((s) => ({ nodes: s.nodes.filter((n) => n.id !== id), selectedId: s.selectedId === id ? null : s.selectedId, plan: { status: 'idle' } }));
    void get().syncArea();
  },

  syncArea: async () => {
    const { body, nodes, area, autoFit, terrainArea, terrainStatus } = get();
    if (autoFit) {
      const fit = fitArea(body, nodes, area, nativeActive(get()));
      if (fit && !fit.ok) {
        set({
          notice: {
            kind: 'error',
            text: `The nodes span ${(fit.spanM / 1000).toFixed(0)} km, more than the largest planning area (${fit.maxM / 1000} km). Nodes outside the current area are left out of the analysis; split the deployment into separate plans.`,
          },
        });
        return;
      }
      if (fit && fit.changed) set({ area: fit.area });
    }
    const target = get().area;
    if (!area && target) get().flyTo(target.centre.lat, target.centre.lon, target.sizeM * 1.45);
    if (target && !(sameArea(target, terrainArea) && (terrainStatus === 'ready' || terrainStatus === 'loading'))) await get().loadTerrain();
  },

  setFixedArea: async (centre, sizeM) => {
    set({ autoFit: false, area: { centre: { lat: clampLat(centre.lat), lon: wrapLon(centre.lon) }, sizeM }, plan: { status: 'idle' } });
    await get().loadTerrain();
  },

  setAutoFit: (autoFit) => {
    set({ autoFit });
    if (autoFit) void get().syncArea();
  },

  setAreaSize: async (sizeM) => {
    const { body, area, nodes, viewCentre } = get();
    const centre = area?.centre ?? nodes[0] ?? viewCentre ?? DEMO_SITES[body];
    const clamped = Math.max(1000, Math.min(maxAreaM(body, nativeActive(get())), sizeM));
    await get().setFixedArea({ lat: centre.lat, lon: centre.lon }, clamped);
    get().zoomToArea();
  },

  zoomToArea: () => {
    const a = get().area;
    if (a) get().flyTo(a.centre.lat, a.centre.lon, a.sizeM * 1.45);
  },

  flyToPreset: (site) => get().flyTo(site.lat, site.lon, PRESET_VIEW_M[get().body]),

  loadTerrain: async () => {
    const { body, area } = get();
    if (!area) return;
    const token = ++terrainToken;
    set({ terrainArea: area, terrainStatus: 'loading', terrainError: null, terrainProgress: null });

    // Prefer the native engine when it has been detected and knows this body. Any failure falls back to the browser loader.
    if (nativeActive(get())) {
      try {
        const n = gridPointsFor(body, area.sizeM, true);
        const native = await loadTerrainFromEngine(body, area, n, (t) => token === terrainToken && set({ terrainProgress: t }));
        if (token !== terrainToken) return;
        set({ terrain: native.grid, terrainMeta: native.meta, terrainArea: area, terrainStatus: 'ready', terrainProgress: null });
        return;
      } catch (err) {
        if (token !== terrainToken) return;
        set({
          engineStatus: 'unavailable',
          engineInfo: null,
          notice: {
            kind: 'info',
            text: `Native engine stopped responding (${err instanceof Error ? err.message : String(err)}). Using the browser terrain loader.`,
          },
        });
      }
    }

    try {
      // Loaded lazily: it needs browser image decoding and network access.
      const { loadAreaTerrain } = await import('../terrain/areaTerrain');
      const { grid, meta } = await loadAreaTerrain(body, area, (t) => token === terrainToken && set({ terrainProgress: t }));
      if (token !== terrainToken) return;
      set({ terrain: grid, terrainMeta: meta, terrainArea: area, terrainStatus: 'ready', terrainProgress: null });
    } catch (err) {
      if (token !== terrainToken) return;
      set({ terrain: null, terrainMeta: null, terrainStatus: 'error', terrainError: err instanceof Error ? err.message : String(err), terrainProgress: null });
    }
  },

  applyPlan: (result, area) => {
    const R = BODIES[get().body].radiusM;
    set((s) => {
      const kept = s.nodes.filter((n) => !(n.kind === 'relay' && n.origin === 'auto'));
      let id = kept.reduce((m, n) => Math.max(m, Number(n.id.split('-')[1]) || 0), 0);
      const added = result.relays.map((p) => {
        const g = gridToGeo(area, p.x, p.y, R);
        id += 1;
        return { id: `relay-${id}`, kind: 'relay' as const, lat: g.lat, lon: g.lon, enabled: true, origin: 'auto' as const };
      });
      return { nodes: [...kept, ...added], nextId: Math.max(s.nextId, id + 1), plan: { status: 'idle' } };
    });
    void get().syncArea();
  },
  setPlan: (plan) => set({ plan }),

  loadDemo: () => {
    const body = get().body;
    const R = BODIES[body].radiusM;
    const c = DEMO_SITES[body];
    const span = DEMO_SPAN[body];
    const at = (east: number, north: number) => {
      const p = localToGeo(c, east, north, R);
      return { lat: p.lat, lon: p.lon };
    };
    const nodes: GeoNode[] = [
      { id: 'A', kind: 'A', ...at(-span.east, -span.north), enabled: true, origin: 'manual' },
      { id: 'B', kind: 'B', ...at(span.east, span.north), enabled: true, origin: 'manual' },
      { id: 'base-1', kind: 'base', ...at(500, 400), enabled: true, origin: 'manual' },
    ];
    terrainToken++;
    set({
      nodes,
      nextId: 2,
      selectedId: null,
      plan: { status: 'idle' },
      area: null,
      autoFit: true,
      terrain: null,
      terrainMeta: null,
      terrainArea: null,
      terrainStatus: 'idle',
      terrainError: null,
      notice: { kind: 'info', text: `Demo scenario loaded near ${PRESETS[body][DEMO_PRESET[body]].name}. Press “Plan relays” to suggest relays.` },
    });
    void get().syncArea().then(() => get().zoomToArea());
  },

  setRadio: (patch) => set((s) => ({ radio: { ...s.radio, ...patch } })),
  resetRadio: () => set({ radio: { ...EXAMPLE_HALOW_PROFILE } }),
  setPlanner: (patch) => set((s) => ({ planner: { ...s.planner, ...patch } })),
  setCost: (patch) => set((s) => ({ cost: { ...s.cost, ...patch } })),
  resetCost: () => set((s) => ({ cost: defaultCostModel(s.body) })),
  setBackhaul: (patch) => set((s) => ({ backhaul: { ...s.backhaul, ...patch } })),
  setKFactor: (k) => set((s) => ({ kFactor: BODIES[s.body].kFactorEditable ? k : BODIES[s.body].defaultKFactor })),
  setOverlay: (overlay) => set({ overlay }),
  setGlobeRelief: (globeRelief) => set({ globeRelief }),
  setNotice: (notice) => set({ notice }),
  flyTo: (lat, lon, heightM) => set({ fly: { lat, lon, heightM, seq: ++flySeq } }),
  setViewCentre: (viewCentre) => set({ viewCentre }),

  probeEngine: async () => {
    if (!get().engineEnabled) {
      set({ engineStatus: 'unavailable', engineInfo: null });
      return;
    }
    set({ engineStatus: 'checking' });
    const info = await probeEngine();
    set({ engineStatus: info ? 'available' : 'unavailable', engineInfo: info });
  },

  setEngineEnabled: (on) => {
    writeFlag(ENGINE_ENABLED_KEY, on);
    set({ engineEnabled: on, engineStatus: on ? 'unknown' : 'unavailable', engineInfo: on ? get().engineInfo : null });
    if (on) void get().probeEngine();
  },

  dismissEnginePrompt: () => {
    writeFlag(ENGINE_PROMPT_KEY, true);
    set({ enginePrompt: false });
  },

  resetDeployment: () => {
    terrainToken++;
    set({
      nodes: [],
      waypoints: [],
      zones: [],
      zoneDraft: null,
      selectedId: null,
      plan: { status: 'idle' },
      overlay: 'off',
      notice: null,
      area: null,
      autoFit: true,
      terrain: null,
      terrainMeta: null,
      terrainArea: null,
      terrainStatus: 'idle',
      terrainError: null,
    });
  },

  importState: async (s) => {
    terrainToken++;
    const maxId = s.nodes.reduce((m, n) => Math.max(m, Number(n.id.split('-')[1]) || 0), 0);
    set({
      ...freshEnvironment(s.body),
      kFactor: s.kFactor,
      radio: s.radio,
      planner: s.planner,
      cost: s.cost,
      backhaul: s.backhaul,
      satellites: s.satellites,
      nodes: s.nodes,
      area: s.area,
      autoFit: s.autoFit,
      waypoints: s.waypoints,
      zones: s.zones,
      safety: s.safety,
      nextId: Math.max(maxId, ...s.waypoints.map((w) => Number(w.id.split('-')[1]) || 0), ...s.zones.map((z) => Number(z.id.split('-')[1]) || 0)) + 1,
    });
    const a = get().area ?? (fitArea(s.body, s.nodes, null) as { ok: true; area: PlanningArea } | null)?.area ?? null;
    await get().syncArea();
    if (a) get().flyTo(a.centre.lat, a.centre.lon, Math.max(4000, a.sizeM * 1.45));
  },

  loadPremadeDemo: async () => {
    const token = ++terrainToken;
    set({ ...freshEnvironment('mars'), terrainStatus: 'loading', terrainProgress: 'Opening the bundled 200 km demo', notice: null });
    try {
      const dir = `${import.meta.env.BASE_URL}demo/`;
      const res = await fetch(`${dir}arcadia-200km.json`);
      if (!res.ok) throw new Error(`demo manifest HTTP ${res.status}`);
      const m = (await res.json()) as PremadeDemo;
      const bin = await fetch(dir + m.grid.file);
      if (!bin.ok) throw new Error(`demo elevation HTTP ${bin.status}`);
      const grid = decodePremadeGrid(m, await bin.arrayBuffer());
      if (token !== terrainToken) return;
      const maxId = m.nodes.reduce((mx, n) => Math.max(mx, Number(n.id.split('-')[1]) || 0), 0);
      const { area, summary, roles } = m;
      set({
        radio: m.radio,
        planner: m.planner,
        nodes: m.nodes,
        nextId: maxId + 1,
        area,
        autoFit: false,
        terrain: grid,
        terrainMeta: m.terrainMeta,
        terrainArea: area,
        terrainStatus: 'ready',
        terrainProgress: null,
        plan: { status: 'ok', result: m.plan },
        tool: 'select',
        notice: {
          kind: 'info',
          text: `Demo: ${m.site.name}. ${area.sizeM / 1000} km area with ${summary.relays} relays already planned, from A (${roles.A}) to B (${roles.B}) in ${summary.hops} hops over ${summary.disjointPaths} independent paths, plus three base stations. Elevation is bundled, so nothing downloads.`,
        },
      });
      get().flyTo(area.centre.lat, area.centre.lon, area.sizeM * 1.45);
    } catch (err) {
      if (token !== terrainToken) return;
      set({ terrainStatus: 'error', terrainError: `Premade demo could not be opened: ${err instanceof Error ? err.message : String(err)}` });
    }
  },
}));

/** Display names: A, B, R1.., BS1.. in list order. */
export function nodeLabels(nodes: { id: string; kind: NodeKind }[]): Map<string, string> {
  const out = new Map<string, string>();
  let r = 0;
  let b = 0;
  for (const n of nodes) {
    if (n.kind === 'A' || n.kind === 'B') out.set(n.id, n.kind);
    else if (n.kind === 'relay') out.set(n.id, `R${++r}`);
    else out.set(n.id, `BS${++b}`);
  }
  return out;
}
