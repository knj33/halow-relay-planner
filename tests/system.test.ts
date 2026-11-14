import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONSERVATIVE_SAFETY,
  BODIES,
  DEFAULT_BACKHAUL,
  DEFAULT_PLANNER,
  analyzeScenario,
  defaultCostModel,
  defaultSatellites,
  exportDeployment,
  fitArea,
  getTerrainSource,
  importDeployment,
  makeEnv,
  pickSatellite,
  relayUnitUsd,
  satelliteGeometry,
  terrainHorizonDeg,
} from '../src/engine';
import { useStore } from '../src/state/store';
import { EARTH, flatGrid, node, radio, ridgeGrid } from './helpers';

// The store loads real elevation through a browser adapter; replace it with a deterministic grid.
vi.mock('../src/terrain/areaTerrain', () => ({
  loadAreaTerrain: async (body: 'earth' | 'moon', area: { sizeM: number }) => ({
    grid: {
      cols: 2,
      rows: 2,
      widthM: area.sizeM,
      heightM: area.sizeM,
      data: new Float32Array([0, 50, 100, 150]),
      minElevM: 0,
      maxElevM: 150,
    },
    meta: {
      id: 'test-terrain',
      label: 'Test terrain',
      body,
      synthetic: true,
      georeferenced: false,
      attribution: 'Test fixture',
    },
  }),
}));

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('synthetic terrain', () => {
  it('is deterministic and labelled synthetic', async () => {
    for (const body of ['earth', 'moon', 'mars'] as const) {
      const src = getTerrainSource(body);
      expect(src.meta.synthetic).toBe(true);
      expect(src.meta.label).toMatch(/Synthetic demonstration terrain/);
      const [g1, g2] = await Promise.all([src.load(), src.load()]);
      expect(g1.widthM).toBe(BODIES[body].regionSizeM);
      expect(Array.from(g1.data.slice(0, 500))).toEqual(Array.from(g2.data.slice(0, 500)));
      expect(g1.maxElevM - g1.minElevM).toBeGreaterThan(100);
    }
  });
});

describe('areas and environments', () => {
  beforeEach(() => {
    useStore.getState().setBody('earth');
    useStore.getState().resetDeployment();
    useStore.setState({ body: 'earth' });
  });

  it('fits the smallest allowed square around the nodes and labels the grid real', async () => {
    const s = useStore.getState();
    s.placeNode('A', 45.8, 6.8);
    expect(useStore.getState().area?.sizeM).toBe(5_000);
    s.placeNode('B', 45.9, 6.9);
    const area = useStore.getState().area!;
    expect(area.sizeM).toBe(15_000);
    await flush();
    expect(useStore.getState().terrainStatus).toBe('ready');
    expect(useStore.getState().terrain?.widthM).toBe(15_000);
  });

  it('keeps the area when nodes still fit and refuses areas beyond the limit', () => {
    const s = useStore.getState();
    s.placeNode('A', 45.8, 6.8);
    s.placeNode('B', 45.82, 6.82);
    expect(useStore.getState().area?.sizeM).toBe(5_000);
    s.placeNode('B', 48, 6.8);
    expect(useStore.getState().notice?.kind).toBe('error');
    expect(useStore.getState().area?.sizeM).toBe(5_000);
  });

  it('grows with a fixed size when auto-fit is off', async () => {
    const s = useStore.getState();
    await s.setFixedArea({ lat: 45.8, lon: 6.8 }, 30_000);
    expect(useStore.getState().area?.sizeM).toBe(30_000);
    expect(useStore.getState().autoFit).toBe(false);
    s.placeNode('A', 45.8, 6.8);
    s.placeNode('B', 45.95, 6.95);
    expect(useStore.getState().area?.sizeM).toBe(30_000);
  });

  it('clears the previous deployment and resets body-specific settings when the body changes', async () => {
    const s = useStore.getState();
    s.loadDemo();
    await flush();
    expect(useStore.getState().nodes).toHaveLength(3);
    s.setKFactor(1.5);
    s.setPlan({ status: 'ok' });

    await useStore.getState().setBody('moon');
    await flush();
    const m = useStore.getState();
    expect(m.body).toBe('moon');
    expect(m.nodes).toEqual([]);
    expect(m.selectedId).toBeNull();
    expect(m.plan.status).toBe('idle');
    expect(m.kFactor).toBe(1);
    expect(m.terrain).toBeNull();
    expect(m.area).toBeNull();
    expect(m.satellites).toEqual(defaultSatellites('moon'));
    expect(m.cost).toEqual(defaultCostModel('moon'));

    m.loadDemo();
    await flush();
    expect(useStore.getState().body).toBe('moon');
    expect(useStore.getState().nodes).toHaveLength(3);
    expect(useStore.getState().terrainMeta?.body).toBe('moon');
  });

  it('does not let the Moon k-factor be changed', async () => {
    await useStore.getState().setBody('moon');
    useStore.getState().setKFactor(1.33);
    expect(useStore.getState().kFactor).toBe(1);
  });

  it('replaces auto relays on re-plan but keeps manual ones', async () => {
    const s = useStore.getState();
    await s.setFixedArea({ lat: 45.8, lon: 6.8 }, 20_000);
    const area = useStore.getState().area!;
    s.placeNode('relay', 45.8, 6.8);
    s.placeNode('A', 45.78, 6.78);
    s.placeNode('B', 45.82, 6.82);
    const plan = {
      status: 'ok' as const,
      relays: [{ x: 2000, y: 3000 }],
      candidatesSampled: 0,
      linksEvaluated: 0,
      feasibleLinks: 0,
      unreachedBases: [],
      redundantPathFound: null,
      notes: [],
    };
    s.applyPlan(plan, area);
    s.applyPlan({ ...plan, relays: [{ x: 7000, y: 8000 }] }, area);
    await flush();
    const relays = useStore.getState().nodes.filter((n) => n.kind === 'relay');
    expect(relays.map((r) => r.origin)).toEqual(['manual', 'auto']);
    expect(useStore.getState().nodes.filter((n) => n.kind === 'relay')).toHaveLength(2);
  });
});

