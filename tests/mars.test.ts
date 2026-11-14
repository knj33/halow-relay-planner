import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONSERVATIVE_SAFETY,
  BODIES,
  BODY_IDS,
  DEFAULT_BACKHAUL,
  DEFAULT_PLANNER,
  defaultCostModel,
  defaultSatellites,
  evaluateLink,
  exportDeployment,
  getTerrainSource,
  importDeployment,
  isBodyId,
  isCostValid,
  makeEnv,
  modelAssumptions,
  pickSatellite,
  relayUnitUsd,
} from '../src/engine';
import { gridPointsFor, maxAreaM } from '../src/engine/area';
import { engineSupports, loadTerrainFromEngine, probeEngine } from '../src/native/engine';
import { DEMO_SITES, PRESETS } from '../src/presets';
import { nativeActive, useStore } from '../src/state/store';
import { MOSAIC_TERRAIN } from '../src/terrain/sources';
import { flatGrid, MOON, radio } from './helpers';

// Same deterministic stand-in for the browser elevation loader as system.test.ts.
vi.mock('../src/terrain/areaTerrain', () => ({
  loadAreaTerrain: async (body: 'earth' | 'moon' | 'mars', area: { sizeM: number }) => ({
    grid: { cols: 2, rows: 2, widthM: area.sizeM, heightM: area.sizeM, data: new Float32Array([0, 50, 100, 150]), minElevM: 0, maxElevM: 150 },
    meta: { id: 'test-terrain', label: 'Test terrain', body, synthetic: true, georeferenced: false, attribution: 'Test fixture' },
  }),
}));

const flush = () => new Promise((r) => setTimeout(r, 0));
const MARS = makeEnv('mars');

describe('Mars as a body', () => {
  it('is a selectable body with its own radius and no refraction', () => {
    expect(BODY_IDS).toEqual(['earth', 'moon', 'mars']);
    expect(isBodyId('mars')).toBe(true);
    expect(isBodyId('venus')).toBe(false);
    expect(BODIES.mars.radiusM).toBe(3_389_500);
    expect(makeEnv('mars', 4 / 3)).toEqual({ radiusM: 3_389_500, kFactor: 1 });
    expect(BODIES.mars.kFactorEditable).toBe(false);
  });

  it('has a radio horizon between the Moon and Earth for the same masts', () => {
    // Two 2 m masts on flat ground: the horizon distance scales with the square root of the radius.
    const grid = flatGrid(40_000);
    const link = (env: typeof MARS, d: number) =>
      evaluateLink(grid, env, { ...radio, txPowerDbm: 40, requiredMarginDb: 0 }, { x: 1000, y: 20_000, heightM: 2 }, { x: 1000 + d, y: 20_000, heightM: 2 });
    // 2 × sqrt(2 R h): Moon ≈ 5.3 km, Mars ≈ 7.4 km, Earth ≈ 10.1 km (k = 1).
    expect(link(MOON, 6500).losClear).toBe(false);
    expect(link(MARS, 6500).losClear).toBe(true);
    expect(link(MARS, 8000).losClear).toBe(false);
    expect(link(MARS, 8000).blockedByCurvature).toBe(true);
  });

  it('uses the Moon area ladder with a 200 m target spacing, larger with the native engine', () => {
    expect(maxAreaM('mars')).toBe(60_000);
    expect(maxAreaM('mars', true)).toBe(120_000);
    expect(gridPointsFor('mars', 20_000)).toBe(101);
    expect(gridPointsFor('mars', 60_000)).toBe(257);
    expect(gridPointsFor('mars', 120_000, true)).toBe(601);
  });

  it('has a deterministic synthetic fallback labelled as synthetic', async () => {
    const src = getTerrainSource('mars');
    expect(src.meta.synthetic).toBe(true);
    const [a, b] = await Promise.all([src.load(), src.load()]);
    expect(a.widthM).toBe(BODIES.mars.regionSizeM);
    expect(Array.from(a.data.slice(0, 300))).toEqual(Array.from(b.data.slice(0, 300)));
  });
});

