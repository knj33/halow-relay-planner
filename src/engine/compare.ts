import type { BackhaulSettings, Satellite, StationBackhaul } from './backhaul';
import { pickSatellite } from './backhaul';
import type { CoverageMap } from './coverage';
import { coverageMap, skyCoverage } from './coverage';
import type { CostLine, CostModel } from './cost';
import { baseUnitUsd, clientUnitUsd, costLines, relayUnitUsd, satTerminalUnitUsd, towerUnitUsd } from './cost';
import { coverageResFor } from './area';
import { analyzeNetwork, antennaOf, evaluateNetwork } from './network';
import type { PlannerOptions } from './planner';
import { planRelays } from './planner';
import type { Env, HeightGrid, Heights, RadioProfile, SiteNode } from './types';

export interface Scenario {
  grid: HeightGrid;
  env: Env;
  radio: RadioProfile;
  backhaul: BackhaulSettings;
  cost: CostModel;
  planner: PlannerOptions;
  nodes: SiteNode[];
  satellites: Satellite[];
}

export type StrategyId = 'mesh' | 'direct' | 'towers' | 'satellite';

export interface Issue {
  code: 'no-link' | 'over-budget' | 'coverage-gap' | 'single-chain' | 'no-backhaul' | 'per-user-cost' | 'note';
  severity: 'bad' | 'warn' | 'info';
  text: string;
}

export interface StrategyResult {
  id: StrategyId;
  name: string;
  summary: string;
  /** null when A or B has not been placed yet. */
  connects: boolean | null;
  hardware: string;
  costLines: CostLine[];
  totalUsd: number;
  coveragePct: number;
  issues: Issue[];
}

export interface Analysis {
  coverage: { mesh: CoverageMap; direct: CoverageMap };
  strategies: StrategyResult[];
  stations: StationBackhaul[];
}

export function heightsOf(radio: RadioProfile, backhaul: BackhaulSettings, cost: CostModel): Heights {
  return { nodeM: radio.antennaHeightM, baseM: backhaul.baseAntennaHeightM, clientM: cost.clientHeightM };
}

function commonIssues(connects: boolean | null, totalUsd: number, coveragePct: number, cost: CostModel): Issue[] {
  const out: Issue[] = [];
  if (connects === false) out.push({ code: 'no-link', severity: 'bad', text: 'A and B cannot communicate.' });
  if (totalUsd > cost.budgetUsd) {
    out.push({
      code: 'over-budget',
      severity: 'bad',
      text: `Too expensive: ${(totalUsd / Math.max(1, cost.budgetUsd)).toFixed(1)}× the budget.`,
    });
  }
  if (coveragePct < cost.coverageTargetPct) {
    out.push({
      code: 'coverage-gap',
      severity: 'warn',
      text: `Coverage gap: ${coveragePct.toFixed(0)}% of the area is served, below the ${cost.coverageTargetPct}% target.`,
    });
  }
  return out;
}

/** Coverage and A-B connectivity for a set of HaLow infrastructure nodes. */
function halowService(s: Scenario, heights: Heights, nodes: SiteNode[], res: number) {
  const links = evaluateNetwork(s.grid, s.env, s.radio, heights, nodes);
  const net = analyzeNetwork(nodes, links);
  const active = nodes.filter((n) => n.enabled);
  const hasA = active.some((n) => n.kind === 'A');
  const serving = hasA ? active.filter((n) => net.componentOfA.includes(n.id)) : active;
  const coverage = coverageMap(s.grid, s.env, s.radio, serving.map((n) => antennaOf(n, heights)), heights.clientM, res);
  const connects = net.topology === 'incomplete' ? null : net.connected;
  return { net, coverage, connects };
}

/**
 * Compare the current relay deployment with three conventional alternatives using the same
 * terrain, radio model and cost placeholders. Runs in the worker.
 */