describe('JSON export and import', () => {
  const area = { centre: { lat: 26.13, lon: 3.63 }, sizeM: 15_000 };
  const state = {
    body: 'moon' as const,
    kFactor: 1,
    radio,
    planner: DEFAULT_PLANNER,
    cost: defaultCostModel('moon'),
    backhaul: DEFAULT_BACKHAUL,
    satellites: defaultSatellites('moon'),
    nodes: [
      { id: 'A', kind: 'A' as const, lat: 26.1, lon: 3.6, enabled: true, origin: 'manual' as const },
      { id: 'B', kind: 'B' as const, lat: 26.2, lon: 3.7, enabled: true, origin: 'manual' as const },
      { id: 'relay-1', kind: 'relay' as const, lat: 26.15, lon: 3.65, enabled: false, origin: 'manual' as const },
    ],
    area,
    autoFit: false,
    waypoints: [{ id: 'wp-4', lat: 26.12, lon: 3.62 }],
    zones: [{ id: 'zone-5', points: [{ lat: 26.13, lon: 3.6 }, { lat: 26.14, lon: 3.61 }, { lat: 26.13, lon: 3.62 }] }],
    safety: { ...CONSERVATIVE_SAFETY, maxSlopeDeg: 18, requireCoverage: false },
  };
  const meta = getTerrainSource('moon').meta;

  it('round-trips deployment, environment, radio settings and assumptions', () => {
    const file = JSON.parse(JSON.stringify(exportDeployment(state, meta)));
    expect(file.environment.terrain.synthetic).toBe(true);
    expect(file.environment.bodyRadiusM).toBe(1_737_400);
    expect(file.environment.planningArea.sizeM).toBe(15_000);
    expect(file.modelAssumptions.length).toBeGreaterThan(3);
    const res = importDeployment(file);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.state).toEqual(state);
  });

  it('rejects malformed files with reasons', () => {
    const file = JSON.parse(JSON.stringify(exportDeployment(state, meta)));
    expect(importDeployment('nope').ok).toBe(false);
    expect(importDeployment({ ...file, schema: 'other' }).ok).toBe(false);
    expect(importDeployment({ ...file, radio: { ...file.radio, frequencyMHz: 'fast' } }).ok).toBe(false);
    const outside = importDeployment({ ...file, deployment: { nodes: [{ id: 'A', kind: 'A', lat: 89, lon: 0, enabled: true }] } });
    expect(outside.ok).toBe(false);
    if (!outside.ok) expect(outside.errors[0]).toMatch(/±84/);
    const big = importDeployment({ ...file, environment: { ...file.environment, planningArea: { centre: { lat: 0, lon: 0 }, sizeM: 999_000 } } });
    expect(big.ok).toBe(false);
    expect(importDeployment({ ...file, safety: { ...file.safety, maxSlopeDeg: 80 } }).ok).toBe(false);
    expect(importDeployment({ ...file, deployment: { ...file.deployment, noGoZones: [{ id: 'z', points: [{ lat: 0, lon: 0 }] }] } }).ok).toBe(false);
  });

  it('imports files written before waypoints, zones and safety existed', () => {
    const file = JSON.parse(JSON.stringify(exportDeployment(state, meta)));
    delete file.safety;
    delete file.deployment.waypoints;
    delete file.deployment.noGoZones;
    const res = importDeployment(file);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.waypoints).toEqual([]);
      expect(res.state.zones).toEqual([]);
      expect(res.state.safety).toEqual(CONSERVATIVE_SAFETY);
    }
  });

  it('ignores a refraction factor on a Moon file', () => {
    const file = JSON.parse(JSON.stringify(exportDeployment(state, meta)));
    file.environment.kFactor = 1.33;
    const res = importDeployment(file);
    expect(res.ok && res.state.kFactor).toBe(1);
    expect(res.ok && res.warnings.length).toBe(1);
  });
});

