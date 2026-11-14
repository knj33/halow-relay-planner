import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AssumptionsPanel } from './components/AssumptionsPanel';
import { ComparePanel } from './components/ComparePanel';
import { EnginePanel } from './components/EnginePanel';
import { EnginePrompt } from './components/EnginePrompt';
import { ResultsPanel } from './components/ResultsPanel';
import { RouteDetail } from './components/RouteDetail';
import { AreaPanel, CostPanel, CrewPanel, NodePanel, RadioPanel, TOOLS, ToolPanel, toolHint } from './components/Sidebar';
import { SurveyMap } from './components/SurveyMap';
import type { SafetyLayer, SimView } from './components/SurveyMap';
import { Survey3D } from './components/Survey3D';
import {
  BODIES,
  BODY_IDS,
  areaLimitsFor,
  analyzeNetwork,
  evaluateNetwork,
  exportDeployment,
  gridToGeo,
  heightsOf,
  importDeployment,
  isCostValid,
  isRadioValid,
  makeEnv,
  surveyLayers,
  toEngineNodes,
  explainTraverse,
  geoToGrid,
  isSafetyValid,
} from './engine';
import type { Analysis, NetworkLink, Traverse } from './engine';
import { displayLinks } from './links';
import { DEMO_SITES, PRESETS } from './presets';
import { GLOBE_SOURCES, GlobeView } from './scene/GlobeView';
import { nativeActive, nodeLabels, sameArea, useStore } from './state/store';
import type { Tool } from './state/store';
import { runJob } from './worker/client';
import { whyThisPath } from './whyThisPath';

/** Single-key shortcuts for the map tools (HIG: offer keyboard alternatives to pointer gestures). */
const TOOL_KEYS: Record<string, Tool> = { v: 'select', a: 'setA', b: 'setB', r: 'relay', s: 'base', w: 'waypoint', z: 'zone', m: 'move', f: 'fail', d: 'delete' };
const KEY_OF: Record<Tool, string> = { select: 'V', setA: 'A', setB: 'B', relay: 'R', base: 'S', waypoint: 'W', zone: 'Z', move: 'M', fail: 'F', delete: 'D' };

interface SimStats {
  hops: number | null;
  marginDb: number | null;
  walkM: number | null;
  gapM: number | null;
  /** Labels of working base stations with no path to A. */
  cutBases: string[];
}
type Sim = SimView & { label: string; before: SimStats; after: SimStats | null };
/** Failure-simulation motion: 'auto' follows the system reduce-motion setting. */
type MotionMode = 'on' | 'auto' | 'off';
const MOTION_KEY = 'halow.sim.motion';
function readMotion(): MotionMode {
  try {
    const v = localStorage.getItem(MOTION_KEY);
    return v === 'auto' || v === 'off' ? v : 'on';
  } catch {
    return 'on';
  }
}
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

type Tab = 'plan' | 'compare' | 'assumptions' | 'engine';
const TABS: [Tab, string][] = [
  ['plan', 'Plan'],
  ['compare', 'Compare'],
  ['assumptions', 'Assumptions'],
  ['engine', 'Engine'],
];
type View = 'survey' | '3d' | 'globe';

const TOOL_ICON: Record<Tool, ReactNode> = {
  select: <path d="M5 3 L5 15 L8.5 11.5 L11 17 L13 16 L10.5 10.5 L15 10.5 Z" />,
  setA: (
    <text x="9" y="13.5" textAnchor="middle" fontSize="11" fontFamily="Jost, sans-serif" fill="currentColor" stroke="none" letterSpacing="0.5">
      A
    </text>
  ),
  setB: (
    <text x="9" y="13.5" textAnchor="middle" fontSize="11" fontFamily="Jost, sans-serif" fill="currentColor" stroke="none" letterSpacing="0.5">
      B
    </text>
  ),
  relay: (
    <>
      <circle cx="9" cy="9" r="6" />
      <circle cx="9" cy="9" r="1.6" fill="currentColor" />
    </>
  ),
  base: <rect x="4.5" y="4.5" width="9" height="9" transform="rotate(45 9 9)" />,
  move: <path d="M9 2v14M2 9h14M9 2l-2 2M9 2l2 2M9 16l-2-2M9 16l2-2M2 9l2-2M2 9l2 2M16 9l-2-2M16 9l-2 2" />,
  delete: <path d="M4 4l10 10M14 4L4 14" />,
  waypoint: <path d="M5 16V3l9 3.5L5 10" />,
  zone: <path d="M3 5l6-3 6 4-2 9-8 1z" strokeDasharray="2 2" />,
  fail: <path d="M10 1L4 10h5l-1 7 6-9H9l1-7z" />,
};

function nearestPreset(body: keyof typeof PRESETS, lat: number, lon: number): string | null {
  let best: { name: string; d: number } | null = null;
  for (const p of PRESETS[body]) {
    const d = Math.hypot(p.lat - lat, (p.lon - lon) * Math.cos((lat * Math.PI) / 180));
    if (!best || d < best.d) best = { name: p.name, d };
  }
  return best && best.d < 0.6 ? best.name : null;
}