export function analyzeScenario(s: Scenario, res = coverageResFor(s.grid.widthM)): Analysis {
  const { cost } = s;
  const heights = heightsOf(s.radio, s.backhaul, cost);
  const endpoints = s.nodes.filter((n) => n.kind === 'A' || n.kind === 'B');
  const relays = s.nodes.filter((n) => n.kind === 'relay');
  const bases = s.nodes.filter((n) => n.kind === 'base');
  const activeBases = bases.filter((n) => n.enabled);

  const stations = activeBases.map((b) =>
    pickSatellite(s.grid, s.env, { id: b.id, x: b.x, y: b.y, heightM: heights.baseM }, s.satellites, s.backhaul),
  );

  // 1. This deployment: low masts plus relays.
  const mesh = halowService(s, heights, s.nodes, res);
  const meshCost = costLines([
    { label: 'HaLow nodes (endpoints + relays)', count: endpoints.length + relays.length, unitUsd: relayUnitUsd(cost) },
    { label: 'Base stations with satellite terminal', count: bases.length, unitUsd: baseUnitUsd(cost) },
    { label: 'Client radios', count: cost.userSites, unitUsd: clientUnitUsd(cost) },
  ]);
  const meshIssues = commonIssues(mesh.connects, meshCost.totalUsd, mesh.coverage.coveredPct, cost);
  if (mesh.net.topology === 'chain') {
    meshIssues.push({
      code: 'single-chain',
      severity: 'warn',
      text: `Single chain: losing any one of ${mesh.net.criticalIds.length} node(s) cuts A from B. Add relays for an alternate path.`,
    });
  }
  if (bases.length === 0) {
    meshIssues.push({ code: 'no-backhaul', severity: 'info', text: 'No base station: the network is local only, with no satellite backhaul.' });
  } else {
    const dark = stations.filter((st) => !st.chosen).length;
    const cutOff = mesh.net.bases.filter((b) => b.hopsFromA === null).length;
    if (dark) meshIssues.push({ code: 'no-backhaul', severity: 'warn', text: `${dark} base station(s) see no satellite above the terrain mask.` });
    if (cutOff && mesh.net.topology !== 'incomplete') {
      meshIssues.push({ code: 'no-backhaul', severity: 'warn', text: `${cutOff} base station(s) are not reachable from A over the relay network.` });
    }
  }

  // 2. Same radios, no relays.
  const directNodes = s.nodes.filter((n) => n.kind !== 'relay');
  const direct = halowService(s, heights, directNodes, res);
  const directCost = costLines([
    { label: 'HaLow endpoint nodes', count: endpoints.length, unitUsd: relayUnitUsd(cost) },
    { label: 'Base stations with satellite terminal', count: bases.length, unitUsd: baseUnitUsd(cost) },
    { label: 'Client radios', count: cost.userSites, unitUsd: clientUnitUsd(cost) },
  ]);
  const directIssues = commonIssues(direct.connects, directCost.totalUsd, direct.coverage.coveredPct, cost);
  if (direct.connects === false) {
    const ab = direct.net.topology === 'disconnected' ? evaluateNetwork(s.grid, s.env, s.radio, heights, endpoints)[0] : undefined;
    if (ab?.result.reasons[0]) directIssues.push({ code: 'note', severity: 'info', text: `Direct A–B link: ${ab.result.reasons[0]}` });
  }

  // 3. Conventional tall masts, placed by the same heuristic.
  const towerHeights: Heights = { ...heights, nodeM: cost.towerHeightM, baseM: Math.max(heights.baseM, cost.towerHeightM) };
  let towerNodes = directNodes.filter((n) => n.enabled);
  let towerNote: string | null = null;
  if (endpoints.length === 2 && endpoints.every((n) => n.enabled)) {
    const plan = planRelays(s.grid, s.env, s.radio, towerHeights, { ...s.planner, redundancy: false }, towerNodes);
    if (plan.status === 'ok') {
      towerNodes = [
        ...towerNodes,
        ...plan.relays.map((p, i) => ({ id: `tower-${i}`, kind: 'relay' as const, x: p.x, y: p.y, enabled: true, origin: 'auto' as const })),
      ];
    } else {
      towerNote = `Even ${cost.towerHeightM} m masts at the sampled sites cannot join A and B.`;
    }
  }
  const towers = halowService(s, towerHeights, towerNodes, res);
  const towerCount = towerNodes.filter((n) => n.kind !== 'base').length;
  const towerCost = costLines([
    { label: `${cost.towerHeightM} m masts with radio`, count: towerCount, unitUsd: towerUnitUsd(cost) },
    { label: 'Base stations with satellite terminal', count: bases.length, unitUsd: baseUnitUsd(cost) },
    { label: 'Client radios', count: cost.userSites, unitUsd: clientUnitUsd(cost) },
  ]);
  const towerIssues = commonIssues(towers.connects, towerCost.totalUsd, towers.coverage.coveredPct, cost);
  if (towerNote) towerIssues.push({ code: 'note', severity: 'info', text: towerNote });
  if (towers.net.topology === 'chain' || towers.net.topology === 'direct') {
    towerIssues.push({ code: 'single-chain', severity: 'info', text: 'Few large sites: each mast is a single point of failure for the area it serves.' });
  }

  // 4. A satellite terminal for every site and user, no local network.
  const sky = skyCoverage(s.grid, s.env, s.satellites, s.backhaul, heights.clientM, res);
  const endpointSky = endpoints.map((n) =>
    pickSatellite(s.grid, s.env, { id: n.id, x: n.x, y: n.y, heightM: heights.clientM }, s.satellites, s.backhaul),
  );
  const satConnects = endpoints.length < 2 ? null : endpointSky.every((e) => e.chosen !== null);
  const satCost = costLines([
    { label: 'Satellite terminals (A, B and every user)', count: endpoints.length + cost.userSites, unitUsd: satTerminalUnitUsd(cost) },
  ]);
  const satIssues = commonIssues(satConnects, satCost.totalUsd, sky.coveredPct, cost);
  satIssues.push(
    {
      code: 'per-user-cost',
      severity: 'warn',
      text: `Every additional user needs a terminal of their own (+$${Math.round(satTerminalUnitUsd(cost)).toLocaleString('en-US')} each).`,
    },
    {
      code: 'note',
      severity: 'info',
      text: 'No local links: neighbours talk through orbit, and service follows satellite visibility. Service fees and orbital motion are not modelled.',
    },
  );

  const strategies: StrategyResult[] = [
    {
      id: 'mesh',
      name: 'HaLow relay network (this plan)',
      summary: 'Low masts with relay nodes carrying traffic hop by hop; base stations uplink to the nearest visible satellite.',
      connects: mesh.connects,
      hardware: `${relays.length} relay(s), ${bases.length} base station(s), ${endpoints.length} endpoint(s)`,
      costLines: meshCost.lines,
      totalUsd: meshCost.totalUsd,
      coveragePct: mesh.coverage.coveredPct,
      issues: meshIssues,
    },
    {
      id: 'direct',
      name: 'No relay nodes',
      summary: 'The same radios with no relays: only a direct A–B link and whatever the endpoints and base stations cover on their own.',
      connects: direct.connects,
      hardware: `0 relays, ${bases.length} base station(s), ${endpoints.length} endpoint(s)`,
      costLines: directCost.lines,
      totalUsd: directCost.totalUsd,
      coveragePct: direct.coverage.coveredPct,
      issues: directIssues,
    },
    {
      id: 'towers',
      name: `Traditional tall masts (${cost.towerHeightM} m)`,
      summary: 'Fewer, taller conventional masts carrying the same radio, sited by the same heuristic.',
      connects: towers.connects,
      hardware: `${towerCount} tall mast(s), ${bases.length} base station(s)`,
      costLines: towerCost.lines,
      totalUsd: towerCost.totalUsd,
      coveragePct: towers.coverage.coveredPct,
      issues: towerIssues,
    },
    {
      id: 'satellite',
      name: 'Satellite terminal per user',
      summary: 'No surface network. Every site and user carries its own satellite terminal.',
      connects: satConnects,
      hardware: `${endpoints.length + cost.userSites} satellite terminal(s)`,
      costLines: satCost.lines,
      totalUsd: satCost.totalUsd,
      coveragePct: sky.coveredPct,
      issues: satIssues,
    },
  ];

  return { coverage: { mesh: mesh.coverage, direct: direct.coverage }, strategies, stations };
}