describe('georeferenced areas', () => {
  it('converts local metres to an area-relative grid', async () => {
    const { geoToGrid, gridToGeo, inArea } = await import('../src/engine');
    const area = { centre: { lat: 45, lon: 7 }, sizeM: 20_000 };
    const p = gridToGeo(area, 15_000, 5_000, 6_371_000);
    expect(inArea(area, p, 6_371_000)).toBe(true);
    const back = geoToGrid(area, p, 6_371_000);
    expect(back.x).toBeCloseTo(15_000, 3);
    expect(back.y).toBeCloseTo(5_000, 3);
  });

  it('fits an area around geographic points', () => {
    const fit = fitArea('earth', [{ lat: 45, lon: 7 }, { lat: 45.1, lon: 7.1 }], null);
    expect(fit?.ok).toBe(true);
    if (fit?.ok) expect(fit.area.sizeM).toBeGreaterThan(10_000);
  });
});

describe('satellite backhaul geometry', () => {
  it('a satellite overhead is at 90° and its altitude away', () => {
    const g = satelliteGeometry(6_371_000, { x: 0, y: 0, altM: 0 }, { id: 's', name: 's', x: 0, y: 0, altitudeM: 550_000 });
    expect(g.elevationDeg).toBeCloseTo(90, 5);
    expect(g.slantRangeM).toBeCloseTo(550_000, 0);
  });

  it('a satellite far around the body is below the horizon', () => {
    const g = satelliteGeometry(6_371_000, { x: 0, y: 0, altM: 0 }, { id: 's', name: 's', x: 6_000_000, y: 0, altitudeM: 550_000 });
    expect(g.elevationDeg).toBeLessThan(0);
  });

  it('picks the closest satellite that clears the terrain skyline', () => {
    const grid = ridgeGrid(600);
    const east = { id: 'east', name: 'east', x: 5_000 + 550_000, y: 5000, altitudeM: 100_000 }; // ~10° elevation, due east, closest
    const west = { id: 'west', name: 'west', x: 4000 - 100_000, y: 5000, altitudeM: 550_000 };
    const station = { id: 'bs', x: 4000, y: 5000, heightM: 6 };
    expect(terrainHorizonDeg(grid, EARTH, 4000, 5000, 6, 90)).toBeGreaterThan(20);
    expect(terrainHorizonDeg(grid, EARTH, 4000, 5000, 6, 270)).toBeLessThan(1);
    const res = pickSatellite(grid, EARTH, station, [east, west], DEFAULT_BACKHAUL);
    expect(res.looks.find((l) => l.satId === 'east')!.visible).toBe(false);
    expect(res.chosen?.satId).toBe('west');
    expect(pickSatellite(grid, EARTH, station, [east], DEFAULT_BACKHAUL).chosen).toBeNull();
  });
});