const fmtCoord = (lat: number, lon: number) => `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lon).toFixed(3)}°${lon >= 0 ? 'E' : 'W'}`;

export function App() {
  const s = useStore();
  const [tab, setTab] = useState<Tab>('plan');
  const [view, setView] = useState<View>('globe');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  const [globeReady, setGlobeReady] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const autoSurvey = useRef(false);

  // Look for the optional native engine once on load. Failure is silent: the browser loader stays in charge.
  useEffect(() => {
    void useStore.getState().probeEngine();
  }, []);

  // Tool shortcuts, ignored while typing or with modifier keys held.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName))) return;
      if (e.key === 'Escape') {
        const st = useStore.getState();
        if (st.zoneDraft) st.cancelZone();
        st.setTool('select');
        return;
      }
      if (e.key === 'Enter' && useStore.getState().zoneDraft) {
        e.preventDefault();
        useStore.getState().finishZone();
        return;
      }
      const tool = TOOL_KEYS[e.key.toLowerCase()];
      if (tool) useStore.getState().setTool(tool);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const { body, kFactor, radio, backhaul, cost, planner, nodes, satellites, terrain, terrainMeta, terrainArea, area } = s;
  const kValid = Number.isFinite(kFactor) && kFactor >= 0.5 && kFactor <= 10;
  const backhaulValid =
    Number.isFinite(backhaul.baseAntennaHeightM) && backhaul.baseAntennaHeightM >= 0.1 && backhaul.baseAntennaHeightM <= 200 &&
    Number.isFinite(backhaul.minElevationDeg) && backhaul.minElevationDeg >= 0 && backhaul.minElevationDeg <= 80;
  const plannerValid = Number.isFinite(planner.gridDivisions) && (planner.gridDivisions === 0 || (planner.gridDivisions >= 4 && planner.gridDivisions <= 32));
  const inputsValid = isRadioValid(radio) && isCostValid(cost) && kValid && backhaulValid;

  const env = useMemo(() => makeEnv(body, kFactor), [body, kFactor]);
  const heights = useMemo(() => heightsOf(radio, backhaul, cost), [radio, backhaul, cost]);
  const labels = useMemo(() => nodeLabels(nodes), [nodes]);

  // Only nodes inside the fitted area take part in the grid-based calculations.
  const converted = useMemo(() => (area ? toEngineNodes(body, area, nodes) : { inside: [], outside: nodes.map((n) => n.id) }), [body, area, nodes]);
  const engineNodes = converted.inside;
  const gridReady = !!terrain && !!area && !!terrainArea && sameArea(area, terrainArea) && s.terrainStatus === 'ready';

  const links = useMemo(
    () => (gridReady && terrain && inputsValid ? evaluateNetwork(terrain, env, radio, heights, engineNodes) : []),
    [gridReady, terrain, inputsValid, env, radio, heights, engineNodes],
  );
  const net = useMemo(() => analyzeNetwork(engineNodes, links), [engineNodes, links]);
  const shownLinks = useMemo(() => displayLinks(links, engineNodes, radio), [links, engineNodes, radio]);

  // Survey layers depend only on the grid; the walking route follows the radio route (or A to B).
  const layers = useMemo(() => (gridReady && terrain ? surveyLayers(terrain, { sourceResolutionM: terrainMeta?.resolutionM }) : null), [gridReady, terrain, terrainMeta]);
  // Crew waypoints and no-go zones in the grid frame of the loaded area.
  const R = BODIES[body].radiusM;
  const wpGrid = useMemo(() => (terrainArea ? s.waypoints.map((w, i) => ({ id: w.id, label: `W${i + 1}`, ...geoToGrid(terrainArea, w, R) })) : []), [terrainArea, s.waypoints, R]);
  const zonesGrid = useMemo(() => (terrainArea ? s.zones.map((z, i) => ({ id: z.id, label: `Z${i + 1}`, pts: z.points.map((p) => geoToGrid(terrainArea, p, R)) })) : []), [terrainArea, s.zones, R]);
  const draftGrid = useMemo(() => (terrainArea && s.zoneDraft ? s.zoneDraft.map((p) => geoToGrid(terrainArea, p, R)) : null), [terrainArea, s.zoneDraft, R]);

  // The crew's walking route: safest path from A through the waypoints to B that keeps radio coverage.
  // Runs on its own worker so it never waits behind the coverage/cost analysis.
  const [trav, setTrav] = useState<{ result: Traverse | null; layer: SafetyLayer; seq: number; stops: { x: number; y: number }[]; safety: typeof s.safety } | null>(null);
  const [travBusy, setTravBusy] = useState(false);
  const travSeq = useRef(0);
  const safetyOk = isSafetyValid(s.safety);
  useEffect(() => {
    if (!gridReady || !terrain || !terrainArea || !inputsValid || !safetyOk) {
      setTrav(null);
      setTravBusy(false);
      return;
    }
    const a = engineNodes.find((n) => n.kind === 'A');
    const b = engineNodes.find((n) => n.kind === 'B');
    const stops = a && b ? [{ x: a.x, y: a.y }, ...wpGrid.map((w) => ({ x: w.x, y: w.y })), { x: b.x, y: b.y }] : [];
    let cancelled = false;
    setTravBusy(true);
    const timer = setTimeout(() => {
      runJob({
        type: 'traverse',
        grid: terrain,
        gridKey: `${terrainMeta?.id ?? ''}|${terrainArea.centre.lat}|${terrainArea.centre.lon}|${terrainArea.sizeM}|${terrain.cols}`,
        env,
        radio,
        heights,
        nodes: engineNodes,
        clientHeightM: cost.clientHeightM,
        stops,
        zones: zonesGrid.map((z) => z.pts),
        safety: s.safety,
      })
        .then((r) => {
          if (cancelled) return;
          setTrav({ result: r.traverse, layer: { coverage: r.coverage, hazards: r.hazards }, seq: ++travSeq.current, stops, safety: s.safety });
          setTravBusy(false);
        })
        .catch((err: Error) => {
          if (cancelled) return;
          setTravBusy(false);
          useStore.getState().setNotice({ kind: 'error', text: `Crew route failed: ${err.message}` });
        });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [gridReady, terrain, terrainArea, terrainMeta, inputsValid, safetyOk, engineNodes, wpGrid, zonesGrid, env, radio, heights, cost.clientHeightM, s.safety]);
  const walk = trav?.result ?? null;
  // Why this path: measured against the same grid, hazard and coverage maps the search used.
  const why = useMemo(() => {
    if (!trav?.result || !terrain || !area) return null;
    const e = explainTraverse(terrain, trav.layer.hazards, trav.layer.coverage, trav.stops, trav.result, trav.safety);
    return whyThisPath(e, trav.safety, { areaKm: Math.round(area.sizeM / 1000), zones: s.zones.length });
  }, [trav, terrain, area, s.zones.length]);

  // Failure simulation: a node goes dark (or comes back), then the radio route and the crew route re-plan.
  const [sim, setSim] = useState<Sim | null>(null);
  const [motionMode, setMotionMode] = useState<MotionMode>(readMotion);
  const motion = motionMode === 'on' || (motionMode === 'auto' && !reducedMotion());
  const chooseMotion = (m: MotionMode) => {
    setMotionMode(m);
    try {
      localStorage.setItem(MOTION_KEY, m);
    } catch {
      /* private mode */
    }
  };
  const simSeq = useRef(0);
  const statsNow = (): SimStats => ({
    hops: net.connected ? net.route.length - 1 : null,
    marginDb: net.minMarginDb,
    walkM: walk?.lengthM ?? null,
    gapM: walk?.uncoveredM ?? null,
    cutBases: net.bases.filter((b) => b.hopsFromA === null && engineNodes.find((n) => n.id === b.id)?.enabled).map((b) => labels.get(b.id) ?? b.id),
  });
  const routePts = (ids: string[]) => ids.map((id) => engineNodes.find((n) => n.id === id)).filter((n): n is NonNullable<typeof n> => !!n).map((n) => ({ x: n.x, y: n.y }));
  const failNode = (id: string) => {
    const n = useStore.getState().nodes.find((x) => x.id === id);
    if (!n) return;
    if (n.kind === 'A' || n.kind === 'B') {
      useStore.getState().setNotice({ kind: 'info', text: 'The failure simulation knocks out relays and base stations; endpoints A and B stay up.' });
      return;
    }
    const seq = ++simSeq.current;
    const kind = n.enabled ? 'fail' : 'restore';
    setSim({ seq, nodeId: id, label: labels.get(id) ?? id, kind, phase: 'failing', ghostRoute: routePts(net.route), ghostWalk: walk?.points ?? null, before: statsNow(), after: null });
    window.setTimeout(
      () => {
        useStore.getState().updateNode(id, { enabled: kind === 'restore' });
        setSim((p) => (p && p.seq === seq ? { ...p, phase: 'rerouting' } : p));
      },
      motion ? 900 : 0,
    );
  };
  // The re-planned crew route arrives from the worker: the reroute is complete.
  useEffect(() => {
    setSim((p) => (p && p.phase === 'rerouting' ? { ...p, phase: 'done', after: statsNow() } : p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trav?.seq]);
  const randomFailure = () => {
    const live = (id: string) => {
      const n = engineNodes.find((x) => x.id === id);
      return !!n && n.enabled && (n.kind === 'relay' || n.kind === 'base');
    };
    const onRoute = net.route.filter(live);
    const pool = onRoute.length ? onRoute : engineNodes.filter((n) => live(n.id)).map((n) => n.id);
    if (!pool.length) {
      s.setNotice({ kind: 'info', text: 'There is no working relay or base station to fail.' });
      return;
    }
    failNode(pool[Math.floor(Math.random() * pool.length)]);
  };
  const restoreAll = () => {
    for (const n of nodes) if (!n.enabled) s.updateNode(n.id, { enabled: true });
    setSim(null);
  };
  const onNodeClick = (id: string) => (s.tool === 'fail' ? failNode(id) : s.nodeClick(id));
  const globeSurvey = useMemo(() => (layers ? { layers, walk: walk?.points ?? null } : null), [layers, walk]);

  // Coverage maps and the architecture comparison run in the worker, debounced.
  useEffect(() => {
    if (!gridReady || !terrain || !inputsValid || !plannerValid) {
      setAnalysis(null);
      setBusy(false);
      return;
    }
    let cancelled = false;
    setBusy(true);
    const timer = setTimeout(() => {
      runJob({ type: 'analyze', scenario: { grid: terrain, env, radio, backhaul, cost, planner, nodes: engineNodes, satellites } })
        .then((a) => {
          if (cancelled) return;
          setAnalysis(a);
          setBusy(false);
        })
        .catch((err: Error) => {
          if (cancelled) return;
          setBusy(false);
          useStore.getState().setNotice({ kind: 'error', text: `Analysis failed: ${err.message}` });
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [gridReady, terrain, inputsValid, plannerValid, env, radio, backhaul, cost, planner, engineNodes, satellites]);

  const hasA = engineNodes.some((n) => n.kind === 'A');
  const hasB = engineNodes.some((n) => n.kind === 'B');

  // Open the survey map the first time both endpoints sit on a loaded grid; the globe stays one click away.
  useEffect(() => {
    autoSurvey.current = false;
    setView('globe');
  }, [body]);
  useEffect(() => {
    if (gridReady && hasA && hasB && !autoSurvey.current) {
      autoSurvey.current = true;
      setView('survey');
      // Both endpoints exist, so a stray click on the map should not move A or B.
      const st = useStore.getState();
      if (st.tool === 'setA' || st.tool === 'setB') st.setTool('select');
    }
  }, [gridReady, hasA, hasB]);

  const planBlockedReason = !area
    ? 'Place endpoint A and B on the globe first.'
    : !gridReady
      ? s.terrainStatus === 'error'
        ? 'Terrain failed to load.'
        : 'Elevation for the planning area is still loading.'
      : !inputsValid || !plannerValid
        ? 'Fix the highlighted settings before planning.'
        : converted.outside.length > 0
          ? 'Some nodes are outside the planning area. Move them inside, enlarge the area, or turn on auto-fit.'
          : !hasA || !hasB
            ? 'Place endpoints A and B inside the planning area.'
            : null;

  const onPlan = async () => {
    const st = useStore.getState();
    if (!st.terrain || !st.area || planBlockedReason) return;
    st.setPlan({ status: 'running' });
    setTab('plan');
    try {
      const keep = st.nodes.filter((n) => !(n.kind === 'relay' && n.origin === 'auto'));
      const keepInside = toEngineNodes(st.body, st.area, keep).inside;
      const result = await runJob({ type: 'plan', grid: st.terrain, env, radio: st.radio, heights, options: st.planner, nodes: keepInside });
      if (useStore.getState().terrain !== st.terrain) return; // environment changed while planning
      if (result.status === 'ok') useStore.getState().applyPlan(result, st.area);
      useStore.getState().setPlan({ status: result.status, result });
    } catch (err) {
      useStore.getState().setPlan({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  const onExport = () => {
    if (!terrainMeta) return;
    const file = exportDeployment({ body, kFactor, radio, planner, cost, backhaul, satellites, nodes, area, autoFit: s.autoFit, waypoints: s.waypoints, zones: s.zones, safety: s.safety }, terrainMeta);
    const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `relay-plan-${body}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImport = async (file: File) => {
    try {
      const res = importDeployment(JSON.parse(await file.text()));
      if (!res.ok) {
        s.setNotice({ kind: 'error', text: `Import rejected: ${res.errors.slice(0, 4).join(' ')}` });
        return;
      }
      await s.importState(res.state);
      s.setNotice({ kind: 'info', text: `Imported ${res.state.nodes.length} node(s) for ${BODIES[res.state.body].name}. ${res.warnings.join(' ')}` });
    } catch {
      s.setNotice({ kind: 'error', text: 'Import rejected: the file is not valid JSON.' });
    }
  };

  const coverage = s.overlay === 'off' || !analysis ? null : analysis.coverage[s.overlay];
  const outsideCount = converted.outside.length;
  const running = s.plan.status === 'running';
  const name = (id: string) => labels.get(id) ?? id;

  const site = area ? (nearestPreset(body, area.centre.lat, area.centre.lon) ?? 'Planning area') : 'No site chosen';
  const siteShort = site.split(/[,(]/)[0].trim();
  const coords = area ? fmtCoord(area.centre.lat, area.centre.lon) : '—';

  const routeHops: NetworkLink[] = net.connected ? net.hops : links.filter((l) => (l.a === 'A' && l.b === 'B') || (l.a === 'B' && l.b === 'A'));
  const autoRelays = engineNodes.filter((n) => n.kind === 'relay' && n.origin === 'auto').length;
  const baseCount = engineNodes.filter((n) => n.kind === 'base').length;
  const routeTitle = !hasA || !hasB ? 'A to B' : net.connected ? `A to B in ${net.route.length - 1} hop${net.route.length === 2 ? '' : 's'}` : 'A to B is blocked';
  const routeMeta = [net.topology === 'incomplete' ? 'Waiting for endpoints' : net.topology[0].toUpperCase() + net.topology.slice(1), `${autoRelays} auto relay${autoRelays === 1 ? '' : 's'}`, `${baseCount} base`].join('  ·  ');
  const coarse = terrainMeta && (terrainMeta.synthetic || terrainMeta.id.endsWith('-coarse'));

  // The survey works without any nodes: with no area yet it opens one at the centre of the globe view.
  const openSurvey = (mode: View = 'survey') => {
    setView(mode);
    if (!area) {
      const st = useStore.getState();
      const steps = areaLimitsFor(body, nativeActive(st)).steps;
      void st.setFixedArea(st.viewCentre ?? DEMO_SITES[body], steps[Math.min(3, steps.length - 1)]);
    }
  };

  const onSurveyPick = (x: number, y: number) => {
    if (!terrainArea) return;
    const p = gridToGeo(terrainArea, x, y, BODIES[body].radiusM);
    s.surfaceClick(p.lat, p.lon);
  };

  return (
    <div className={`app${motion ? ' motion-on' : ''}`} data-body={body}>
      <span className="guide-line left" aria-hidden="true" />
      <span className="guide-line right" aria-hidden="true" />

      <header className="masthead">
        <div className="brand">
          <h1 className="wordmark">HALOW</h1>
          <span className="rule" aria-hidden="true" />
          <span className="cap">Relay planner for {BODIES[body].name === 'Moon' ? 'the Moon' : BODIES[body].name}</span>
        </div>

        <nav className="mast-nav" aria-label="Sections">
          <div role="tablist" aria-label="Sections" className="mast-tabs">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`panel-${id}`} className="cap-link" onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
          <div className="body-switch" role="radiogroup" aria-label="Celestial body">
            {BODY_IDS.map((b) => (
              <button key={b} type="button" role="radio" aria-checked={body === b} className="cap-link" onClick={() => void s.setBody(b)}>
                {BODIES[b].name}
              </button>
            ))}
          </div>
        </nav>

        <div className="mast-site">
          <span className="cap hi" title={site}>
            {siteShort}
          </span>
          <span className="num coords">{coords}</span>
          <div className="mast-files">
            <button type="button" className="cap-link" onClick={onExport} disabled={!terrainMeta || !area}>
              Export
            </button>
            <button type="button" className="cap-link" onClick={() => fileInput.current?.click()}>
              Import
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              hidden
              aria-label="Import deployment JSON file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onImport(f);
                e.target.value = '';
              }}
            />
          </div>
        </div>
      </header>

      {s.notice && (
        <div className={`notice ${s.notice.kind}`} role={s.notice.kind === 'error' ? 'alert' : 'status'}>
          <span>{s.notice.text}</span>
          <button type="button" className="icon-btn" onClick={() => s.setNotice(null)} aria-label="Dismiss message">
            <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.1" aria-hidden="true">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        </div>
      )}

      <EnginePrompt />

      <section className="map-frame" aria-label="Map">
        <div className={`globe-layer${view === 'globe' ? '' : ' is-hidden'}`} aria-hidden={view !== 'globe'}>
          <GlobeView
            body={body}
            area={area}
            grid={gridReady ? terrain : null}
            nodes={nodes}
            labels={labels}
            links={shownLinks}
            route={net.route}
            criticalIds={net.criticalIds}
            satellites={terrain ? satellites : []}
            stations={gridReady ? (analysis?.stations ?? []) : []}
            coverage={coverage}
            survey={globeSurvey}
            reliefScale={s.globeRelief}
            selectedId={s.selectedId}
            fly={s.fly}
            resetSignal={resetSignal}
            onSurfaceClick={s.surfaceClick}
            onNodeClick={onNodeClick}
            onCameraCentre={s.setViewCentre}
            onFirstTiles={() => setGlobeReady(body)}
          />
        </div>

        {view === 'survey' && gridReady && terrain && layers && (
          <SurveyMap
            grid={terrain}
            layers={layers}
            nodes={engineNodes}
            labels={labels}
            links={shownLinks}
            route={net.route}
            criticalIds={net.criticalIds}
            walk={walk}
            waypoints={wpGrid}
            zones={zonesGrid}
            zoneDraft={draftGrid}
            safetyLayer={trav?.layer ?? null}
            sim={sim}
            motion={motion}
            walkSeq={trav?.seq ?? 0}
            stations={analysis?.stations ?? []}
            coverage={coverage}
            selectedId={s.selectedId}
            placing={!['select', 'delete', 'fail'].includes(s.tool)}
            onPick={onSurveyPick}
            onNodeClick={onNodeClick}
            onWaypointClick={(id) => s.tool === 'delete' && s.removeWaypoint(id)}
            onZoneClick={(id) => s.tool === 'delete' && s.removeZone(id)}
            onFinishZone={s.finishZone}
          />
        )}
        {view === '3d' && gridReady && terrain && layers && (
          <Survey3D
            grid={terrain}
            layers={layers}
            radiusM={env.radiusM * env.kFactor}
            nodes={engineNodes}
            labels={labels}
            links={shownLinks}
            route={net.route}
            walk={walk}
            heights={heights}
            selectedId={s.selectedId}
            onNodeClick={(id) => (s.tool === 'fail' ? failNode(id) : s.select(id))}
          />
        )}
        {view !== 'globe' && !gridReady && s.terrainStatus !== 'loading' && s.terrainStatus !== 'error' && (
          <div className="view-state" role="status">
            <p className="body">The survey map draws rivers, craters, contours and walkable ground from the planning area's elevation. Survey the spot under the globe's centre, or try the demo.</p>
            <div className="row gap wrap">
              <button type="button" className="btn-primary" onClick={() => openSurvey(view)}>
                Survey here
              </button>
              <button type="button" className="btn-ghost" onClick={s.loadDemo}>
                Load demo
              </button>
              <button type="button" className="btn-ghost" onClick={() => setView('globe')}>
                Back to globe
              </button>
            </div>
          </div>
        )}

        {s.terrainStatus === 'loading' && (
          <div className={`view-state${view === 'globe' ? ' compact' : ''}`} role="status">
            <div className="spinner" aria-hidden="true" />
            <span className="cap">Streaming elevation for the {(area?.sizeM ?? 0) / 1000} km planning area</span>
            {s.terrainProgress && <span className="muted">{s.terrainProgress}</span>}
          </div>
        )}
        {s.terrainStatus === 'error' && (
          <div className="view-state compact" role="alert">
            <p className="body">Terrain failed to load: {s.terrainError}</p>
            <div className="row gap">
              <button type="button" className="btn-ghost" onClick={() => void s.loadTerrain()}>
                Retry
              </button>
              <button type="button" className="btn-ghost" onClick={s.zoomToArea}>
                Zoom to area
              </button>
            </div>
          </div>
        )}

        <div className="map-info">
          <div className="view-switch" role="radiogroup" aria-label="Map view">
            {(
              [
                ['survey', 'Survey'],
                ['3d', '3D relief'],
                ['globe', 'Globe'],
              ] as [View, string][]
            ).map(([id, label]) => (
              <button key={id} type="button" role="radio" aria-checked={view === id} className="cap-link" onClick={() => (id === 'globe' ? setView(id) : openSurvey(id))}>
                {label}
              </button>
            ))}
            <span className="view-sep" aria-hidden="true" />
            <button
              type="button"
              className="cap-link demo-link"
              title="Open the premade 200 km Mars scenario at a SpaceX Starship candidate landing site, with relays already planned"
              onClick={() => {
                void s.loadPremadeDemo().then(() => setView('survey'));
              }}
            >
              Demo
            </button>
          </div>
          {area && <span className="cap bright">Planning area {(area.sizeM / 1000).toFixed(0)} km</span>}
          {hasA && hasB && (
            <button type="button" className="btn-primary map-plan" onClick={() => void onPlan()} disabled={!!planBlockedReason || running}>
              {running ? 'Planning' : 'Plan relays'}
            </button>
          )}
          {hasA && hasB && gridReady && (
            <div className="sim-controls" role="group" aria-label="Failure simulation">
              <span className="cap">Failure simulation</span>
              <div className="row gap wrap">
                <button type="button" className="bar-btn" aria-pressed={s.tool === 'fail'} onClick={() => s.setTool(s.tool === 'fail' ? 'select' : 'fail')} title="Then click a relay or base station on the map (F)">
                  Pick a node
                </button>
                <button type="button" className="bar-btn" onClick={randomFailure} title="Knock out a random working relay or base station on the radio route">
                  Random failure
                </button>
                <button type="button" className="bar-btn" onClick={restoreAll} disabled={!nodes.some((n) => !n.enabled)}>
                  Restore all
                </button>
              </div>
              <div className="motion-switch" role="radiogroup" aria-label="Animation">
                <span className="cap small">Motion</span>
                {(
                  [
                    ['on', 'On'],
                    ['auto', 'Auto'],
                    ['off', 'Off'],
                  ] as [MotionMode, string][]
                ).map(([m, l]) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={motionMode === m}
                    className="cap-link"
                    title={m === 'auto' ? 'Follow the system reduce-motion setting' : m === 'on' ? 'Always animate the failure simulation and signal flow' : 'No animation; changes apply at once'}
                    onClick={() => chooseMotion(m)}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
          )}
          {terrainMeta && (
            <span className={`cap${coarse ? ' warn-text' : ''}`} title={terrainMeta.attribution}>
              {terrainMeta.synthetic ? 'Synthetic demonstration terrain' : terrainMeta.label}
            </span>
          )}
          {why && (
            <details className="why" open>
              <summary className="cap hi">Why this path</summary>
              <div className="why-body" aria-live="polite">
                {why.map((t, i) => (
                  <p key={i}>{t}</p>
                ))}
              </div>
            </details>
          )}
          {outsideCount > 0 && <span className="cap warn-text">{outsideCount} node(s) outside the area are not evaluated</span>}
          {!nodes.length && view === 'globe' && (
            <p className="empty-hint body">
              Click the surface to set endpoint A. Drag to spin, scroll to zoom, right-drag to tilt. Or load the demo from the Planner panel below.
            </p>
          )}
        </div>

        <div className="map-tools" role="radiogroup" aria-label="Map click tool" hidden={view === '3d'}>
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={s.tool === t.id}
              aria-label={t.label}
              aria-keyshortcuts={KEY_OF[t.id]}
              title={`${t.label} (${KEY_OF[t.id]}). ${t.hint}`}
              data-tip={`${t.label}  ${KEY_OF[t.id]}`}
              className={`tool-btn tool-${t.id}`}
              onClick={() => s.setTool(t.id)}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
                {TOOL_ICON[t.id]}
              </svg>
            </button>
          ))}
          {view === 'globe' && (
            <>
              <span className="tool-sep" aria-hidden="true" />
              <button type="button" className="tool-btn" aria-label="Zoom to planning area" title="Zoom to planning area" onClick={s.zoomToArea} disabled={!area}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
                  <circle cx="9" cy="9" r="6" />
                  <path d="M9 1v4M9 13v4M1 9h4M13 9h4" />
                </svg>
              </button>
              <button type="button" className="tool-btn" aria-label="Reset globe view" title="Reset globe view" onClick={() => setResetSignal((n) => n + 1)}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
                  <path d="M14 9a5 5 0 1 1-1.5-3.6" />
                  <path d="M13 2v4h-4" />
                </svg>
              </button>
            </>
          )}
        </div>

        {view === 'globe' && body === 'earth' && (
          <label className="relief-slider">
            <span className="cap">Relief {s.globeRelief.toFixed(0)}× (display only)</span>
            <input type="range" min={1} max={30} step={1} value={s.globeRelief} onChange={(e) => s.setGlobeRelief(Number(e.target.value))} />
          </label>
        )}

        {view === 'globe' && <p className="globe-credit">{GLOBE_SOURCES[body].credit}</p>}

        {sim && (
          <div className={`sim-banner phase-${sim.phase} kind-${sim.kind}`} role="status" aria-live="polite">
            <span className="sim-dot" aria-hidden="true" />
            <span className="sim-text">{simMessage(sim)}</span>
            <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setSim(null)}>
              ×
            </button>
          </div>
        )}

        <div className="map-status">
          <span className="cap">
            {view === '3d'
              ? 'Drag to rotate, right-drag to pan, scroll to zoom. Place nodes in Survey or Globe'
              : view === 'survey' && s.tool === 'select'
                ? 'Drag to pan, scroll or pinch to zoom, click a node to select it'
                : toolHint(s.tool)}
          </span>
          {busy && <span className="cap">Updating coverage</span>}
          {travBusy && <span className="cap">Recalculating crew route</span>}
          {view === 'globe' && globeReady !== body && (
            <span className="cap">
              <span className="spinner tiny" aria-hidden="true" /> Streaming {BODIES[body].name} imagery
            </span>
          )}
        </div>
      </section>

      <main id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="content">
        {tab === 'plan' && (
          <>
            <div className="plan-layout">
              <div className="plan-main">
                {area ? (
                  <ResultsPanel nodes={engineNodes} labels={labels} net={net} shownLinks={shownLinks} analysis={analysis} plan={s.plan} inputsValid={inputsValid} requiredMarginDb={radio.requiredMarginDb} walk={walk} />
                ) : (
                  <div className="readout-empty">
                    <h2 className="cap hi">No planning area yet</h2>
                    <p className="body">Click the globe to place endpoint A, then B. The app fits an elevation area around your nodes, streams it, and draws the survey map once it is ready. Or load the demo scenario from the Planner panel.</p>
                  </div>
                )}
              </div>

              <aside className="plan-aside" aria-label="Route detail">
                <RouteDetail grid={gridReady ? terrain : null} env={env} radio={radio} heights={heights} nodes={engineNodes} labels={labels} hops={routeHops} title={routeTitle} meta={routeMeta}>
                  <div className="route-actions">
                    <button type="button" className="btn-primary" onClick={() => void onPlan()} disabled={!!planBlockedReason || running}>
                      {running ? 'Planning' : 'Plan relays'}
                    </button>
                    <button type="button" className="btn-ghost" onClick={onExport} disabled={!terrainMeta || !area}>
                      Export plan
                    </button>
                  </div>
                  {planBlockedReason && <p className="note">{planBlockedReason}</p>}
                  {net.connected && <p className="note">Route {net.route.map(name).join(' to ')}.</p>}
                </RouteDetail>

                <div className="source-card">
                  <svg width="64" height="88" viewBox="0 0 64 88" aria-hidden="true">
                    <defs>
                      <radialGradient id="src-g" cx="45%" cy="40%" r="70%">
                        <stop offset="0" stopColor="#8a4e34" />
                        <stop offset="1" stopColor="#2a160e" />
                      </radialGradient>
                    </defs>
                    <ellipse cx="32" cy="44" rx="30" ry="42" fill="url(#src-g)" />
                    <g fill="none" stroke="#d9b46c" strokeOpacity=".55" strokeWidth=".8">
                      <ellipse cx="32" cy="46" rx="9" ry="14" />
                      <ellipse cx="32" cy="46" rx="17" ry="24" />
                      <ellipse cx="32" cy="46" rx="25" ry="34" />
                    </g>
                    <ellipse cx="32" cy="44" rx="30" ry="42" fill="none" stroke="rgba(236,205,178,.35)" />
                  </svg>
                  <div>
                    <h3 className="cap hi">Terrain source</h3>
                    <p className="body small">{terrainMeta ? terrainMeta.attribution : 'Elevation loads once a planning area exists.'}</p>
                  </div>
                </div>
              </aside>
            </div>

            <section className="setup" aria-labelledby="setup-h">
              <h2 id="setup-h" className="cap hi">
                Setup
              </h2>
              <div className="setup-grid">
                <ToolPanel onPlan={() => void onPlan()} canPlan={!planBlockedReason} planBlockedReason={planBlockedReason} />
                <NodePanel />
                <CrewPanel />
                <AreaPanel />
                <RadioPanel />
                <CostPanel />
              </div>
            </section>
          </>
        )}

        {tab === 'compare' && (
          <div className="page-section">
            {area ? (
              <ComparePanel analysis={analysis} busy={busy} cost={cost} overlay={s.overlay} setOverlay={s.setOverlay} inputsValid={inputsValid && plannerValid && gridReady} />
            ) : (
              <div className="readout-empty">
                <h2 className="cap hi">No planning area yet</h2>
                <p className="body">The cost and coverage comparison needs at least one placed node.</p>
              </div>
            )}
          </div>
        )}
        {tab === 'assumptions' && (
          <div className="page-section">
            <AssumptionsPanel body={body} terrain={terrainMeta} />
          </div>
        )}
        {tab === 'engine' && (
          <div className="page-section narrow">
            <EnginePanel />
          </div>
        )}
      </main>

      <footer className="footer">
        <span className="cap small">Illustrative placeholders, not mission data</span>
        <span className="cap small">
          k = {BODIES[body].kFactorEditable ? kFactor.toFixed(2) : '1'}  ·  R {(BODIES[body].radiusM / 1000).toLocaleString('en-US')} km
        </span>
        <span className="cap small">{BODIES[body].name}</span>
      </footer>
    </div>
  );
}

const km = (m: number | null) => (m === null ? '–' : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

function simMessage(sim: Sim): string {
  const { label, kind, phase, before, after } = sim;
  if (phase === 'failing') return kind === 'fail' ? `${label} is going dark…` : `${label} is coming back online…`;
  if (phase === 'rerouting') return kind === 'fail' ? `${label} is down. Rerouting the radio network and the crew path…` : `${label} is back. Re-planning…`;
  const a = after!;
  const radio = a.hops === null ? 'A and B are cut off from each other' : `radio route ${a.hops} hop${a.hops === 1 ? '' : 's'}${before.hops !== null && before.hops !== a.hops ? ` (was ${before.hops})` : ''}, weakest link ${a.marginDb?.toFixed(1) ?? '–'} dB`;
  const dWalk = a.walkM !== null && before.walkM !== null ? a.walkM - before.walkM : 0;
  const walk = a.walkM === null ? '' : `; crew path ${km(a.walkM)}${Math.abs(dWalk) >= 50 ? ` (${dWalk > 0 ? '+' : '−'}${km(Math.abs(dWalk))})` : ''}, ${a.gapM ? `${km(a.gapM)} without signal` : 'signal the whole way'}`;
  const newlyCut = a.cutBases.filter((b) => !before.cutBases.includes(b));
  const cut = newlyCut.length ? `; ${newlyCut.join(', ')} lost contact with the network` : '';
  return `${label} ${kind === 'fail' ? 'down' : 'restored'}: ${radio}${walk}${cut}.`;
}
