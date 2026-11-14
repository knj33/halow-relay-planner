import { useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { curvatureBulgeM, fresnelRadiusM, heightFor, mhzToHz, terrainProfile, wavelengthM } from '../engine';
import type { Env, Heights, HeightGrid, NetworkLink, RadioProfile, SiteNode } from '../engine';
import { fmtDb, fmtKm } from '../format';
import { STATUS_COLOR, STATUS_LABEL } from '../theme';

interface Profile {
  ground: { d: number; z: number }[];
  layers: { d: number; z: number }[][];
  rayA: number;
  rayB: number;
  D: number;
  fresnel: number[];
  worst: { d: number; clearance: number };
  zMin: number;
  zMax: number;
}

/** Terrain along a hop with curvature applied the same way as the link model, plus two parallel lines for depth. */
function hopProfile(grid: HeightGrid, env: Env, radio: RadioProfile, heights: Heights, a: SiteNode, b: SiteNode, samples = 150): Profile {
  const D = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
  const lambda = wavelengthM(mhzToHz(radio.frequencyMHz));
  const bend = (p: { d: number; z: number }[]) => p.map((s) => ({ d: s.d, z: s.z - curvatureBulgeM(s.d, D - s.d, env) }));
  const ground = bend(terrainProfile(grid, a, b, samples));
  const nx = -(b.y - a.y) / D;
  const ny = (b.x - a.x) / D;
  const layers = [0.32, 0.16].map((f) => {
    const o = D * f;
    return bend(terrainProfile(grid, { x: a.x + nx * o, y: a.y + ny * o }, { x: b.x + nx * o, y: b.y + ny * o }, samples));
  });
  const rayA = ground[0].z + heightFor(a.kind, heights);
  const rayB = ground[ground.length - 1].z + heightFor(b.kind, heights);
  const fresnel = ground.map((s) => fresnelRadiusM(s.d, D - s.d, lambda));
  let worst = { d: 0, clearance: Infinity };
  for (let i = 1; i < ground.length - 1; i++) {
    const ray = rayA + ((rayB - rayA) * ground[i].d) / D;
    const c = ray - ground[i].z;
    if (c < worst.clearance) worst = { d: ground[i].d, clearance: c };
  }
  const all = [...ground, ...layers.flat()].map((s) => s.z);
  const fr = Math.max(...fresnel);
  return { ground, layers, rayA, rayB, D, fresnel, worst, zMin: Math.min(...all, rayA - fr, rayB - fr), zMax: Math.max(...all, rayA + fr, rayB + fr) };
}

function Thumb({ p, selected }: { p: Profile; selected: boolean }) {
  const id = useId();
  const span = Math.max(1, p.zMax - p.zMin);
  const pts = p.ground.map((s) => `${(4 + (s.d / p.D) * 50).toFixed(1)},${(46 - ((s.z - p.zMin) / span) * 26).toFixed(1)}`).join(' ');
  return (
    <svg width="58" height="58" viewBox="0 0 58 58" aria-hidden="true">
      <defs>
        <clipPath id={`${id}c`}>
          <circle cx="29" cy="29" r="28" />
        </clipPath>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#16110e" />
          <stop offset="1" stopColor="#5b3423" />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${id}c)`}>
        <rect width="58" height="58" fill={`url(#${id}s)`} />
        <polygon points={`0,58 ${pts} 58,58`} fill="#2c1a13" />
        <line x1="4" y1={46 - ((p.rayA - p.zMin) / span) * 26} x2="54" y2={46 - ((p.rayB - p.zMin) / span) * 26} stroke="#fbf1e4" strokeOpacity="0.8" strokeWidth="1" />
      </g>
      <circle cx="29" cy="29" r="28" fill="none" stroke={selected ? '#e8a07e' : 'rgba(236,205,178,.35)'} strokeWidth={selected ? 1.4 : 1} />
    </svg>
  );
}

function BigProfile({ p, link, title }: { p: Profile; link: NetworkLink; title: string }) {
  const id = useId();
  const X = (d: number) => 18 + (d / p.D) * 264;
  const span = Math.max(1, p.zMax - p.zMin);
  const Y = (z: number) => 292 - ((z - p.zMin) / span) * 196;
  /** Filled silhouette of a profile, lifted by `dy` pixels so parallel lines read as receding ridges. */
  const ridge = (s: { d: number; z: number }[], dy: number) =>
    `0,330 0,${(Y(s[0].z) + dy).toFixed(1)} ${s.map((v) => `${X(v.d).toFixed(1)},${(Y(v.z) + dy).toFixed(1)}`).join(' ')} 300,${(Y(s[s.length - 1].z) + dy).toFixed(1)} 300,330`;
  const ray = (d: number) => p.rayA + ((p.rayB - p.rayA) * d) / p.D;
  const upper = p.ground.map((s, i) => `${X(s.d).toFixed(1)},${Y(ray(s.d) + p.fresnel[i]).toFixed(1)}`);
  const lower = p.ground.map((s, i) => `${X(s.d).toFixed(1)},${Y(ray(s.d) - p.fresnel[i]).toFixed(1)}`).reverse();
  const blocked = p.worst.clearance < 0;
  const wx = X(p.worst.d);
  const st = link.result.status;
  return (
    <svg width="100%" viewBox="0 0 300 330" role="img" aria-label={`${title}: terrain profile, ${blocked ? `blocked by ${Math.abs(p.worst.clearance).toFixed(0)} m` : `ray clears terrain by ${p.worst.clearance.toFixed(0)} m`}`} className="profile">
      <defs>
        <linearGradient id={`${id}sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#16110e" />
          <stop offset=".7" stopColor="#3a231a" />
          <stop offset="1" stopColor="#5b3423" />
        </linearGradient>
        <linearGradient id={`${id}haze`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c47a5a" stopOpacity="0" />
          <stop offset="1" stopColor="#c47a5a" stopOpacity=".3" />
        </linearGradient>
        <filter id={`${id}soft`} x="-10%" y="-50%" width="120%" height="200%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>
      <rect width="300" height="330" fill={`url(#${id}sky)`} />
      <circle cx="238" cy="62" r="14" fill="#efe3d6" fillOpacity=".08" />
      <circle cx="238" cy="62" r="5" fill="#fbf1e4" fillOpacity=".55" />
      <polygon points={ridge(p.layers[0], -22)} fill="#4a2c20" />
      <rect x="0" y="120" width="300" height="140" fill={`url(#${id}haze)`} />
      <polygon points={ridge(p.layers[1], -10)} fill="#36211a" />
      <polygon points={ridge(p.ground, 0)} fill="#22140e" />
      <polygon points={[...upper, ...lower].join(' ')} fill="#e8a07e" fillOpacity=".1" stroke="#e8a07e" strokeOpacity=".6" strokeWidth=".8" />
      <line x1={X(0)} y1={Y(p.ground[0].z)} x2={X(0)} y2={Y(p.rayA)} stroke="#efe3d6" strokeWidth="1.2" />
      <line x1={X(p.D)} y1={Y(p.ground[p.ground.length - 1].z)} x2={X(p.D)} y2={Y(p.rayB)} stroke="#efe3d6" strokeWidth="1.2" />
      <line x1={X(0)} y1={Y(p.rayA)} x2={X(p.D)} y2={Y(p.rayB)} stroke={blocked ? STATUS_COLOR.fail : '#fbf1e4'} strokeOpacity=".45" strokeWidth="6" filter={`url(#${id}soft)`} />
      <line x1={X(0)} y1={Y(p.rayA)} x2={X(p.D)} y2={Y(p.rayB)} stroke={blocked ? STATUS_COLOR.fail : '#fbf1e4'} strokeWidth="1.4" strokeDasharray={blocked ? '3 4' : undefined} />
      <circle cx={X(0)} cy={Y(p.rayA)} r="4" fill="none" stroke="#e8a07e" strokeWidth="1.2" />
      <circle cx={X(p.D)} cy={Y(p.rayB)} r="4" fill="none" stroke="#fbf1e4" strokeWidth="1.2" />
      {Number.isFinite(p.worst.clearance) && (
        <>
          <line x1={wx} y1={Y(ray(p.worst.d))} x2={wx} y2={Y(ray(p.worst.d) - p.worst.clearance)} stroke={STATUS_COLOR[st]} strokeDasharray="2 2" />
          <text x={Math.min(wx + 8, 210)} y={Math.min(Y(ray(p.worst.d)), Y(ray(p.worst.d) - p.worst.clearance)) - 8} className="sv-label" fontSize="9" letterSpacing="1.6" fill={STATUS_COLOR[st]}>
            {blocked ? `BLOCKED ${Math.abs(p.worst.clearance).toFixed(0)} M` : `CLEARS ${p.worst.clearance.toFixed(0)} M`}
          </text>
        </>
      )}
      <text x="14" y="320" className="sv-mono" fontSize="9" fill="#c9b6a3">
        0 KM
      </text>
      <text x="286" y="320" className="sv-mono" fontSize="9" fill="#c9b6a3" textAnchor="end">
        {(p.D / 1000).toFixed(2)} KM
      </text>
    </svg>
  );
}

interface Props {
  grid: HeightGrid | null;
  env: Env;
  radio: RadioProfile;
  heights: Heights;
  nodes: SiteNode[];
  labels: Map<string, string>;
  hops: NetworkLink[];
  title: string;
  meta: string;
  children?: ReactNode;
}

/** Up to three hops open expanded; longer routes start collapsed behind the chevron. */
const AUTO_OPEN_MAX_HOPS = 3;

export function RouteDetail({ grid, env, radio, heights, nodes, labels, hops, title, meta, children }: Props) {
  const [pick, setPick] = useState(0);
  const [open, setOpen] = useState<boolean | null>(null);
  const bodyId = useId();
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const name = (id: string) => labels.get(id) ?? id;
  const profiles = useMemo(
    () =>
      grid
        ? hops.map((h) => {
            const a = byId.get(h.a);
            const b = byId.get(h.b);
            return a && b ? hopProfile(grid, env, radio, heights, a, b) : null;
          })
        : [],
    [grid, hops, byId, env, radio, heights],
  );
  const sel = Math.min(pick, Math.max(0, hops.length - 1));
  const hop = hops[sel];
  const prof = profiles[sel];
  const expanded = hops.length > 0 && (open ?? hops.length <= AUTO_OPEN_MAX_HOPS);
  const pathIds = hops.length ? [hops[0].a, ...hops.map((h) => h.b)] : [];
  const worst = hops.length ? hops.reduce((w, h) => (h.result.marginDb < w.result.marginDb ? h : w)) : null;

  return (
    <div className="route-card">
      <div className="route-card-head">
        <span className="cap hi">Route</span>
        {worst && (
          <span className="status-tag" data-status={worst.result.status} title="Weakest hop">
            {STATUS_LABEL[worst.result.status]}
          </span>
        )}
      </div>

      <h2 className="route-card-title">
        <button type="button" className="route-toggle" aria-expanded={expanded} aria-controls={bodyId} disabled={hops.length === 0} onClick={() => setOpen(!expanded)}>
          <span className="route-toggle-text">
            <span className="route-title">{title}</span>
            <span className="cap">{meta}</span>
          </span>
          <span className="chevron" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M4 6l4 4 4-4" />
            </svg>
          </span>
          <span className="sr-only">{expanded ? 'Collapse route detail' : 'Expand route detail'}</span>
        </button>
      </h2>

      {pathIds.length > 0 && (
        <ol className="route-path" aria-label="Route">
          {pathIds.map((id, i) => (
            <li key={`${id}-${i}`}>
              <button
                type="button"
                className={`path-chip${i === sel || i === sel + 1 ? ' on' : ''}`}
                onClick={() => {
                  setPick(Math.min(i, hops.length - 1));
                  setOpen(true);
                }}
                aria-label={`Show hop ${name(hops[Math.min(i, hops.length - 1)].a)} to ${name(hops[Math.min(i, hops.length - 1)].b)}`}
              >
                {name(id)}
              </button>
              {i < pathIds.length - 1 && (
                <span className={`path-link`} data-status={hops[i].result.status} aria-hidden="true" />
              )}
            </li>
          ))}
        </ol>
      )}

      {hops.length === 0 && <p className="body">Place A and B inside the planning area to see each hop's terrain profile here.</p>}

      <div id={bodyId} hidden={!expanded} className="route-card-body">
        <div className="hop-strip" role="group" aria-label={`${hops.length} hops`}>
          {hops.map((h, i) => (
            <button key={`${h.a}-${h.b}`} type="button" className="hop" aria-pressed={i === sel} onClick={() => setPick(i)}>
              {profiles[i] ? <Thumb p={profiles[i]!} selected={i === sel} /> : <span className="hop-empty" />}
              <span className="cap small">
                {name(h.a)} to {name(h.b)}
              </span>
            </button>
          ))}
        </div>
        {hop && (
          <div className="hop-detail">
            {prof && <BigProfile p={prof} link={hop} title={`Profile ${name(hop.a)} to ${name(hop.b)}`} />}
            <div className="hop-facts">
              <span className="cap hi">
                Hop {sel + 1} of {hops.length}
              </span>
              <span className="cap small">
                {name(hop.a)} to {name(hop.b)}
              </span>
              <dl>
                <div>
                  <dt className="cap small">Distance</dt>
                  <dd className="num">{fmtKm(hop.result.distanceM)}</dd>
                </div>
                <div>
                  <dt className="cap small">Margin</dt>
                  <dd className="num">{fmtDb(hop.result.marginDb)}</dd>
                </div>
                <div>
                  <dt className="cap small">Fresnel clear</dt>
                  <dd className="num">{Math.min(100, Math.max(0, Math.round(hop.result.worstFresnelFraction * 100)))}%</dd>
                </div>
              </dl>
              <span className="status-tag" data-status={hop.result.status}>
                {STATUS_LABEL[hop.result.status]}
              </span>
              <div className="hop-nav">
                <button type="button" className="bar-btn icon" aria-label="Previous hop" disabled={sel === 0} onClick={() => setPick(sel - 1)}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
                    <path d="M9 2L4 7l5 5" />
                  </svg>
                </button>
                <button type="button" className="bar-btn icon" aria-label="Next hop" disabled={sel >= hops.length - 1} onClick={() => setPick(sel + 1)}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
                    <path d="M5 2l5 5-5 5" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