describe('architecture comparison', () => {
  const cost = defaultCostModel('earth');
  const scenario = (nodes: ReturnType<typeof node>[]) => ({
    grid: ridgeGrid(),
    env: makeEnv('earth'),
    radio: { ...radio, antennaHeightM: 10 },
    backhaul: DEFAULT_BACKHAUL,
    cost,
    planner: { ...DEFAULT_PLANNER, gridDivisions: 10 },
    nodes,
    satellites: defaultSatellites('earth'),
  });

  it('shows that the relay connects where no-relay fails, with more coverage', () => {
    const a = analyzeScenario(scenario([node('A', 'A', 1000, 5000), node('B', 'B', 9000, 5000), node('r', 'relay', 5000, 5000)]), 16);
    const by = Object.fromEntries(a.strategies.map((s) => [s.id, s]));
    expect(by.mesh.connects).toBe(true);
    expect(by.direct.connects).toBe(false);
    expect(by.direct.issues.map((i) => i.code)).toContain('no-link');
    expect(by.mesh.coveragePct).toBeGreaterThan(by.direct.coveragePct);
    expect(by.mesh.issues.map((i) => i.code)).toContain('single-chain');
    // 3 HaLow nodes + 8 client radios at the placeholder prices
    expect(by.mesh.totalUsd).toBe(3 * relayUnitUsd(cost) + cost.userSites * cost.clientRadioUsd);
    expect(by.towers.totalUsd).toBeGreaterThan(cost.budgetUsd);
    expect(by.towers.issues.map((i) => i.code)).toContain('over-budget');
    expect(by.satellite.costLines[0].count).toBe(2 + cost.userSites);
  });

  it('applies delivery cost per kilogram', () => {
    const moon = defaultCostModel('moon');
    expect(relayUnitUsd(moon)).toBe(moon.relayHardwareUsd + moon.relayMassKg * moon.deliveryUsdPerKg);
  });

  it('reports "not set" rather than a verdict before endpoints exist', () => {
    const a = analyzeScenario({ ...scenario([]), grid: flatGrid() }, 8);
    expect(a.strategies.every((s) => s.connects === null)).toBe(true);
  });
});

describe('georeferencing helpers', async () => {
  const { localToGeo, geoDistanceM, geoToTile, terrariumToMetres, loadTerrariumRegion } = await import('../src/engine');
  it('maps local metres to lat/lon and back by great-circle distance', () => {
    const c = { lat: 45, lon: 7 };
    const p = localToGeo(c, 3000, 4000, 6_371_000);
    expect(geoDistanceM(c, p, 6_371_000)).toBeCloseTo(5000, 3);
    expect(p.lat).toBeGreaterThan(45);
    expect(p.lon).toBeGreaterThan(7);
    expect(localToGeo({ lat: 0, lon: 179.99 }, 5000, 0, 1_737_400).lon).toBeLessThan(-179);
  });
  it('decodes Terrarium pixels and tile coordinates', () => {
    expect(terrariumToMetres(128, 0, 0)).toBe(0);
    expect(terrariumToMetres(131, 232, 0)).toBe(1000);
    expect(geoToTile({ lat: 0, lon: 0 }, 1)).toEqual({ x: 1, y: 1 });
  });
  it('resamples a region from tiles into the metre grid', async () => {
    // Synthetic tiles encoding elevation = longitude * 1000 m, to check orientation and interpolation.
    const fetchTile = async (z: number, x: number, y: number) => {
      const n = 2 ** z;
      const data = new Uint8Array(256 * 256 * 4);
      for (let j = 0; j < 256; j++)
        for (let i = 0; i < 256; i++) {
          const lon = ((x + (i + 0.5) / 256) / n) * 360 - 180;
          const v = Math.round(lon * 1000) + 32768;
          const k = (j * 256 + i) * 4;
          data[k] = v >> 8;
          data[k + 1] = v & 255;
        }
      void y;
      return { size: 256, data };
    };
    const { grid } = await loadTerrariumRegion({ lat: 0, lon: 10 }, 20_000, 6_371_000, 12, fetchTile);
    const west = grid.data[128 * grid.cols];
    const east = grid.data[128 * grid.cols + grid.cols - 1];
    const span = (20_000 / (2 * Math.PI * 6_371_000)) * 360 * 1000;
    expect(east).toBeGreaterThan(west);
    expect(east - west).toBeCloseTo(span, -1);
    expect(grid.data[128 * grid.cols + 128]).toBeCloseTo(10_000, -1);
  });
});