describe('Mars defaults', () => {
  it('ships valid placeholder costs dominated by delivery mass', () => {
    const c = defaultCostModel('mars');
    expect(isCostValid(c)).toBe(true);
    expect(c.deliveryUsdPerKg).toBeGreaterThan(defaultCostModel('moon').deliveryUsdPerKg);
    expect(relayUnitUsd(c)).toBe(c.relayHardwareUsd + c.relayMassKg * c.deliveryUsdPerKg);
  });

  it('has an illustrative orbiter snapshot with at least one satellite above the mask on open ground', () => {
    const sats = defaultSatellites('mars');
    expect(sats.length).toBeGreaterThanOrEqual(2);
    expect(sats.every((s) => s.name.includes('illustrative'))).toBe(true);
    const res = pickSatellite(flatGrid(), MARS, { id: 'bs', x: 5000, y: 5000, heightM: 6 }, sats, DEFAULT_BACKHAUL);
    expect(res.chosen).not.toBeNull();
    expect(res.chosen!.oneWayDelayMs).toBeGreaterThan(0);
  });

  it('has presets and a demo site on the Martian surface', () => {
    expect(PRESETS.mars.length).toBeGreaterThanOrEqual(4);
    expect(PRESETS.mars.every((p) => Math.abs(p.lat) <= 84 && Math.abs(p.lon) <= 180)).toBe(true);
    expect(DEMO_SITES.mars).toEqual({ lat: PRESETS.mars[0].lat, lon: PRESETS.mars[0].lon });
  });

  it('states Mars-specific assumptions', () => {
    const text = modelAssumptions('mars').flatMap((g) => g.items).join(' ');
    expect(text).toMatch(/HRSC \+ MOLA/);
    expect(text).toMatch(/3389\.5 km/);
    expect(text).toMatch(/dust/i);
    expect(text).not.toMatch(/Lunar elevation/);
  });

  it('reads Mars elevation from the USGS mosaics, best first, with a bundled fallback', () => {
    const src = MOSAIC_TERRAIN.mars;
    expect(src.rasters.map((r) => r.id)).toEqual(['mars-hrsc-mola-200m', 'mars-mola-463m']);
    expect(src.rasters.every((r) => r.url.startsWith('https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/'))).toBe(true);
    expect(src.coarse.url).toMatch(/mars-terrain\/\{z\}\/\{x\}\/\{y\}\.png$/);
  });
});

describe('Mars deployment files', () => {
  const state = {
    body: 'mars' as const,
    kFactor: 1,
    radio,
    planner: DEFAULT_PLANNER,
    cost: defaultCostModel('mars'),
    backhaul: DEFAULT_BACKHAUL,
    satellites: defaultSatellites('mars'),
    nodes: [
      { id: 'A', kind: 'A' as const, lat: 18.38, lon: 77.15, enabled: true, origin: 'manual' as const },
      { id: 'B', kind: 'B' as const, lat: 18.42, lon: 77.25, enabled: true, origin: 'manual' as const },
    ],
    area: { centre: { lat: 18.4, lon: 77.2 }, sizeM: 20_000 },
    autoFit: true,
    waypoints: [],
    zones: [],
    safety: CONSERVATIVE_SAFETY,
  };
  const meta = getTerrainSource('mars').meta;

  it('round-trips through JSON', () => {
    const file = JSON.parse(JSON.stringify(exportDeployment(state, meta)));
    expect(file.environment.body).toBe('mars');
    expect(file.environment.bodyRadiusM).toBe(3_389_500);
    const res = importDeployment(file);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.state).toEqual(state);
  });

  it('ignores a refraction factor and says so', () => {
    const file = JSON.parse(JSON.stringify(exportDeployment(state, meta)));
    file.environment.kFactor = 1.33;
    const res = importDeployment(file);
    expect(res.ok && res.state.kFactor).toBe(1);
    expect(res.ok && res.warnings[0]).toMatch(/Mars/);
  });

  it('accepts native-size Mars areas and rejects oversized ones', () => {
    const file = JSON.parse(JSON.stringify(exportDeployment(state, meta)));
    const ok = importDeployment({ ...file, environment: { ...file.environment, planningArea: { centre: { lat: 0, lon: 0 }, sizeM: 120_000 } } });
    expect(ok.ok).toBe(true);
    const big = importDeployment({ ...file, environment: { ...file.environment, planningArea: { centre: { lat: 0, lon: 0 }, sizeM: 150_000 } } });
    expect(big.ok).toBe(false);
  });
});

