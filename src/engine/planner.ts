import { autoCandidateDivisions } from './area';
import { buildAdjacency, bestPath, reachableFrom } from './graph';
import { heightFor } from './network';
import { evaluateLink, maxFreeSpaceRangeM } from './propagation';
import type { Env, HeightGrid, Heights, NodeKind, RadioProfile, SiteNode } from './types';

export interface PlannerOptions {
  /** The area is split into gridDivisions x gridDivisions cells, one candidate site each. 0 = automatic (~1.2 km cells). */
  gridDivisions: number;
  /** When true, links with an obstructed first Fresnel zone are not used for planning. */
  requireFresnel: boolean;
  /** When true, also look for a second A-B path that shares no relay with the first. */
  redundancy: boolean;
}

export const DEFAULT_PLANNER: PlannerOptions = { gridDivisions: 0, requireFresnel: false, redundancy: false };

export interface PlanResult {
  status: 'ok' | 'no-route';
  /** New relay positions to deploy, metres. Empty when a direct link already works. */
  relays: { x: number; y: number }[];
  candidatesSampled: number;
  linksEvaluated: number;
  feasibleLinks: number;
  /** Base station ids that could not be joined to the network. */
  unreachedBases: string[];
  redundantPathFound: boolean | null;
  notes: string[];
}

interface PNode {
  x: number;
  y: number;
  kind: NodeKind | 'candidate';
  id?: string;
}

/**
 * One candidate per grid cell, at the highest elevation sample in that cell. High ground tends to
 * see further, but this is a sampling heuristic: sites between samples are never considered.
 */
export function sampleCandidates(grid: HeightGrid, divisions: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const g = Math.max(2, Math.min(40, Math.round(divisions)));
  for (let cy = 0; cy < g; cy++) {
    const r0 = Math.floor((cy / g) * (grid.rows - 1));
    const r1 = Math.floor(((cy + 1) / g) * (grid.rows - 1));
    for (let cx = 0; cx < g; cx++) {
      const c0 = Math.floor((cx / g) * (grid.cols - 1));
      const c1 = Math.floor(((cx + 1) / g) * (grid.cols - 1));
      let best = -Infinity;
      let br = r0;
      let bc = c0;
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const e = grid.data[r * grid.cols + c];
          if (e > best) {
            best = e;
            br = r;
            bc = c;
          }
        }
      }
      out.push({ x: (bc / (grid.cols - 1)) * grid.widthM, y: (br / (grid.rows - 1)) * grid.heightM });
    }
  }
  return out;
}

/**
 * Heuristic relay placement.
 *
 * 1. Sample candidate sites, 2. evaluate every pair within free-space range, 3. search the
 * resulting graph for the A-B path that adds the fewest new relays (existing enabled relays and
 * base stations are free to reuse), preferring the path whose weakest link has the most margin.
 * Base stations are then attached with the fewest extra relays.
 *
 * The answer is optimal only with respect to the sampled candidates and this link model.
 */
