import { buildAdjacency, bestPath, nodeDisjointPaths, reachableFrom } from './graph';
import { evaluateLink } from './propagation';
import type { Antenna, Env, HeightGrid, Heights, LinkResult, NodeKind, RadioProfile, SiteNode } from './types';

export interface NetworkLink {
  a: string;
  b: string;
  result: LinkResult;
}

export type Topology = 'incomplete' | 'disconnected' | 'direct' | 'chain' | 'mesh';

export interface BaseReach {
  id: string;
  /** Radio hops from endpoint A to this base station, or null if unreachable. */
  hopsFromA: number | null;
  hopsFromB: number | null;
}

export interface NetworkAnalysis {
  topology: Topology;
  connected: boolean;
  /** Node ids from A to B along the preferred route (fewest hops, then best weakest-link margin). */
  route: string[];
  hops: NetworkLink[];
  routeDistanceM: number;
  relaysOnRoute: number;
  minMarginDb: number | null;
  /** Count of A-to-B paths sharing no intermediate node (capped at 4). */
  disjointPaths: number;
  /** Enabled relays/base stations whose loss would cut A from B. */
  criticalIds: string[];
  /** Ids of nodes in the same connected component as A. */
  componentOfA: string[];
  bases: BaseReach[];
}

export function heightFor(kind: NodeKind, heights: Heights): number {
  return kind === 'base' ? heights.baseM : heights.nodeM;
}

export function antennaOf(node: SiteNode, heights: Heights): Antenna {
  return { x: node.x, y: node.y, heightM: heightFor(node.kind, heights) };
}

/** Evaluate every pair of enabled nodes. Disabled nodes are treated as absent. */
export function evaluateNetwork(
  grid: HeightGrid,
  env: Env,
  radio: RadioProfile,
  heights: Heights,
  nodes: SiteNode[],
): NetworkLink[] {
  const active = nodes.filter((n) => n.enabled);
  const links: NetworkLink[] = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      links.push({
        a: active[i].id,
        b: active[j].id,
        result: evaluateLink(grid, env, radio, antennaOf(active[i], heights), antennaOf(active[j], heights)),
      });
    }
  }
  return links;
}

const usable = (l: NetworkLink) => l.result.status !== 'fail';

export function analyzeNetwork(nodes: SiteNode[], links: NetworkLink[]): NetworkAnalysis {
  const active = nodes.filter((n) => n.enabled);
  const index = new Map(active.map((n, i) => [n.id, i]));
  const adj = buildAdjacency(
    active.length,
    links.filter(usable).map((l) => ({ i: index.get(l.a)!, j: index.get(l.b)!, margin: l.result.marginDb })),
  );
  const ia = active.findIndex((n) => n.kind === 'A');
  const ib = active.findIndex((n) => n.kind === 'B');
  const baseNodes = active.filter((n) => n.kind === 'base');

  const hopsTo = (from: number, to: number): number | null => {
    if (from < 0) return null;
    const p = bestPath(adj, [from], (i) => i === to);
    return p ? p.path.length - 1 : null;
  };
  const bases: BaseReach[] = baseNodes.map((b) => ({
    id: b.id,
    hopsFromA: hopsTo(ia, index.get(b.id)!),
    hopsFromB: hopsTo(ib, index.get(b.id)!),
  }));
  const componentOfA = ia >= 0 ? active.filter((_, i) => reachableFrom(adj, ia)[i]).map((n) => n.id) : [];

  const empty: NetworkAnalysis = {
    topology: 'incomplete',
    connected: false,
    route: [],
    hops: [],
    routeDistanceM: 0,
    relaysOnRoute: 0,
    minMarginDb: null,
    disjointPaths: 0,
    criticalIds: [],
    componentOfA,
    bases,
  };
  if (ia < 0 || ib < 0) return empty;

  const best = bestPath(adj, [ia], (i) => i === ib);
  if (!best) return { ...empty, topology: 'disconnected' };

  const route = best.path.map((i) => active[i].id);
  const findLink = (p: string, q: string) => links.find((l) => (l.a === p && l.b === q) || (l.a === q && l.b === p))!;
  const hops = route.slice(1).map((id, k) => {
    const l = findLink(route[k], id);
    return { a: route[k], b: id, result: l.result };
  });
  const disjointPaths = nodeDisjointPaths(adj, ia, ib);
  const criticalIds: string[] = [];
  for (let i = 0; i < active.length; i++) {
    if (i === ia || i === ib) continue;
    if (!reachableFrom(adj, ia, new Set([i]))[ib]) criticalIds.push(active[i].id);
  }
  const topology: Topology = disjointPaths >= 2 ? 'mesh' : route.length === 2 ? 'direct' : 'chain';

  return {
    topology,
    connected: true,
    route,
    hops,
    routeDistanceM: hops.reduce((s, h) => s + h.result.distanceM, 0),
    relaysOnRoute: route.length - 2,
    minMarginDb: Math.min(...hops.map((h) => h.result.marginDb)),
    disjointPaths,
    criticalIds,
    componentOfA,
    bases,
  };
}
