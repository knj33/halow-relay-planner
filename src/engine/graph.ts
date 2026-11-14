/** Small graph utilities over integer node indices. No terrain or radio knowledge in here. */

export interface Edge {
  to: number;
  /** Link margin in dB; higher is better. */
  margin: number;
}
export type Adjacency = Edge[][];

export function buildAdjacency(n: number, links: { i: number; j: number; margin: number }[]): Adjacency {
  const adj: Adjacency = Array.from({ length: n }, () => []);
  for (const l of links) {
    adj[l.i].push({ to: l.j, margin: l.margin });
    adj[l.j].push({ to: l.i, margin: l.margin });
  }
  return adj;
}

export interface PathResult {
  path: number[];
  /** Sum of nodeCost over every node entered after the source. */
  cost: number;
  /** Smallest link margin on the path, dB. */
  bottleneck: number;
}

export interface PathOptions {
  /** Cost of entering a node. Defaults to 1, which makes this a minimum-hop search. */
  nodeCost?: (i: number) => number;
  blocked?: Set<number>;
  /** An undirected edge to ignore, e.g. the direct link when looking for an alternate path. */
  blockedEdge?: [number, number];
}

/**
 * Lowest-cost path from any source to any target; among equal-cost paths, the one whose weakest
 * link has the most margin. Dijkstra on the lexicographic key (cost, -bottleneck).
 */
export function bestPath(
  adj: Adjacency,
  sources: number[],
  isTarget: (i: number) => boolean,
  opts: PathOptions = {},
): PathResult | null {
  const n = adj.length;
  const nodeCost = opts.nodeCost ?? (() => 1);
  const blocked = opts.blocked;
  const be = opts.blockedEdge;
  const cost = new Float64Array(n).fill(Infinity);
  const bn = new Float64Array(n).fill(-Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  for (const s of sources) {
    if (blocked?.has(s)) continue;
    cost[s] = 0;
    bn[s] = Infinity;
  }
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) {
      if (done[i] || cost[i] === Infinity) continue;
      if (u < 0 || cost[i] < cost[u] || (cost[i] === cost[u] && bn[i] > bn[u])) u = i;
    }
    if (u < 0) return null;
    done[u] = 1;
    if (isTarget(u) && prev[u] !== -1) {
      const path: number[] = [];
      for (let v = u; v !== -1; v = prev[v]) path.push(v);
      path.reverse();
      return { path, cost: cost[u], bottleneck: bn[u] };
    }
    for (const e of adj[u]) {
      const v = e.to;
      if (done[v] || blocked?.has(v)) continue;
      if (be && ((be[0] === u && be[1] === v) || (be[0] === v && be[1] === u))) continue;
      const c = cost[u] + nodeCost(v);
      const b = Math.min(bn[u], e.margin);
      if (c < cost[v] || (c === cost[v] && b > bn[v])) {
        cost[v] = c;
        bn[v] = b;
        prev[v] = u;
      }
    }
  }
}

/** Flags for every node reachable from src without passing through a blocked node. */
export function reachableFrom(adj: Adjacency, src: number, blocked?: Set<number>): boolean[] {
  const seen = new Array<boolean>(adj.length).fill(false);
  if (blocked?.has(src)) return seen;
  const stack = [src];
  seen[src] = true;
  while (stack.length) {
    const u = stack.pop()!;
    for (const e of adj[u]) {
      if (seen[e.to] || blocked?.has(e.to)) continue;
      seen[e.to] = true;
      stack.push(e.to);
    }
  }
  return seen;
}

/**
 * Number of paths from s to t that share no intermediate node (capped). 1 means a chain;
 * 2 or more means the network survives the loss of any single relay.
 * Unit-capacity max flow with node splitting.
 */
export function nodeDisjointPaths(adj: Adjacency, s: number, t: number, cap = 4): number {
  if (s === t) return 0;
  const n = adj.length;
  const N = 2 * n; // v_in = 2v, v_out = 2v + 1
  const capMap = new Map<number, number>();
  const nbrs: number[][] = Array.from({ length: N }, () => []);
  const key = (u: number, v: number) => u * N + v;
  const addArc = (u: number, v: number, c: number) => {
    if (!capMap.has(key(u, v))) {
      nbrs[u].push(v);
      nbrs[v].push(u);
      capMap.set(key(v, u), capMap.get(key(v, u)) ?? 0);
    }
    capMap.set(key(u, v), (capMap.get(key(u, v)) ?? 0) + c);
  };
  for (let v = 0; v < n; v++) addArc(2 * v, 2 * v + 1, v === s || v === t ? cap : 1);
  for (let u = 0; u < n; u++) for (const e of adj[u]) addArc(2 * u + 1, 2 * e.to, 1);

  const source = 2 * s + 1;
  const sink = 2 * t;
  let flow = 0;
  while (flow < cap) {
    const prev = new Int32Array(N).fill(-1);
    prev[source] = source;
    const queue = [source];
    for (let qi = 0; qi < queue.length && prev[sink] === -1; qi++) {
      const u = queue[qi];
      for (const v of nbrs[u]) {
        if (prev[v] !== -1 || (capMap.get(key(u, v)) ?? 0) <= 0) continue;
        prev[v] = u;
        queue.push(v);
      }
    }
    if (prev[sink] === -1) break;
    for (let v = sink; v !== source; v = prev[v]) {
      const u = prev[v];
      capMap.set(key(u, v), capMap.get(key(u, v))! - 1);
      capMap.set(key(v, u), (capMap.get(key(v, u)) ?? 0) + 1);
    }
    flow++;
  }
  return flow;
}
