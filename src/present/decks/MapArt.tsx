import type { ReactNode } from 'react';
import { PALETTE, SIM_COLOR, STATUS_COLOR } from '../../theme';
import { useSlide } from '../kit';

/**
 * The survey map's drawing language for slides: the same relay and endpoint glyphs, link styles,
 * route corridor, signal packets and dashed area frame as `components/SurveyMap.tsx`, scaled up
 * by `S` for the 1920 × 1080 stage. Keep the two in step if the map's look changes.
 */

/** Stage px per map CSS px. */
export const S = 2.1;

export type Pt = { x: number; y: number };
export const pathD = (pts: Pt[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join('');

/** A relay: dark-filled ring with a centre dot, and a faint outer ring (as hand-placed relays on the map). */
export function Relay({ p, color = PALETTE.salmon, dim = false, dashed = false }: { p: Pt; color?: string; dim?: boolean; dashed?: boolean }) {
  return (
    <g transform={`translate(${p.x} ${p.y})`} opacity={dim ? 0.38 : 1} className="pz-map-node">
      <circle r={16 * S} fill="none" stroke={color} strokeOpacity={0.3} strokeWidth={S} />
      <circle r={10 * S} fill="rgba(22,17,14,0.75)" stroke={color} strokeWidth={1.3 * S} strokeDasharray={dashed ? `${3 * S} ${3 * S}` : undefined} />
      {!dashed && <circle r={2.6 * S} fill={color} />}
    </g>
  );
}

/** An endpoint (A or B): larger bone ring, label to the right like the map, optional status line under it. */
export function Endpoint({ p, label, status, statusColor = PALETTE.dust, ringColor = PALETTE.traverse }: { p: Pt; label: string; status?: string; statusColor?: string; ringColor?: string }) {
  return (
    <g transform={`translate(${p.x} ${p.y})`} className="pz-map-node">
      <circle r={23 * S} fill="none" stroke={ringColor} strokeOpacity={ringColor === PALETTE.traverse ? 0.3 : 0.9} strokeWidth={S} />
      <circle r={15 * S} fill="rgba(22,17,14,0.75)" stroke={PALETTE.traverse} strokeWidth={1.3 * S} />
      <circle r={3.4 * S} fill={PALETTE.traverse} />
      <text x={(23 + 8) * S} y={4 * S} className="pz-map-label" fontSize={12 * S} letterSpacing={2.2 * S} fill={PALETTE.bone}>
        {label}
      </text>
      {status && (
        <text y={(23 + 15) * S} textAnchor="middle" className="pz-map-label" fontSize={8.5 * S} letterSpacing={1.8 * S} fill={statusColor}>
          {status}
        </text>
      )}
    </g>
  );
}

type LinkKind = 'mesh' | 'route' | 'blocked' | 'chosen' | 'dead';
/** A radio link in the map's styles: good mesh link, route hop, blocked (dotted red with a cross), chosen (green), dead (red dashed). */
export function Link({ a, b, kind }: { a: Pt; b: Pt; kind: LinkKind }) {
  const common = { x1: a.x, y1: a.y, x2: b.x, y2: b.y, strokeLinecap: 'round' as const };
  if (kind === 'blocked') {
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const q = 6 * S;
    return (
      <g>
        <line {...common} stroke={STATUS_COLOR.fail} strokeOpacity={0.9} strokeWidth={1.2 * S} strokeDasharray={`${1.5 * S} ${5 * S}`} />
        <path d={`M${cx - q},${cy - q}L${cx + q},${cy + q}M${cx + q},${cy - q}L${cx - q},${cy + q}`} stroke={STATUS_COLOR.fail} strokeWidth={1.6 * S} strokeLinecap="round" />
      </g>
    );
  }
  if (kind === 'mesh') return <line {...common} stroke={STATUS_COLOR.good} strokeOpacity={0.7} strokeWidth={S} />;
  if (kind === 'route') return <line {...common} stroke={PALETTE.salmon} strokeWidth={1.6 * S} />;
  if (kind === 'chosen') return <line {...common} stroke={SIM_COLOR.chosen} strokeWidth={1.8 * S} />;
  return <line {...common} stroke={SIM_COLOR.dead} strokeWidth={1.8 * S} strokeDasharray={`${2 * S} ${4 * S}`} />;
}

/** The soft corridor band the map draws along the route (wide faint strokes, no blur filter). */
export function Corridor({ d, color = PALETTE.salmon }: { d: string; color?: string }) {
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round" pointerEvents="none">
      <path d={d} stroke={color} strokeOpacity={0.06} strokeWidth={62 * S} />
      <path d={d} stroke={color} strokeOpacity={0.1} strokeWidth={40 * S} />
    </g>
  );
}

/** A route drawn as the map draws a chosen (green) or dead (red) route: glow under a solid or dashed core. */
export function GlowRoute({ d, color, dashed = false, className }: { d: string; color: string; dashed?: boolean; className?: string }) {
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d={d} pathLength={1} stroke={color} strokeOpacity={0.18} strokeWidth={14 * S} className="pz-map-glow" />
      <path d={d} pathLength={1} stroke={color} strokeOpacity={0.35} strokeWidth={6 * S} className="pz-map-glow" />
      <path d={d} pathLength={dashed ? undefined : 1} stroke={color} strokeWidth={2.2 * S} strokeDasharray={dashed ? `${4 * S} ${4 * S}` : undefined} className={dashed ? undefined : 'pz-map-core'} />
    </g>
  );
}

