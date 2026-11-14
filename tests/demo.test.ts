import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BODIES, DEFAULT_BACKHAUL, analyzeNetwork, defaultCostModel, evaluateNetwork, heightsOf, makeEnv, toEngineNodes } from '../src/engine';
import { decodePremadeGrid } from '../src/state/store';
import type { PremadeDemo } from '../src/state/store';

const manifest = JSON.parse(readFileSync('public/demo/arcadia-200km.json', 'utf8')) as PremadeDemo;
const bin = readFileSync(`public/demo/${manifest.grid.file}`);
const grid = decodePremadeGrid(manifest, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));

describe('premade 200 km demo bundle', () => {
  it('is a 200 km Mars area at the Arcadia Starship candidate site with real elevation', () => {
    expect(manifest.body).toBe('mars');
    expect(manifest.area.sizeM).toBe(200_000);
    expect(manifest.site.lat).toBeCloseTo(39.09, 2);
    expect(manifest.terrainMeta.synthetic).toBe(false);
    expect(grid.cols * grid.rows).toBe(grid.data.length);
    // Arcadia Planitia lies about 3-4 km below the Mars datum; a 0 m sample would be nodata.
    let max = -Infinity;
    for (const v of grid.data) if (v > max) max = v;
    expect(max).toBeLessThan(0);
  });

  it('has every node inside the area', () => {
    const { outside } = toEngineNodes('mars', manifest.area, manifest.nodes);
    expect(outside).toEqual([]);
    expect(manifest.nodes.filter((n) => n.kind === 'A')).toHaveLength(1);
    expect(manifest.nodes.filter((n) => n.kind === 'B')).toHaveLength(1);
  });

  it('connects A and B with the app’s own link model on the decoded grid', () => {
    const env = makeEnv('mars');
    const heights = heightsOf(manifest.radio, DEFAULT_BACKHAUL, defaultCostModel('mars'));
    const nodes = toEngineNodes('mars', manifest.area, manifest.nodes).inside;
    const net = analyzeNetwork(nodes, evaluateNetwork(grid, env, manifest.radio, heights, nodes));
    expect(net.connected).toBe(true);
    expect(net.disjointPaths).toBeGreaterThanOrEqual(manifest.summary.disjointPaths);
    expect(BODIES.mars.radiusM).toBeGreaterThan(0);
  });
});
