import { describe, expect, it } from 'vitest';
import { analyzeNetwork, bestPath, buildAdjacency, evaluateNetwork, nodeDisjointPaths, planRelays, reachableFrom, sampleCandidates, servingNodeIds } from '../src/engine';
import type { SiteNode } from '../src/engine';
import { EARTH, flatGrid, heights, node, radio, ridgeGrid } from './helpers';

describe('graph search', () => {
  it('returns null for a disconnected graph', () => {
    const adj = buildAdjacency(4, [
      { i: 0, j: 1, margin: 20 },
      { i: 2, j: 3, margin: 20 },
    ]);
    expect(bestPath(adj, [0], (i) => i === 3)).toBeNull();
    expect(reachableFrom(adj, 0)).toEqual([true, true, false, false]);
    expect(nodeDisjointPaths(adj, 0, 3)).toBe(0);
  });

  it('prefers fewer hops over more margin', () => {
    const adj = buildAdjacency(5, [
      { i: 0, j: 1, margin: 11 },
      { i: 1, j: 4, margin: 11 },
      { i: 0, j: 2, margin: 40 },
      { i: 2, j: 3, margin: 40 },
      { i: 3, j: 4, margin: 40 },
    ]);
    expect(bestPath(adj, [0], (i) => i === 4)!.path).toEqual([0, 1, 4]);
  });

  it('among equal hop counts, picks the path with the best weakest link', () => {
    const adj = buildAdjacency(4, [
      { i: 0, j: 1, margin: 30 },
      { i: 1, j: 3, margin: 12 },
      { i: 0, j: 2, margin: 18 },
      { i: 2, j: 3, margin: 17 },
    ]);
    const p = bestPath(adj, [0], (i) => i === 3)!;
    expect(p.path).toEqual([0, 2, 3]);
    expect(p.bottleneck).toBe(17);
  });

  it('reuses zero-cost existing nodes before adding new ones', () => {
    const adj = buildAdjacency(5, [
      { i: 0, j: 1, margin: 20 }, // 1 = new candidate
      { i: 1, j: 4, margin: 20 },
      { i: 0, j: 2, margin: 15 }, // 2, 3 = already deployed
      { i: 2, j: 3, margin: 15 },
      { i: 3, j: 4, margin: 15 },
    ]);
    const p = bestPath(adj, [0], (i) => i === 4, { nodeCost: (i) => (i === 1 ? 1 : 0) })!;
    expect(p.path).toEqual([0, 2, 3, 4]);
    expect(p.cost).toBe(0);
  });

  it('counts node-disjoint paths', () => {
    const chain = buildAdjacency(3, [
      { i: 0, j: 1, margin: 20 },
      { i: 1, j: 2, margin: 20 },
    ]);
    expect(nodeDisjointPaths(chain, 0, 2)).toBe(1);
    const diamond = buildAdjacency(4, [
      { i: 0, j: 1, margin: 20 },
      { i: 1, j: 3, margin: 20 },
      { i: 0, j: 2, margin: 20 },
      { i: 2, j: 3, margin: 20 },
    ]);
    expect(nodeDisjointPaths(diamond, 0, 3)).toBe(2);
    // Two relays but a shared bottleneck node: still one independent path.
    const pinch = buildAdjacency(5, [
      { i: 0, j: 1, margin: 20 },
      { i: 0, j: 2, margin: 20 },
      { i: 1, j: 3, margin: 20 },
      { i: 2, j: 3, margin: 20 },
      { i: 3, j: 4, margin: 20 },
    ]);
    expect(nodeDisjointPaths(pinch, 0, 4)).toBe(1);
  });
});

