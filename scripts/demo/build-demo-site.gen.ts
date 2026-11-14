/**
 * Builds the premade "Demo" scenario: a 200 km planning area around a SpaceX Starship candidate
 * landing site in Arcadia Planitia, Mars, with real elevation fetched once and relays already planned.
 *
 *   npx vitest run --config scripts/demo/vitest.config.ts
 *
 * Writes public/demo/arcadia-200km.json (scenario + plan) and public/demo/arcadia-200km.bin (grid).
 * Needs network access to the USGS mosaics; takes a few minutes. The app only reads the output files.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from 'vitest';
import {
  BODIES,
  DEFAULT_BACKHAUL,
  EXAMPLE_HALOW_PROFILE,
  analyzeNetwork,
  defaultCostModel,
  evaluateNetwork,
  gridToGeo,
  heightsOf,
  loadEquirectRegion,
  makeEnv,
  planRelays,
} from '../../src/engine';
import type { HeightGrid, PlanResult, RadioProfile, SiteNode } from '../../src/engine';
import { localToGeo } from '../../src/engine/terrain/geo';
import { openRangeTiff } from '../../src/terrain/rangeTiff';
import { MOSAIC_TERRAIN } from '../../src/terrain/sources';

const SITE = {
  name: 'Arcadia Planitia, SpaceX Starship candidate landing site',
  // HiRISE ESP_060706_2195, "Candidate Landing Site for SpaceX Starship Near Arcadia Planitia": 39.090°N, 189.790°E.
  lat: 39.09,
  lon: 189.79 - 360,
  source: 'https://hirise.lpl.arizona.edu/ESP_060706_2195',
};
const SIZE_M = 200_000;
const N = 1025;
const OUT = 'public/demo';

/** Deployment layout, metres east/north of the site centre. */
const LAYOUT: { id: string; kind: SiteNode['kind']; east: number; north: number; role: string }[] = [
  { id: 'A', kind: 'A', east: -55_000, north: -40_000, role: 'Starship landing zone' },
  { id: 'B', kind: 'B', east: 60_000, north: 45_000, role: 'Ice-mining outpost' },
  { id: 'base-1', kind: 'base', east: -52_000, north: -43_000, role: 'Landing-zone uplink' },
  { id: 'base-2', kind: 'base', east: 0, north: 4_000, role: 'Mid-route uplink' },
  { id: 'base-3', kind: 'base', east: 57_000, north: 48_000, role: 'Outpost uplink' },
];

