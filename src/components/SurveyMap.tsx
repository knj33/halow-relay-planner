import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react';
import { sampleElevation } from '../engine';
import type { CoverageMap, HeightGrid, NetworkLink, SiteNode, StationBackhaul, SurveyLayers, Traverse } from '../engine';
import { NO_GO_SLOPE_DEG, buildPaths, buildRasters, coverageCanvas, drawSurvey, smooth } from '../survey/draw';
import type { Pt } from '../survey/draw';
import { MAX_SIDE, tileCacheFor } from '../survey/tileCache';
import { PALETTE, STATUS_COLOR } from '../theme';

export { NO_GO_SLOPE_DEG };

/** What the failure simulation is showing; see App. */
export interface SimView {
  seq: number;
  nodeId: string;
  kind: 'fail' | 'restore';
  phase: 'failing' | 'rerouting' | 'done';
  /** Radio route and crew route before the change, faded out while the new ones draw in. */
  ghostRoute: Pt[];
  ghostWalk: Pt[] | null;
}

/** Hazard and coverage rasters from the traverse worker (grid nodes, row 0 = south). */
export interface SafetyLayer {
  coverage: Uint8Array;
  hazards: Uint8Array;
}

function safetyCanvas(grid: HeightGrid, layer: SafetyLayer): HTMLCanvasElement {
  const { cols, rows } = grid;
  const img = new ImageData(cols, rows);
  for (let r = 0; r < rows; r++) {
    const dst = (rows - 1 - r) * cols;
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const o = (dst + c) * 4;
      const h = layer.hazards[i];
      if (h === 4) img.data.set([228, 106, 90, 115], o);
      else if (h === 2 || h === 3) img.data.set([228, 106, 90, 72], o);
      else if (h === 1) img.data.set([227, 184, 92, 46], o);
      else if (layer.coverage[i] === 0) img.data.set([8, 5, 3, 110], o);
    }
  }
  const c = document.createElement('canvas');
  c.width = cols;
  c.height = rows;
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c;
}


interface Props {
  grid: HeightGrid;
  layers: SurveyLayers;
  nodes: SiteNode[];
  labels: Map<string, string>;
  links: NetworkLink[];
  route: string[];
  criticalIds: string[];
  walk: Traverse | null;
  waypoints: { id: string; label: string; x: number; y: number }[];
  zones: { id: string; label: string; pts: Pt[] }[];
  zoneDraft: Pt[] | null;
  safetyLayer: SafetyLayer | null;
  sim: SimView | null;
  /** Animate the failure simulation and the signal flow (the user's Motion setting). */
  motion: boolean;
  /** Bumps when a new crew route arrives, to replay its draw-in animation after a failure. */
  walkSeq: number;
  onWaypointClick: (id: string) => void;
  onZoneClick: (id: string) => void;
  onFinishZone: () => void;
  stations: StationBackhaul[];
  coverage: CoverageMap | null;
  selectedId: string | null;
  placing: boolean;
  onPick: (x: number, y: number) => void;
  onNodeClick: (id: string) => void;
}

interface View {
  cx: number;
  cy: number;
  /** Multiple of the scale that fits the whole area in the frame. */
  zoom: number;
}

function niceLength(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f < 2 ? 1 : f < 5 ? 2 : 5) * p;
}

const fmtLen = (m: number) => (m >= 1000 ? `${m / 1000} km` : `${m} m`);

/**
 * Overscan: the raster and the vector layer are drawn this fraction of the frame beyond each
 * edge, so a pan shows already-drawn map instead of blank ground until the gesture settles.
 */
const OVERSCAN = 0.2;
/** A wheel or pinch zoom is committed (React re-render + redraw) this long after the last event. */
const SETTLE_MS = 140;

/** Memoised: App re-renders for many reasons that do not concern the map. */
export const SurveyMap = memo(SurveyMapImpl);