/**
 * Signal packets: the map's glowing white dots moving along the route (SMIL, own layer). `die`
 * fades each packet out at the end of the path instead of arriving (the signal is cut there).
 */
export function Packets({ d, dur, n = 3, color = PALETTE.traverse, die = false }: { d: string; dur: number; n?: number; color?: string; die?: boolean }) {
  const { active, thumbnail } = useSlide();
  if (!active || thumbnail) return null;
  return (
    <g className="pz-map-packets" style={{ color }}>
      {Array.from({ length: n }, (_, i) => (
        <circle key={i} r={3.4 * S} fill={color} opacity={0} className="pz-map-signal">
          <animateMotion path={d} dur={`${dur}s`} begin={`${(i * dur) / n}s`} repeatCount="indefinite" />
          <animate attributeName="opacity" values={die ? '0;1;1;0' : '0;1;1;1;0'} keyTimes={die ? '0;0.08;0.82;1' : '0;0.05;0.5;0.95;1'} dur={`${dur}s`} begin={`${(i * dur) / n}s`} repeatCount="indefinite" />
        </circle>
      ))}
    </g>
  );
}

/** The dashed salmon boundary the map draws around the planning area, with faint contour lines inside. */
export function AreaFrame({ w, h, contours }: { w: number; h: number; contours?: string[] }) {
  return (
    <g pointerEvents="none">
      {contours?.map((c, i) => (
        <path key={i} d={c} fill="none" stroke={PALETTE.ochre} strokeOpacity={0.16} strokeWidth={S * 0.8} />
      ))}
      <rect x={S} y={S} width={w - 2 * S} height={h - 2 * S} fill="none" stroke={PALETTE.salmon} strokeOpacity={0.45} strokeWidth={S} strokeDasharray={`${6 * S} ${5 * S}`} />
    </g>
  );
}

/** A tag in the map's label style (small, widely tracked capitals). */
export function Tag({ p, children, color, anchor = 'start' }: { p: Pt; children: ReactNode; color: string; anchor?: 'start' | 'middle' | 'end' }) {
  return (
    <text x={p.x} y={p.y} textAnchor={anchor} className="pz-map-label" fontSize={11 * S} letterSpacing={2.4 * S} fill={color}>
      {children}
    </text>
  );
}

// ---------------------------------------------------------------------------------------------
// Side art for the opening slides: the same mesh, healthy (slide 1, green) and cut (slide 2, red).

const ART = 820;
const contourSet = [
  'M60,640 C220,560 330,700 520,610 S760,520 780,560',
  'M40,520 C180,470 300,560 470,500 S700,400 800,430',
  'M90,300 C230,260 330,330 470,280 S680,190 790,220',
  'M120,170 C260,120 360,170 520,140 S700,90 770,110',
];