describe('switching the app to Mars', () => {
  beforeEach(() => {
    useStore.getState().setBody('earth');
    useStore.getState().resetDeployment();
  });

  it('resets body-specific settings and loads a Mars demo', async () => {
    useStore.getState().loadDemo();
    await flush();
    useStore.getState().setBody('mars');
    await flush();
    const s = useStore.getState();
    expect(s.body).toBe('mars');
    expect(s.nodes).toEqual([]);
    expect(s.kFactor).toBe(1);
    expect(s.cost).toEqual(defaultCostModel('mars'));
    expect(s.satellites).toEqual(defaultSatellites('mars'));

    s.loadDemo();
    await flush();
    const d = useStore.getState();
    expect(d.nodes.map((n) => n.kind)).toEqual(['A', 'B', 'base']);
    expect(d.area?.sizeM).toBeGreaterThan(0);
    expect(d.terrainStatus).toBe('ready');
    expect(d.terrainMeta?.body).toBe('mars');
    expect(d.notice?.text).toMatch(new RegExp(PRESETS.mars[0].name.replace(/[()]/g, '.')));
    d.setKFactor(1.5);
    expect(useStore.getState().kFactor).toBe(1);
  });
});

describe('native engine and Mars', () => {
  afterEach(() => vi.unstubAllGlobals());

  const info = (extra: object) =>
    vi.fn(async () => new Response(JSON.stringify({ ok: true, name: 'relay-engine', version: '0.2.0', arch: 'x86_64', avx2: true, threads: 8, pid: 1, ...extra })));

  it('treats a helper that does not list its bodies as Earth and Moon only', async () => {
    vi.stubGlobal('fetch', info({}));
    const old = await probeEngine();
    expect(old?.bodies).toEqual(['earth', 'moon']);
    expect(engineSupports(old, 'mars')).toBe(false);
    expect(nativeActive({ engineEnabled: true, engineStatus: 'available', engineInfo: old, body: 'mars' })).toBe(false);
    expect(nativeActive({ engineEnabled: true, engineStatus: 'available', engineInfo: old, body: 'moon' })).toBe(true);
  });

  it('uses a helper that reports Mars support', async () => {
    vi.stubGlobal('fetch', info({ version: '0.3.0', bodies: ['earth', 'moon', 'mars'] }));
    const cur = await probeEngine();
    expect(engineSupports(cur, 'mars')).toBe(true);
  });

  it('labels a native Mars grid by the mosaic the helper actually used', async () => {
    const n = 65;
    const buf = new ArrayBuffer(32 + n * n * 4);
    const v = new DataView(buf);
    'HRG1'.split('').forEach((c, i) => v.setUint8(i, c.charCodeAt(0)));
    v.setUint32(4, 1, true);
    v.setUint32(8, n, true);
    v.setUint32(12, n, true);
    v.setFloat32(16, 20_000, true);
    v.setFloat32(20, 20_000, true);
    v.setFloat32(24, -2600, true);
    v.setFloat32(28, -2600, true);
    for (let i = 0; i < n * n; i++) v.setFloat32(32 + i * 4, -2600, true);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(buf, { status: 200, headers: { 'X-Engine-Source': 'mars-mola-463m' } })));
    const res = await loadTerrainFromEngine('mars', { centre: { lat: 18.4, lon: 77.2 }, sizeM: 20_000 }, n);
    expect(res.meta.id).toBe('mars-mola-463m');
    expect(res.meta.body).toBe('mars');
    expect(res.meta.attribution).toMatch(/MOLA global DEM/);
    expect(res.meta.attribution).toMatch(/resampled natively/);
  });
});