export function planRelays(
  grid: HeightGrid,
  env: Env,
  radio: RadioProfile,
  heights: Heights,
  options: PlannerOptions,
  existing: SiteNode[],
): PlanResult {
  const active = existing.filter((n) => n.enabled);
  const a = active.find((n) => n.kind === 'A');
  const b = active.find((n) => n.kind === 'B');
  if (!a || !b) throw new Error('Both endpoints A and B must be placed before planning.');

  const minSep = Math.min(grid.widthM / (grid.cols - 1), grid.heightM / (grid.rows - 1)) * 1.5;
  const fixed: PNode[] = active.map((n) => ({ x: n.x, y: n.y, kind: n.kind, id: n.id }));
  const divisions = options.gridDivisions > 0 ? options.gridDivisions : autoCandidateDivisions(grid.widthM);
  const candidates = sampleCandidates(grid, divisions).filter(
    (c) => !fixed.some((f) => Math.hypot(f.x - c.x, f.y - c.y) < minSep),
  );
  const nodes: PNode[] = [...fixed, ...candidates.map((c) => ({ ...c, kind: 'candidate' as const }))];
  const h = (n: PNode) => (n.kind === 'candidate' ? heights.nodeM : heightFor(n.kind, heights));

  const maxRange = maxFreeSpaceRangeM(radio);
  const edges: { i: number; j: number; margin: number }[] = [];
  let evaluated = 0;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const p = nodes[i];
      const q = nodes[j];
      if (Math.hypot(p.x - q.x, p.y - q.y) > maxRange) continue;
      evaluated++;
      const r = evaluateLink(grid, env, radio, { x: p.x, y: p.y, heightM: h(p) }, { x: q.x, y: q.y, heightM: h(q) });
      if (r.status === 'good' || (r.status === 'marginal' && !options.requireFresnel)) {
        edges.push({ i, j, margin: r.marginDb });
      }
    }
  }
  const adj = buildAdjacency(nodes.length, edges);
  const ia = nodes.findIndex((n) => n.kind === 'A');
  const ib = nodes.findIndex((n) => n.kind === 'B');
  const chosen = new Set<number>();
  const nodeCost = (i: number) => (nodes[i].kind === 'candidate' && !chosen.has(i) ? 1 : 0);
  const notes: string[] = [];
  const base: Omit<PlanResult, 'status' | 'relays' | 'unreachedBases' | 'redundantPathFound' | 'notes'> = {
    candidatesSampled: candidates.length,
    linksEvaluated: evaluated,
    feasibleLinks: edges.length,
  };

  const primary = bestPath(adj, [ia], (i) => i === ib, { nodeCost });
  if (!primary) {
    const fromA = reachableFrom(adj, ia).filter(Boolean).length - 1;
    const fromB = reachableFrom(adj, ib).filter(Boolean).length - 1;
    notes.push(
      `No chain of feasible links joins A and B among ${candidates.length} sampled candidate sites. ` +
        `A can reach ${fromA} site(s) and B can reach ${fromB}, but the two groups never meet.`,
      'Try a denser candidate grid, taller antennas, more transmit power or a lower required margin' +
        (options.requireFresnel ? ', or allow Fresnel-obstructed links.' : '.'),
    );
    return { status: 'no-route', relays: [], unreachedBases: [], redundantPathFound: null, notes, ...base };
  }
  primary.path.forEach((i) => chosen.add(i));

  let redundantPathFound: boolean | null = null;
  if (options.redundancy) {
    const interior = new Set(primary.path.slice(1, -1));
    const backup = bestPath(adj, [ia], (i) => i === ib, {
      nodeCost,
      blocked: interior,
      blockedEdge: primary.path.length === 2 ? [ia, ib] : undefined,
    });
    redundantPathFound = !!backup;
    if (backup) backup.path.forEach((i) => chosen.add(i));
    else notes.push('No second path avoiding the primary relays exists among the sampled candidates; the result is a single chain.');
  }

  const unreachedBases: string[] = [];
  nodes.forEach((n, i) => {
    if (n.kind !== 'base') return;
    const inNetwork = [...chosen].filter((c) => c !== i);
    const p = bestPath(adj, [i], (t) => t !== i && inNetwork.includes(t), { nodeCost });
    if (p) p.path.forEach((k) => chosen.add(k));
    else unreachedBases.push(n.id!);
  });
  if (unreachedBases.length) {
    notes.push(`${unreachedBases.length} base station(s) could not be joined to the relay network with the sampled candidates.`);
  }

  const relays = [...chosen].filter((i) => nodes[i].kind === 'candidate').map((i) => ({ x: nodes[i].x, y: nodes[i].y }));
  if (relays.length === 0 && primary.path.length === 2) notes.push('A direct A-B link already meets the link budget; no relay is needed.');
  return { status: 'ok', relays, unreachedBases, redundantPathFound, notes, ...base };
}