test(
  'build the premade Arcadia demo',
  async () => {
    const R = BODIES.mars.radiusM;
    const centre = { lat: SITE.lat, lon: SITE.lon };
    const area = { centre, sizeM: SIZE_M };

    let grid: HeightGrid | null = null;
    let used = MOSAIC_TERRAIN.mars.rasters[0];
    for (const raster of MOSAIC_TERRAIN.mars.rasters) {
      try {
        console.log(`Reading ${raster.id} …`);
        const tiff = await openRangeTiff(raster.url, -180);
        let last = 0;
        const res = await loadEquirectRegion(centre, SIZE_M, R, tiff, N, (t) => {
          const now = Date.now();
          if (now - last > 5000) {
            console.log(`  ${t}`);
            last = now;
          }
        });
        grid = res.grid;
        used = raster;
        break;
      } catch (err) {
        console.log(`  failed: ${(err as Error).message}`);
      }
    }
    if (!grid) throw new Error('No elevation source could be read.');
    let zeros = 0;
    for (const v of grid.data) if (v === 0) zeros++;
    console.log(`Grid ${grid.cols}×${grid.rows}, ${grid.minElevM.toFixed(0)} to ${grid.maxElevM.toFixed(0)} m, ${zeros} zero (possible nodata) samples, source ${used.id}`);

    const env = makeEnv('mars');
    const cost = defaultCostModel('mars');
    const options = { gridDivisions: 32, requireFresnel: false, redundancy: true };
    const toSite = (l: (typeof LAYOUT)[number]): SiteNode => ({ id: l.id, kind: l.kind, x: l.east + SIZE_M / 2, y: l.north + SIZE_M / 2, enabled: true, origin: 'manual' });
    const fixed = LAYOUT.map(toSite);

    // Smallest realistic mast that closes the route: 3 m first, then taller.
    let radio: RadioProfile = { ...EXAMPLE_HALOW_PROFILE };
    let result: PlanResult | null = null;
    for (const mast of [3, 5, 8, 12]) {
      radio = { ...EXAMPLE_HALOW_PROFILE, name: `Demo HaLow profile, ${mast} m masts (illustrative)`, antennaHeightM: mast };
      const heights = heightsOf(radio, DEFAULT_BACKHAUL, cost);
      const t = Date.now();
      result = planRelays(grid, env, radio, heights, options, fixed);
      console.log(`Mast ${mast} m: ${result.status}, ${result.relays.length} relays, redundant ${result.redundantPathFound}, unreached bases ${result.unreachedBases.join(',') || 'none'} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
      if (result.status === 'ok' && result.unreachedBases.length === 0) break;
    }
    if (!result || result.status !== 'ok') throw new Error('The planner found no route for the demo layout.');

    const heights = heightsOf(radio, DEFAULT_BACKHAUL, cost);
    const relays: SiteNode[] = result.relays.map((r, i) => ({ id: `relay-${i + 1}`, kind: 'relay', x: r.x, y: r.y, enabled: true, origin: 'auto' }));
    const all = [...fixed, ...relays];
    const links = evaluateNetwork(grid, env, radio, heights, all);
    const net = analyzeNetwork(all, links);
    console.log(`Network: ${net.topology}, ${net.route.length - 1} hops, weakest ${net.minMarginDb?.toFixed(1)} dB, ${net.disjointPaths} disjoint paths`);
    if (!net.connected) throw new Error('Planned demo network does not connect A and B.');

    const geo = (n: SiteNode) => gridToGeo(area, n.x, n.y, R);
    const nodes = all.map((n) => {
      const p = geo(n);
      return { id: n.id, kind: n.kind, lat: p.lat, lon: p.lon, enabled: true, origin: n.origin };
    });

    // Grid: int16 at 0.25 m steps above a whole-metre offset (coarser steps would terrace the flat plains).
    const offsetM = Math.floor(grid.minElevM);
    const scaleM = 0.25;
    const q = new Int16Array(grid.data.length);
    for (let i = 0; i < q.length; i++) q[i] = Math.round((grid.data[i] - offsetM) / scaleM);
    if ((grid.maxElevM - offsetM) / scaleM > 32767) throw new Error('Relief too large for 0.25 m int16 steps.');

    const ew = used.resM * Math.cos((centre.lat * Math.PI) / 180);
    const manifest = {
      schema: 'halow-relay-planner/premade-demo',
      version: 1,
      builtAt: new Date().toISOString(),
      site: SITE,
      body: 'mars',
      area,
      grid: { file: 'arcadia-200km.bin', cols: grid.cols, rows: grid.rows, widthM: grid.widthM, heightM: grid.heightM, minElevM: grid.minElevM, maxElevM: grid.maxElevM, offsetM, scaleM, format: 'int16le' },
      terrainMeta: {
        id: `demo-${used.id}`,
        label: `Premade demo · ${SIZE_M / 1000} km area at ${centre.lat.toFixed(3)}°N, ${(centre.lon + 360).toFixed(3)}°E`,
        body: 'mars',
        synthetic: false,
        georeferenced: true,
        site: centre,
        resolutionM: Math.max(used.resM, SIZE_M / (N - 1)),
        attribution:
          `${used.credit} (${used.resM.toFixed(0)} m north-south, ${ew.toFixed(0)} m east-west here), resampled to a ${N} × ${N} grid at ${(SIZE_M / (N - 1)).toFixed(0)} m spacing and bundled with the app (fetched ${new Date().toISOString().slice(0, 10)}).` +
          (used.caveat ? ` ${used.caveat}` : ''),
      },
      radio,
      planner: options,
      roles: Object.fromEntries(LAYOUT.map((l) => [l.id, l.role])),
      nodes,
      plan: result,
      summary: { topology: net.topology, hops: net.route.length - 1, weakestMarginDb: net.minMarginDb, disjointPaths: net.disjointPaths, relays: relays.length },
    };

    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/arcadia-200km.bin`, Buffer.from(q.buffer));
    writeFileSync(`${OUT}/arcadia-200km.json`, JSON.stringify(manifest, null, 1));
    console.log(`Wrote ${OUT}/arcadia-200km.json and .bin (${(q.byteLength / 1048576).toFixed(1)} MB)`);
  },
  45 * 60_000,
);