/** Slide 1: a healthy mesh on Mars. A winding green route from A to B, the rest of the mesh around it, packets arriving. */
export function MeshArtHealthy() {
  const A: Pt = { x: 120, y: 690 };
  const B: Pt = { x: 690, y: 140 };
  const route: Pt[] = [A, { x: 215, y: 610 }, { x: 300, y: 540 }, { x: 330, y: 445 }, { x: 410, y: 380 }, { x: 500, y: 345 }, { x: 560, y: 270 }, { x: 625, y: 205 }, B];
  const side: Pt[] = [
    { x: 175, y: 500 },
    { x: 250, y: 415 },
    { x: 390, y: 520 },
    { x: 470, y: 460 },
    { x: 580, y: 400 },
    { x: 465, y: 250 },
    { x: 650, y: 330 },
    { x: 540, y: 160 },
  ];
  const all = [...route, ...side];
  const links: [Pt, Pt][] = [];
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) if (Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y) < 135) links.push([all[i], all[j]]);
  const d = pathD(route);
  return (
    <svg className="pz-side-art" viewBox={`0 0 ${ART} ${ART}`} aria-hidden="true">
      <AreaFrame w={ART} h={ART} contours={contourSet} />
      <Corridor d={d} color={SIM_COLOR.chosen} />
      {links.map(([a, b], i) => (
        <Link key={i} a={a} b={b} kind="mesh" />
      ))}
      <GlowRoute d={d} color={SIM_COLOR.chosen} />
      <Packets d={d} dur={4.2} n={3} />
      {side.map((p, i) => (
        <Relay key={`s${i}`} p={p} color={STATUS_COLOR.good} />
      ))}
      {route.slice(1, -1).map((p, i) => (
        <Relay key={`r${i}`} p={p} color={SIM_COLOR.chosen} />
      ))}
      <Endpoint p={A} label="A" ringColor={SIM_COLOR.chosen} />
      <Endpoint p={B} label="B" ringColor={SIM_COLOR.chosen} />
    </svg>
  );
}

/** Slide 2: a different network, cut in the middle by a ridge. The route goes red and B is disconnected. */
export function MeshArtCut() {
  const A: Pt = { x: 110, y: 470 };
  const B: Pt = { x: 700, y: 330 };
  const left: Pt[] = [{ x: 210, y: 400 }, { x: 300, y: 470 }, { x: 360, y: 380 }];
  const right: Pt[] = [{ x: 490, y: 300 }, { x: 560, y: 390 }, { x: 610, y: 260 }];
  const extra: Pt[] = [{ x: 200, y: 560 }, { x: 330, y: 600 }, { x: 260, y: 300 }, { x: 600, y: 500 }, { x: 520, y: 190 }];
  const route: Pt[] = [A, left[0], left[2], right[0], right[2], B];
  const gapA = left[2];
  const gapB = right[0];
  const all = [A, B, ...left, ...right, ...extra];
  const links: [Pt, Pt][] = [];
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const p = all[i];
      const q = all[j];
      if (Math.hypot(p.x - q.x, p.y - q.y) > 140) continue;
      // Nothing crosses the ridge between x ≈ 400 and 470.
      if ((p.x < 430) !== (q.x < 430)) continue;
      links.push([p, q]);
    }
  const lead = pathD(route.slice(0, 3));
  const dead = pathD(route.slice(3));
  return (
    <svg className="pz-side-art" viewBox={`0 0 ${ART} ${ART}`} aria-hidden="true">
      <AreaFrame w={ART} h={ART} contours={contourSet.slice(1)} />
      {/* The ridge: steep ground the map hatches (no walking, no line of sight). */}
      <g opacity={0.55}>
        <path d="M400,90 C440,250 410,420 445,560 S430,700 440,760 L470,760 C460,690 480,600 470,560 S470,250 432,90 Z" fill="url(#pz-ridge-hatch)" stroke={PALETTE.salmon} strokeOpacity={0.35} strokeWidth={S * 0.8} />
        <defs>
          <pattern id="pz-ridge-hatch" patternUnits="userSpaceOnUse" width={9 * S} height={9 * S} patternTransform="rotate(-40)">
            <line x1="0" y1="0" x2="0" y2={9 * S} stroke={STATUS_COLOR.fail} strokeOpacity="0.5" strokeWidth={1.1 * S} />
          </pattern>
        </defs>
      </g>
      {links.map(([a, b], i) => (
        <Link key={i} a={a} b={b} kind="mesh" />
      ))}
      <Corridor d={lead} />
      <GlowRoute d={lead} color={PALETTE.salmon} />
      <Link a={gapA} b={gapB} kind="blocked" />
      <GlowRoute d={dead} color={SIM_COLOR.dead} dashed />
      <Packets d={lead} dur={2.4} n={2} die />
      {[...left, ...extra].map((p, i) => (
        <Relay key={`l${i}`} p={p} />
      ))}
      {right.map((p, i) => (
        <Relay key={`r${i}`} p={p} color={SIM_COLOR.dead} dim />
      ))}
      <Endpoint p={A} label="A" />
      <Endpoint p={B} label="B" status="NO SIGNAL" statusColor={SIM_COLOR.dead} ringColor={SIM_COLOR.dead} />
      <Tag p={{ x: (gapA.x + gapB.x) / 2, y: (gapA.y + gapB.y) / 2 + 50 * S }} color={SIM_COLOR.dead} anchor="middle">
        DISCONNECTED
      </Tag>
    </svg>
  );
}