describe('relay failure and chain vs mesh', () => {
  const grid = ridgeGrid();
  const base: SiteNode[] = [node('A', 'A', 1000, 5000), node('B', 'B', 9000, 5000)];
  const analyse = (nodes: SiteNode[]) => analyzeNetwork(nodes, evaluateNetwork(grid, EARTH, radio, heights, nodes));

  it('is disconnected with no relay over the ridge', () => {
    const net = analyse(base);
    expect(net.topology).toBe('disconnected');
    expect(net.connected).toBe(false);
    expect(net.route).toEqual([]);
  });

  it('one crest relay makes a chain, and disabling it disconnects A from B', () => {
    const on = analyse([...base, node('r1', 'relay', 5000, 5000)]);
    expect(on.topology).toBe('chain');
    expect(on.route).toEqual(['A', 'r1', 'B']);
    expect(on.relaysOnRoute).toBe(1);
    expect(on.criticalIds).toEqual(['r1']);
    expect(on.disjointPaths).toBe(1);
    expect(on.hops).toHaveLength(2);
    expect(on.routeDistanceM).toBeGreaterThan(8000);
    expect(on.minMarginDb).toBeGreaterThanOrEqual(radio.requiredMarginDb);

    const off = analyse([...base, node('r1', 'relay', 5000, 5000, false)]);
    expect(off.topology).toBe('disconnected');
  });

  it('two crest relays make a mesh that survives either one failing', () => {
    const both = analyse([...base, node('r1', 'relay', 5000, 4000), node('r2', 'relay', 5000, 6000)]);
    expect(both.topology).toBe('mesh');
    expect(both.disjointPaths).toBe(2);
    expect(both.criticalIds).toEqual([]);

    const oneDown = analyse([...base, node('r1', 'relay', 5000, 4000, false), node('r2', 'relay', 5000, 6000)]);
    expect(oneDown.connected).toBe(true);
    expect(oneDown.topology).toBe('chain');
    expect(oneDown.route).toEqual(['A', 'r2', 'B']);
    expect(oneDown.criticalIds).toEqual(['r2']);

    const bothDown = analyse([...base, node('r1', 'relay', 5000, 4000, false), node('r2', 'relay', 5000, 6000, false)]);
    expect(bothDown.connected).toBe(false);
  });

  it('a relay cut off by a failure no longer serves the crew unless a base station backs it', () => {
    const serving = (nodes: SiteNode[]) => [...servingNodeIds(nodes, evaluateNetwork(grid, EARTH, radio, heights, nodes))].sort();
    const east = node('r2', 'relay', 8000, 3000);
    expect(serving([...base, node('r1', 'relay', 5000, 5000), east])).toEqual(['A', 'B', 'r1', 'r2']);
    // The crest relay fails: r2 and B are still on the air but reach neither A nor a base station.
    expect(serving([...base, node('r1', 'relay', 5000, 5000, false), east])).toEqual(['A']);
    // A base station on B's side carries that side home over the satellite.
    expect(serving([...base, node('r1', 'relay', 5000, 5000, false), east, node('s1', 'base', 8500, 7000)])).toEqual(['A', 'B', 'r2', 's1']);
  });

  it('reports incomplete until both endpoints exist', () => {
    expect(analyse([node('A', 'A', 1000, 5000)]).topology).toBe('incomplete');
  });
});

describe('automatic placement', () => {
  const opts = { gridDivisions: 10, requireFresnel: false, redundancy: false };
  const endpoints = [node('A', 'A', 1000, 5000), node('B', 'B', 9000, 5000)];
  const withRelays = (relays: { x: number; y: number }[]) => [...endpoints, ...relays.map((p, i) => node(`r${i}`, 'relay', p.x, p.y))];

  it('samples one candidate per cell at its highest point', () => {
    const c = sampleCandidates(ridgeGrid(), 10);
    expect(c).toHaveLength(100);
    expect(c.some((p) => Math.abs(p.x - 5000) < 1)).toBe(true);
  });

  it('needs no relay when the direct link works', () => {
    const near = [node('A', 'A', 1000, 5000), node('B', 'B', 2500, 5000)];
    const plan = planRelays(flatGrid(), EARTH, radio, heights, opts, near);
    expect(plan.status).toBe('ok');
    expect(plan.relays).toHaveLength(0);
  });

  it('bridges a ridge with a single relay and the result really connects', () => {
    const grid = ridgeGrid();
    const plan = planRelays(grid, EARTH, radio, heights, opts, endpoints);
    expect(plan.status).toBe('ok');
    expect(plan.relays).toHaveLength(1);
    const nodes = withRelays(plan.relays);
    const net = analyzeNetwork(nodes, evaluateNetwork(grid, EARTH, radio, heights, nodes));
    expect(net.connected).toBe(true);
    expect(net.topology).toBe('chain');
  });

  it('adds a second independent path when redundancy is requested', () => {
    const grid = ridgeGrid();
    const plan = planRelays(grid, EARTH, radio, heights, { ...opts, redundancy: true }, endpoints);
    expect(plan.redundantPathFound).toBe(true);
    expect(plan.relays).toHaveLength(2);
    const nodes = withRelays(plan.relays);
    expect(analyzeNetwork(nodes, evaluateNetwork(grid, EARTH, radio, heights, nodes)).topology).toBe('mesh');
  });

  it('reuses an existing manual relay instead of adding a new one', () => {
    const plan = planRelays(ridgeGrid(), EARTH, radio, heights, opts, [...endpoints, node('mine', 'relay', 5000, 3000)]);
    expect(plan.status).toBe('ok');
    expect(plan.relays).toHaveLength(0);
  });

  it('returns "no feasible route" when no chain of links can exist', () => {
    const weak = { ...radio, txPowerDbm: -20 }; // free-space range of a few tens of metres
    const plan = planRelays(ridgeGrid(), EARTH, weak, heights, opts, endpoints);
    expect(plan.status).toBe('no-route');
    expect(plan.relays).toEqual([]);
    expect(plan.notes.join(' ')).toMatch(/No chain of feasible links/);
  });

  it('refuses to plan without both endpoints', () => {
    expect(() => planRelays(flatGrid(), EARTH, radio, heights, opts, [endpoints[0]])).toThrow();
  });
});