function SurveyMapImpl({ grid, layers, nodes, labels, links, route, criticalIds, walk, waypoints, zones, zoneDraft, safetyLayer, sim, motion, walkSeq, stations, coverage, selectedId, placing, onPick, onNodeClick, onWaypointClick, onZoneClick, onFinishZone }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lensRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  // `view` is the committed view: what React rendered and the canvas holds. During a gesture the
  // live view runs ahead in `liveRef` and is shown by a CSS transform of the drawn stage.
  const [view, setViewRaw] = useState<View | null>(null);
  const liveRef = useRef<View | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [showSafety, setShowSafety] = useState(true);
  const W = grid.widthM;
  const H = grid.heightM;

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = box.w > 0 && box.h > 0 ? Math.min(box.w / W, box.h / H) : 1;
  const coverZoom = box.w > 0 && box.h > 0 ? Math.max(box.w / W, box.h / H) / fit : 1;
  // Zoom stops at twice the top cached level's resolution, so every zoom level is served from the cache.
  const dprNow = Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
  const maxZoom = Math.max(coverZoom * 1.5, (2 * MAX_SIDE) / (W * fit * dprNow));

  const clamp = useCallback(
    (v: View): View => {
      const zoom = Math.min(maxZoom, Math.max(1, v.zoom));
      const s = fit * zoom;
      const vw = box.w / s;
      const vh = box.h / s;
      const cx = vw >= W ? W / 2 : Math.min(W - vw / 2, Math.max(vw / 2, v.cx));
      const cy = vh >= H ? H / 2 : Math.min(H - vh / 2, Math.max(vh / 2, v.cy));
      return { cx, cy, zoom };
    },
    [box.w, box.h, fit, maxZoom, W, H],
  );
  // Commit a view now (buttons, keys, fit-on-open). Functional updates start from the live view, so they compose with a gesture in flight.
  const setView = useCallback(
    (v: View | ((p: View) => View)) =>
      setViewRaw((p) => {
        const base = liveRef.current ?? p ?? { cx: W / 2, cy: H / 2, zoom: 1 };
        const n = clamp(typeof v === 'function' ? v(base) : v);
        liveRef.current = n;
        return n;
      }),
    [clamp, W, H],
  );

  // A new grid opens as large as possible (filling the frame) while still showing every node.
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  useEffect(() => {
    if (box.w <= 0) return;
    const ns = nodesRef.current;
    if (!ns.length) {
      setView({ cx: W / 2, cy: H / 2, zoom: coverZoom });
      return;
    }
    const xs = ns.map((n) => n.x);
    const ys = ns.map((n) => n.y);
    const pad = Math.max(500, 0.12 * Math.max(W, H));
    const bw = Math.max(...xs) - Math.min(...xs) + 2 * pad;
    const bh = Math.max(...ys) - Math.min(...ys) + 2 * pad;
    // Leave room for the bottom control bar.
    const zoom = Math.min(coverZoom, Math.min(box.w / bw, (box.h - 90) / bh) / fit);
    setView({ cx: (Math.max(...xs) + Math.min(...xs)) / 2, cy: (Math.max(...ys) + Math.min(...ys)) / 2 - 30 / (fit * zoom), zoom });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, box.w > 0]);
  // Keep the view valid when the frame resizes.
  useEffect(() => {
    setViewRaw((v) => {
      const n = v ? clamp(v) : v;
      liveRef.current = n;
      return n;
    });
  }, [clamp]);

  const v = view ?? { cx: W / 2, cy: H / 2, zoom: 1 };
  const s = fit * v.zoom; // CSS px per metre
  const vw = box.w / s;
  const vh = box.h / s;
  const x0 = v.cx - vw / 2;
  const yTop = v.cy + vh / 2;
  const k = 1 / s; // metres per CSS px
  // The drawn window, overscan included. Canvas and SVG both cover it; the stage div is offset so the visible window lines up with the frame.
  const ox = OVERSCAN * vw;
  const oy = OVERSCAN * vh;
  const dx0 = x0 - ox;
  const dyTop = yTop + oy;
  const dvw = vw + 2 * ox;
  const dvh = vh + 2 * oy;
  const stageW = box.w * (1 + 2 * OVERSCAN);
  const stageH = box.h * (1 + 2 * OVERSCAN);

  // ---------- gesture preview: transform the drawn stage, commit when the gesture settles ----------
  const committedRef = useRef(v);
  committedRef.current = v;
  const frameReq = useRef(0);
  const settleTimer = useRef(0);
  const applyPreview = useCallback(() => {
    frameReq.current = 0;
    const el = stageRef.current;
    const l = liveRef.current;
    const c = committedRef.current;
    if (!el || !l || box.w <= 0) return;
    const sc = fit * c.zoom;
    const sl = fit * l.zoom;
    const r = sl / sc;
    const x0c = c.cx - box.w / 2 / sc;
    const x0l = l.cx - box.w / 2 / sl;
    const yTc = c.cy + box.h / 2 / sc;
    const yTl = l.cy + box.h / 2 / sl;
    const tx = (x0c - x0l) * sl;
    const ty = (yTl - yTc) * sl;
    el.style.transform = r === 1 && tx === 0 && ty === 0 ? '' : `translate(${tx}px, ${ty}px) scale(${r})`;
  }, [box.w, box.h, fit]);
  // A new commit has been drawn: the preview transform collapses to identity (or to whatever the live view has moved on to).
  useLayoutEffect(() => {
    applyPreview();
  }, [view, applyPreview]);
  const commit = useCallback(() => {
    window.clearTimeout(settleTimer.current);
    const l = liveRef.current;
    if (l) setViewRaw((p) => (p && p.cx === l.cx && p.cy === l.cy && p.zoom === l.zoom ? p : l));
  }, []);
  const preview = useCallback(
    (next: View, settleMs = SETTLE_MS) => {
      const l = clamp(next);
      liveRef.current = l;
      if (!frameReq.current) frameReq.current = requestAnimationFrame(applyPreview);
      // Commit early once the visible window leaves the drawn (overscanned) window, so no blank
      // edge shows, or once a zoom-in has stretched the drawn raster too far to stay sharp.
      const c = committedRef.current;
      const sc = fit * c.zoom;
      const sl = fit * l.zoom;
      const vwc = box.w / sc;
      const vhc = box.h / sc;
      const lx0 = l.cx - box.w / 2 / sl;
      const lx1 = l.cx + box.w / 2 / sl;
      const ly0 = l.cy - box.h / 2 / sl;
      const ly1 = l.cy + box.h / 2 / sl;
      const inside = lx0 >= c.cx - vwc * (0.5 + OVERSCAN) && lx1 <= c.cx + vwc * (0.5 + OVERSCAN) && ly0 >= c.cy - vhc * (0.5 + OVERSCAN) && ly1 <= c.cy + vhc * (0.5 + OVERSCAN);
      if (!inside || sl / sc > 2.5) return commit();
      window.clearTimeout(settleTimer.current);
      if (settleMs >= 0) settleTimer.current = window.setTimeout(commit, settleMs);
    },
    [clamp, applyPreview, commit, fit, box.w, box.h],
  );
  useEffect(
    () => () => {
      cancelAnimationFrame(frameReq.current);
      window.clearTimeout(settleTimer.current);
    },
    [],
  );

  const rasters = useMemo(() => buildRasters(grid, layers), [grid, layers]);
  const paths = useMemo(() => buildPaths(layers), [layers]);
  const covCanvas = useMemo(() => (coverage ? coverageCanvas(coverage) : null), [coverage]);
  const safeCanvas = useMemo(() => (safetyLayer ? safetyCanvas(grid, safetyLayer) : null), [grid, safetyLayer]);

  // Detail cache: the whole area pre-rendered at every zoom level in background workers.
  const cache = useMemo(() => tileCacheFor(grid, layers), [grid, layers]);
  // Tiles finish by the hundred while the cache fills; redraw at most four times a second for them.
  const [cacheTick, setCacheTick] = useState(0);
  useEffect(() => {
    let timer = 0;
    const unsub = cache.subscribe(() => {
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = 0;
        setCacheTick((t) => t + 1);
      }, 250);
    });
    return () => {
      unsub();
      window.clearTimeout(timer);
    };
  }, [cache]);
  const cachePct = Math.round((cache.done / cache.total) * 100);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || box.w <= 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.round(stageW * dpr);
    const ch = Math.round(stageH * dpr);
    if (cv.width !== cw) cv.width = cw;
    if (cv.height !== ch) cv.height = ch;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    if (cache.levelComplete(0)) {
      // Cached tiles carry relief, hatching, contours, channels and grain; only coverage goes on top.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      cache.draw(ctx, dx0, dyTop, s * dpr, dvw, dvh);
      if (covCanvas) {
        ctx.setTransform(s * dpr, 0, 0, s * dpr, -dx0 * s * dpr, -(H - dyTop) * s * dpr);
        ctx.drawImage(covCanvas, 0, 0, W, H);
      }
    } else {
      drawSurvey(ctx, grid, rasters, paths, { view: { x0: dx0, yTop: dyTop, S: s * dpr }, dpr, terrain: true, grain: true, coverage: covCanvas });
    }
    if (showSafety && safeCanvas) {
      ctx.setTransform(s * dpr, 0, 0, s * dpr, -dx0 * s * dpr, -(H - dyTop) * s * dpr);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(safeCanvas, 0, 0, W, H);
    }
  }, [grid, rasters, paths, covCanvas, safeCanvas, showSafety, box.w, stageW, stageH, dx0, dyTop, s, dvw, dvh, cache, cacheTick, W, H]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const sel = selectedId ? byId.get(selectedId) : undefined;
  const selVisible = !!sel && sel.x >= x0 && sel.x <= x0 + vw && sel.y <= yTop && sel.y >= yTop - vh;

  // Detail lens: a magnified crop of the survey canvas around the selected node.
  useEffect(() => {
    const lens = lensRef.current;
    const src = canvasRef.current;
    if (!lens || !src || !sel || !selVisible || !src.width) return;
    const ctx = lens.getContext('2d');
    if (!ctx) return;
    const dpr = src.width / Math.max(1, stageW);
    const size = lens.width;
    const span = 48 * dpr;
    const cx = (sel.x - dx0) * s * dpr;
    const cy = (dyTop - sel.y) * s * dpr;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = PALETTE.ground;
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, cx - span / 2, cy - span / 2, span, span, 0, 0, size, size);
    ctx.strokeStyle = PALETTE.salmon;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  });

  // Zoom about a point given in frame pixels (defaults to the frame centre), starting from the live view.
  const zoomed = useCallback(
    (p: View, factor: number, mx = box.w / 2, my = box.h / 2): View => {
      const s0 = fit * p.zoom;
      const px = p.cx - box.w / 2 / s0 + mx / s0;
      const py = p.cy + box.h / 2 / s0 - my / s0;
      const zoom = Math.min(maxZoom, Math.max(1, p.zoom * factor));
      const s1 = fit * zoom;
      return { zoom, cx: px - (mx - box.w / 2) / s1, cy: py + (my - box.h / 2) / s1 };
    },
    [box.w, box.h, fit, maxZoom],
  );
  /** Buttons and keys: commit at once. */
  const zoomBy = useCallback((factor: number) => setView((p) => zoomed(p, factor)), [setView, zoomed]);
  const live = () => liveRef.current ?? committedRef.current;

  // Wheel zoom needs a non-passive listener so the page does not scroll. Wheel events preview; the commit follows when they stop.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('.survey-stage')) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      preview(zoomed(liveRef.current ?? committedRef.current, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018)), e.clientX - r.left, e.clientY - r.top));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [preview, zoomed]);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  const pinch = useRef<{ d: number; zoom: number } | null>(null);
  const suppressClick = useRef(false);
  const hoverReq = useRef(0);
  const defaultReadout = `Contours ${layers.contourIntervalM} m`;

  // Elevation readout under the pointer: written straight to the DOM, once per frame, never through React.
  const showHover = (clientX: number, clientY: number) => {
    if (hoverReq.current) cancelAnimationFrame(hoverReq.current);
    hoverReq.current = requestAnimationFrame(() => {
      hoverReq.current = 0;
      const out = readoutRef.current;
      if (!out) return;
      const p = toGrid(clientX, clientY);
      if (!p) {
        out.textContent = defaultReadout;
        return;
      }
      const c = Math.round((p.x / W) * (grid.cols - 1));
      const r = Math.round((p.y / H) * (grid.rows - 1));
      out.textContent = `${Math.round(sampleElevation(grid, p.x, p.y)).toLocaleString('en-US')} m · ${layers.slopeDeg[r * grid.cols + c].toFixed(1)}°`;
    });
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const l = live();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) drag.current = { x: e.clientX, y: e.clientY, cx: l.cx, cy: l.cy, moved: false };
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: l.zoom };
      if (drag.current) drag.current.moved = true;
    }
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current!;
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const r = rootRef.current!.getBoundingClientRect();
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const l = live();
      const target = (pinch.current.zoom * d) / Math.max(1, pinch.current.d);
      preview(zoomed(l, target / l.zoom, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top), -1);
      return;
    }
    const dg = drag.current;
    if (dg) {
      const dx = e.clientX - dg.x;
      const dy = e.clientY - dg.y;
      if (!dg.moved && Math.hypot(dx, dy) > 4) {
        dg.moved = true;
        svg.classList.add('dragging');
        svg.setPointerCapture(e.pointerId);
      }
      if (dg.moved) {
        const sl = fit * live().zoom;
        // -1: no settle timer while the finger is down; pointer-up commits.
        preview({ cx: dg.cx - dx / sl, cy: dg.cy + dy / sl, zoom: live().zoom }, -1);
        return;
      }
    }
    if (e.pointerType === 'mouse') showHover(e.clientX, e.clientY);
  };
  const onPointerEnd = (e: PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 1 && drag.current) {
      // Pinch became a one-finger drag: restart the drag from the remaining finger.
      const [p] = [...pointers.current.values()];
      const l = live();
      drag.current = { x: p.x, y: p.y, cx: l.cx, cy: l.cy, moved: true };
    }
    if (pointers.current.size === 0) {
      suppressClick.current = !!drag.current?.moved;
      drag.current = null;
      svgRef.current?.classList.remove('dragging');
      commit();
    }
  };

  const toGrid = (clientX: number, clientY: number): Pt | null => {
    const m = svgRef.current?.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    if (p.x < 0 || p.y < 0 || p.x > W || p.y > H) return null;
    return { x: p.x, y: H - p.y };
  };

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const step = 0.15;
    const keys: Record<string, () => void> = {
      '+': () => zoomBy(1.4),
      '=': () => zoomBy(1.4),
      '-': () => zoomBy(1 / 1.4),
      _: () => zoomBy(1 / 1.4),
      '0': () => setView({ cx: W / 2, cy: H / 2, zoom: 1 }),
      ArrowLeft: () => setView((p) => ({ ...p, cx: p.cx - vw * step })),
      ArrowRight: () => setView((p) => ({ ...p, cx: p.cx + vw * step })),
      ArrowUp: () => setView((p) => ({ ...p, cy: p.cy + vh * step })),
      ArrowDown: () => setView((p) => ({ ...p, cy: p.cy - vh * step })),
    };
    const f = keys[e.key];
    if (f && e.target === e.currentTarget) {
      e.preventDefault();
      f();
    }
  };

  const sx = (x: number) => x;
  const sy = (y: number) => H - y;
  const path = (pts: Pt[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');

  const routeNodes = route.map((id) => byId.get(id)).filter((n): n is SiteNode => !!n);
  const walkSmooth = useMemo(() => (walk ? smooth(walk.points, 3) : null), [walk]);
  const corridor = walkSmooth ?? (routeNodes.length > 1 ? routeNodes : null);
  // Path strings are in map metres, independent of zoom: build them once per data change, not on every render.
  const walkD = useMemo(() => (walkSmooth ? path(walkSmooth) : ''), [walkSmooth]); // eslint-disable-line react-hooks/exhaustive-deps
  const routeKey = route.join('|');
  const routeD = useMemo(() => path(routeNodes), [routeKey, byId]); // eslint-disable-line react-hooks/exhaustive-deps
  const corridorD = walkSmooth ? walkD : routeD;
  const routePairs = new Set<string>();
  for (let i = 0; i + 1 < route.length; i++) {
    routePairs.add(`${route[i]}|${route[i + 1]}`);
    routePairs.add(`${route[i + 1]}|${route[i]}`);
  }
  const band = 62 * k;
  // Relay labels only once typical relay spacing (median nearest neighbour) is about 70 px on screen.
  const relayLabels = useMemo(() => {
    const rs = nodes.filter((n) => n.kind === 'relay');
    if (rs.length < 2) return true;
    const nn = rs.map((a, i) => rs.reduce((m, b, j) => (i === j ? m : Math.min(m, Math.hypot(a.x - b.x, a.y - b.y))), Infinity)).sort((p, q) => p - q);
    return { nearest: nn[Math.floor(nn.length / 2)] };
  }, [nodes]);
  const fontPx = 12 * k;
  const scaleL = niceLength(110 / s);
  const zoomPct = Math.round((v.zoom / coverZoom) * 100);

  return (
    <div ref={rootRef} className="survey">
      {/* The stage holds everything drawn in map coordinates. Gestures move it with a transform only. */}
      <div ref={stageRef} className="survey-stage" style={{ left: -OVERSCAN * box.w, top: -OVERSCAN * box.h, width: stageW, height: stageH, transformOrigin: `${OVERSCAN * box.w}px ${OVERSCAN * box.h}px` }}>
      <canvas ref={canvasRef} className="survey-raster" aria-hidden="true" />
      <svg
        ref={svgRef}
        className={`survey-vector${placing ? ' placing' : ''}`}
        viewBox={`${dx0} ${H - dyTop} ${dvw || 1} ${dvh || 1}`}
        preserveAspectRatio="none"
        role="application"
        tabIndex={0}
        aria-roledescription="survey map"
        aria-label="Survey map of the planning area. Drag or use arrow keys to pan, scroll or plus and minus to zoom, 0 to fit the area."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onPointerLeave={() => {
          if (hoverReq.current) cancelAnimationFrame(hoverReq.current);
          hoverReq.current = 0;
          if (readoutRef.current) readoutRef.current.textContent = defaultReadout;
        }}
        onKeyDown={onKeyDown}
        onClick={(e: MouseEvent<SVGSVGElement>) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          const p = toGrid(e.clientX, e.clientY);
          if (p) onPick(p.x, p.y);
        }}
      >
        <defs>
          <pattern id="sv-zone-hatch" patternUnits="userSpaceOnUse" width={9 * k} height={9 * k} patternTransform="rotate(-40)">
            <line x1="0" y1="0" x2="0" y2={9 * k} stroke="#e46a5a" strokeOpacity="0.55" strokeWidth={1.2 * k} />
          </pattern>
          {corridor && (
            <mask id="sv-band-edge" maskUnits="userSpaceOnUse" x="0" y="0" width={W} height={H}>
              <path d={corridorD} fill="none" stroke="#fff" strokeWidth={band + 2.4 * k} strokeLinecap="round" strokeLinejoin="round" />
              <path d={corridorD} fill="none" stroke="#000" strokeWidth={band} strokeLinecap="round" strokeLinejoin="round" />
            </mask>
          )}
        </defs>

        <rect x={0} y={0} width={W} height={H} fill="none" stroke={PALETTE.salmon} strokeOpacity={0.45} strokeWidth={k} strokeDasharray={`${6 * k} ${5 * k}`} pointerEvents="none" />

        {zones.map((z) => (
          <g
            key={z.id}
            className="sv-zone"
            role="button"
            tabIndex={-1}
            aria-label={`No-go zone ${z.label}`}
            onClick={(e) => {
              e.stopPropagation();
              if (!suppressClick.current) onZoneClick(z.id);
            }}
          >
            <path d={path(z.pts) + 'Z'} fill="url(#sv-zone-hatch)" stroke="#e46a5a" strokeWidth={1.4 * k} strokeDasharray={`${6 * k} ${4 * k}`} />
            <text x={z.pts.reduce((a, p) => a + p.x, 0) / z.pts.length} y={H - z.pts.reduce((a, p) => a + p.y, 0) / z.pts.length} textAnchor="middle" className="sv-label" fontSize={fontPx} letterSpacing={2 * k} fill="#f19a8e">
              NO-GO {z.label}
            </text>
          </g>
        ))}
        {zoneDraft && zoneDraft.length > 0 && (
          <g className="sv-draft">
            <path d={path(zoneDraft)} fill="rgba(228,106,90,0.12)" stroke="#e46a5a" strokeWidth={1.4 * k} strokeDasharray={`${3 * k} ${3 * k}`} pointerEvents="none" />
            {zoneDraft.map((p, i) => (
              <circle
                key={i}
                cx={p.x}
                cy={H - p.y}
                r={(i === 0 ? 7 : 4) * k}
                fill={i === 0 ? '#e46a5a' : '#16110e'}
                stroke="#e46a5a"
                strokeWidth={1.2 * k}
                className={i === 0 && zoneDraft.length >= 3 ? 'sv-draft-close' : undefined}
                onClick={(e) => {
                  if (i !== 0 || zoneDraft.length < 3) return;
                  e.stopPropagation();
                  onFinishZone();
                }}
              >
                {i === 0 && zoneDraft.length >= 3 && <title>Close the zone</title>}
              </circle>
            ))}
          </g>
        )}

        {corridor && (
          <g pointerEvents="none" aria-hidden="true">
            {/* Soft halo as two faint wide strokes: a blur filter here re-rasterised the whole layer on every repaint. */}
            <path d={corridorD} fill="none" stroke="#f2c0a2" strokeOpacity={0.05} strokeWidth={band + 22 * k} strokeLinecap="round" strokeLinejoin="round" />
            <path d={corridorD} fill="none" stroke="#f2c0a2" strokeOpacity={0.06} strokeWidth={band + 10 * k} strokeLinecap="round" strokeLinejoin="round" />
            <path d={corridorD} fill="none" stroke={PALETTE.salmon} strokeOpacity={0.17} strokeWidth={band} strokeLinecap="round" strokeLinejoin="round" />
            <path d={corridorD} fill="none" stroke="#f2c0a2" strokeOpacity={0.6} strokeWidth={band + 2.4 * k} strokeLinecap="round" strokeLinejoin="round" mask="url(#sv-band-edge)" />
          </g>
        )}

        <g pointerEvents="none" aria-hidden="true">
          {layers.depressions.slice(0, 10).map((d, i) => {
            const r = Math.max(d.radiusM * 1.12, 9 * k);
            const ax = sx(d.x) + r * 0.7071;
            const ay = sy(d.y) - r * 0.7071;
            return (
              <g key={d.id}>
                <circle cx={sx(d.x)} cy={sy(d.y)} r={r} fill="none" stroke={PALETTE.salmon} strokeOpacity={0.8} strokeWidth={k} strokeDasharray={`${3 * k} ${4 * k}`} />
                {i < 5 && d.depthM >= 8 && (
                  <>
                    <line x1={ax} y1={ay} x2={ax + 26 * k} y2={ay - 26 * k} stroke={PALETTE.salmon} strokeOpacity={0.7} strokeWidth={k} />
                    <text x={ax + 30 * k} y={ay - 28 * k} className="sv-label" fontSize={fontPx * 0.92} letterSpacing={1.8 * k} fill={PALETTE.salmonText}>
                      {d.id} · {Math.round(d.depthM)} M DEEP
                    </text>
                  </>
                )}
              </g>
            );
          })}
        </g>

        {sim && sim.phase !== 'failing' && (
          <g pointerEvents="none" aria-hidden="true" key={`ghost-${sim.seq}`} className="sv-ghost">
            {sim.ghostWalk && sim.ghostWalk.length > 1 && <path d={path(smooth(sim.ghostWalk, 3))} fill="none" stroke={PALETTE.traverse} strokeWidth={2.3 * k} strokeDasharray={`${4 * k} ${4 * k}`} strokeLinecap="round" />}
            {sim.ghostRoute.length > 1 && <path d={path(sim.ghostRoute)} fill="none" stroke={PALETTE.salmon} strokeWidth={2 * k} strokeDasharray={`${2 * k} ${4 * k}`} strokeLinecap="round" />}
          </g>
        )}
        {walkSmooth && (
          <g pointerEvents="none" aria-hidden="true" key={`walk-${sim ? walkSeq : 0}`} className={sim && sim.phase !== 'failing' ? 'sv-draw' : undefined}>
            <path d={walkD} pathLength={1} fill="none" stroke={PALETTE.traverse} strokeOpacity={0.12} strokeWidth={11 * k} strokeLinecap="round" strokeLinejoin="round" />
            <path d={walkD} pathLength={1} fill="none" stroke={PALETTE.traverse} strokeOpacity={0.22} strokeWidth={6 * k} strokeLinecap="round" strokeLinejoin="round" />
            <path d={walkD} pathLength={1} fill="none" stroke={PALETTE.traverse} strokeWidth={2.3 * k} strokeLinecap="round" strokeLinejoin="round" />
          </g>
        )}
        {walk && (
          <g pointerEvents="none" aria-hidden="true">
            {walk.hazards.map((h, i) => (
              <path key={`hz${i}`} d={path(h)} fill="none" stroke={STATUS_COLOR.marginal} strokeWidth={4 * k} strokeLinecap="round" strokeOpacity={0.9} />
            ))}
            {walk.gaps.map((g, i) => (
              <path key={`gp${i}`} d={path(g)} fill="none" stroke={STATUS_COLOR.fail} strokeWidth={3.4 * k} strokeDasharray={`${4 * k} ${3 * k}`} strokeLinecap="round" />
            ))}
            {walk.gaps
              .map((g) => ({ g, len: g.reduce((a, p, i) => (i ? a + Math.hypot(p.x - g[i - 1].x, p.y - g[i - 1].y) : 0), 0) }))
              .sort((a, b) => b.len - a.len)
              .slice(0, 3)
              .map(({ g, len }, i) => {
                const m = g[Math.floor(g.length / 2)];
                return (
                  <text key={`gl${i}`} x={m.x + 10 * k} y={H - m.y - 10 * k} className="sv-label" fontSize={fontPx * 0.95} letterSpacing={1.8 * k} fill="#f19a8e">
                    NO SIGNAL {len >= 1000 ? `${(len / 1000).toFixed(1)} KM` : `${Math.round(len)} M`}
                  </text>
                );
              })}
          </g>
        )}

        <g pointerEvents="none" aria-hidden="true" key={`links-${sim?.phase !== 'failing' ? (sim?.seq ?? 0) : 0}`}>
          {links.map((l) => {
            const a = byId.get(l.a);
            const b = byId.get(l.b);
            if (!a || !b) return null;
            const st = l.result.status;
            const onRoute = routePairs.has(`${l.a}|${l.b}`);
            const common = { x1: sx(a.x), y1: sy(a.y), x2: sx(b.x), y2: sy(b.y), strokeLinecap: 'round' as const };
            if (st === 'fail') {
              const t = Math.max(0, Math.min(1, l.result.worstAtM / Math.max(1, l.result.distanceM)));
              const cx = sx(a.x + (b.x - a.x) * t);
              const cy = sy(a.y + (b.y - a.y) * t);
              const q = 6 * k;
              return (
                <g key={`${l.a}-${l.b}`}>
                  <line {...common} stroke={STATUS_COLOR.fail} strokeOpacity={0.85} strokeWidth={1.2 * k} strokeDasharray={`${1.5 * k} ${5 * k}`} />
                  <path d={`M${cx - q},${cy - q}L${cx + q},${cy + q}M${cx + q},${cy - q}L${cx - q},${cy + q}`} stroke={STATUS_COLOR.fail} strokeWidth={1.5 * k} />
                </g>
              );
            }
            if (st === 'marginal') return <line key={`${l.a}-${l.b}`} {...common} stroke={STATUS_COLOR.marginal} strokeWidth={(onRoute ? 1.6 : 1.1) * k} strokeDasharray={`${5 * k} ${4 * k}`} />;
            const hop = onRoute ? Math.max(route.indexOf(l.a), route.indexOf(l.b)) : 0;
            return (
              <line
                key={`${l.a}-${l.b}`}
                {...common}
                stroke={onRoute ? PALETTE.salmon : STATUS_COLOR.good}
                strokeOpacity={onRoute ? 1 : 0.7}
                strokeWidth={(onRoute ? 1.6 : 1) * k}
                className={sim && sim.phase !== 'failing' && onRoute ? 'sv-reveal' : undefined}
                style={sim && onRoute ? { animationDelay: `${hop * 110}ms` } : undefined}
              />
            );
          })}
        </g>

        <g pointerEvents="none" aria-hidden="true">
          {stations.map((st) => {
            const n = byId.get(st.stationId);
            if (!n || !st.chosen || !n.enabled) return null;
            const az = (st.chosen.azimuthDeg * Math.PI) / 180;
            const L = 120 * k;
            const x2 = sx(n.x) + Math.sin(az) * L;
            const y2 = sy(n.y) - Math.cos(az) * L;
            return (
              <g key={st.stationId}>
                <line x1={sx(n.x)} y1={sy(n.y)} x2={x2} y2={y2} stroke={PALETTE.ice} strokeOpacity={0.75} strokeWidth={1.1 * k} strokeDasharray={`${1 * k} ${5 * k}`} strokeLinecap="round" />
                <text x={x2 + 6 * k} y={y2} className="sv-label" fontSize={fontPx * 0.9} letterSpacing={1.8 * k} fill={PALETTE.iceText}>
                  {st.chosen.name.replace(' (illustrative)', '').toUpperCase()} {Math.round(st.chosen.elevationDeg)}°
                </text>
              </g>
            );
          })}
        </g>

        {waypoints.map((w) => (
          <g
            key={w.id}
            className="sv-waypoint"
            role="button"
            tabIndex={0}
            aria-label={`Crew waypoint ${w.label}`}
            onClick={(e) => {
              e.stopPropagation();
              if (!suppressClick.current) onWaypointClick(w.id);
            }}
          >
            <rect x={sx(w.x) - 7 * k} y={sy(w.y) - 7 * k} width={14 * k} height={14 * k} fill="rgba(22,17,14,0.7)" stroke={PALETTE.traverse} strokeWidth={1.4 * k} />
            <path d={`M${sx(w.x) - 3 * k},${sy(w.y) + 4 * k}V${sy(w.y) - 4 * k}L${sx(w.x) + 4 * k},${sy(w.y) - 1.5 * k}L${sx(w.x) - 3 * k},${sy(w.y) + 1 * k}`} fill={PALETTE.traverse} />
            <text x={sx(w.x) + 13 * k} y={sy(w.y) + 4 * k} className="sv-label" fontSize={fontPx} letterSpacing={2 * k} fill={PALETTE.bone}>
              {w.label}
            </text>
          </g>
        ))}

        {sim && (() => {
          const n = byId.get(sim.nodeId);
          if (!n) return null;
          const fail = sim.kind === 'fail';
          return (
            <g key={`burst-${sim.seq}`} pointerEvents="none" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <circle key={i} cx={sx(n.x)} cy={sy(n.y)} r={34 * k} fill="none" stroke={fail ? STATUS_COLOR.fail : STATUS_COLOR.good} strokeWidth={2 * k} className="sv-burst" style={{ animationDelay: `${i * 260}ms` }} />
              ))}
              {fail && sim.phase !== 'failing' && (
                <path d={`M${sx(n.x) - 9 * k},${sy(n.y) - 9 * k}L${sx(n.x) + 9 * k},${sy(n.y) + 9 * k}M${sx(n.x) + 9 * k},${sy(n.y) - 9 * k}L${sx(n.x) - 9 * k},${sy(n.y) + 9 * k}`} stroke={STATUS_COLOR.fail} strokeWidth={2.4 * k} strokeLinecap="round" />
              )}
            </g>
          );
        })()}

        {nodes.map((n) => {
          const label = labels.get(n.id) ?? n.id;
          const x = sx(n.x);
          const y = sy(n.y);
          const end = n.kind === 'A' || n.kind === 'B';
          const base = n.kind === 'base';
          const r = (end ? 15 : 10) * k;
          const ring = (end ? 23 : 16) * k;
          const col = end ? PALETTE.traverse : base ? PALETTE.ice : PALETTE.salmon;
          const critical = criticalIds.includes(n.id);
          const selected = n.id === selectedId;
          const act = () => onNodeClick(n.id);
          return (
            <g
              key={n.id}
              className="sv-node"
              opacity={n.enabled ? 1 : 0.4}
              role="button"
              tabIndex={0}
              aria-label={`${label}${n.enabled ? '' : ' (switched off)'}${critical ? ', critical node' : ''}`}
              aria-pressed={selected}
              onClick={(e) => {
                e.stopPropagation();
                if (suppressClick.current) {
                  suppressClick.current = false;
                  return;
                }
                act();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  act();
                }
              }}
            >
              <circle cx={x} cy={y} r={ring + 6 * k} fill="transparent" />
              {(n.origin === 'manual' || end) && <circle cx={x} cy={y} r={ring} fill="none" stroke={col} strokeOpacity={0.3} strokeWidth={k} />}
              {critical && <circle cx={x} cy={y} r={ring + 5 * k} fill="none" stroke={STATUS_COLOR.marginal} strokeWidth={1.1 * k} strokeDasharray={`${3 * k} ${3 * k}`} />}
              {selected && <circle cx={x} cy={y} r={ring + 10 * k} fill="none" stroke={PALETTE.traverse} strokeOpacity={0.9} strokeWidth={1.3 * k} />}
              {base ? (
                <rect x={x - r} y={y - r} width={2 * r} height={2 * r} transform={`rotate(45 ${x} ${y})`} fill="rgba(22,17,14,0.55)" stroke={col} strokeWidth={1.3 * k} />
              ) : (
                <circle cx={x} cy={y} r={r} fill="rgba(22,17,14,0.5)" stroke={col} strokeWidth={1.3 * k} />
              )}
              <circle cx={x} cy={y} r={(end ? 3.4 : 2.6) * k} fill={col} />
              {(end || base || selected || relayLabels === true || relayLabels.nearest / k > 70) && (
                <text x={x + ring + 8 * k} y={y + 4 * k} className="sv-label" fontSize={fontPx} letterSpacing={2.2 * k} fill={end ? PALETTE.bone : base ? PALETTE.iceText : PALETTE.salmonText}>
                  {label.toUpperCase()}
                </text>
              )}
            </g>
          );
        })}

        <g transform={`translate(${x0 + vw - 40 * k} ${H - yTop + 40 * k})`} fill="none" stroke={PALETTE.bone} strokeOpacity={0.7} strokeWidth={k} pointerEvents="none" aria-hidden="true">
          <circle r={16 * k} fill="rgba(22,17,14,0.4)" />
          <path d={`M0,${-12 * k}L${4 * k},${4 * k}L0,${k}L${-4 * k},${4 * k}Z`} fill={PALETTE.bone} fillOpacity={0.7} />
        </g>
      </svg>
      {/* Signal pulses get their own SVG (and compositor layer): animating them inside the main
          overlay repainted every route, mask and label on each frame. */}
      {routeNodes.length > 1 && motion && (
        <svg className="survey-pulses" viewBox={`${dx0} ${H - dyTop} ${dvw || 1} ${dvh || 1}`} preserveAspectRatio="none" aria-hidden="true" key={`signal-${route.join('|')}`}>
          {[0, 1, 2].map((i) => (
            <circle key={i} r={3.2 * k} fill={PALETTE.traverse} className="sv-signal">
              <animateMotion dur={`${Math.max(2.4, routeNodes.length * 0.35)}s`} begin={`${(i * Math.max(2.4, routeNodes.length * 0.35)) / 3}s`} repeatCount="indefinite" path={routeD} />
            </circle>
          ))}
        </svg>
      )}
      </div>

      {sel && selVisible && (
        <div className="survey-lens" aria-hidden="true">
          <canvas ref={lensRef} width={240} height={240} />
          <span className="cap">Detail {labels.get(sel.id) ?? sel.id}</span>
        </div>
      )}

      <div className="survey-bar">
        <span className={`cache-state${cachePct < 100 ? ' busy' : ''}`} title="The whole map is pre-rendered at every zoom level and kept in memory, so zooming never waits.">
          {cachePct < 100 ? `Caching detail ${cachePct}%` : `Detail cached · ${Math.round(cache.bytes / 1048576)} MB`}
        </span>
        <span ref={readoutRef} className="survey-readout num" aria-live="off">
          {defaultReadout}
        </span>
        <span className="survey-scale" aria-label={`Scale bar ${fmtLen(scaleL)}`}>
          <i style={{ width: scaleL * s }} />
          <span className="num">{fmtLen(scaleL)}</span>
        </span>
        <button type="button" className="bar-btn" aria-pressed={showSafety} onClick={() => setShowSafety((v) => !v)} title="Keep-out areas (cliff and crater buffers, no-go zones, steep ground) and ground without radio coverage">
          Safety layer
        </button>
        <div className="survey-key-wrap">
          <button type="button" className="bar-btn" aria-expanded={showKey} aria-controls="survey-key" onClick={() => setShowKey((x) => !x)}>
            Key
          </button>
          {showKey && (
            <div className="survey-key" id="survey-key" role="region" aria-label="Map key">
              <ul>
                <li>
                  <i className="lg-walk" /> Walking route
                </li>
                <li>
                  <i className="lg-band" /> Route corridor
                </li>
                <li>
                  <i className="lg-channel" /> Drainage channel (old river)
                </li>
                <li>
                  <i className="lg-contour" /> Contour, every {layers.contourIntervalM} m
                </li>
                <li>
                  <i className="lg-steep" /> Steeper than {NO_GO_SLOPE_DEG}°, no walking
                </li>
                <li>
                  <i className="lg-hole" /> Depression or crater
                </li>
                <li>
                  <i className="lg-keepout" /> Keep-out: cliff or crater buffer
                </li>
                <li>
                  <i className="lg-zone" /> No-go zone (drawn)
                </li>
                <li>
                  <i className="lg-nosignal" /> No radio coverage for the crew
                </li>
                <li>
                  <i className="lg-gap" /> Route stretch without signal
                </li>
                <li>
                  <i className="lg-hazard" /> Route stretch through a hazard
                </li>
                <li>
                  <i className="lg-wp" /> Crew waypoint
                </li>
                <li>
                  <i className="lg-signal" /> Signal flowing along the radio route
                </li>
                <li>
                  <i className="lg-link" style={{ borderColor: STATUS_COLOR.good }} /> Radio link, good
                </li>
                <li>
                  <i className="lg-link dashed" style={{ borderColor: STATUS_COLOR.marginal }} /> Marginal
                </li>
                <li>
                  <i className="lg-link dotted" style={{ borderColor: STATUS_COLOR.fail }} /> Blocked
                </li>
              </ul>
            </div>
          )}
        </div>
        <div className="zoom-group" role="group" aria-label="Zoom">
          <button type="button" className="bar-btn icon" aria-label="Zoom out" title="Zoom out (−)" onClick={() => zoomBy(1 / 1.5)} disabled={v.zoom <= 1.001}>
            <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
              <path d="M2 7h10" />
            </svg>
          </button>
          <span className="num zoom-pct" aria-live="polite">
            {zoomPct}%
          </span>
          <button type="button" className="bar-btn icon" aria-label="Zoom in" title="Zoom in (+)" onClick={() => zoomBy(1.5)} disabled={v.zoom >= maxZoom - 0.001}>
            <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
              <path d="M2 7h10M7 2v10" />
            </svg>
          </button>
          <button type="button" className="bar-btn" title="Show the whole planning area (0)" onClick={() => setView({ cx: W / 2, cy: H / 2, zoom: 1 })}>
            Fit area
          </button>
          <button type="button" className="bar-btn" title="Fill the frame" onClick={() => setView((p) => ({ ...p, zoom: coverZoom }))}>
            Fill
          </button>
        </div>
      </div>
    </div>
  );
}
