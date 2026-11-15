import { useSlide } from '../kit';
import { PALETTE, SIM_COLOR } from '../../theme';
import { AreaFrame, Corridor, Endpoint, Link, Packets, Relay, S, Tag } from './MapArt';

/**
 * Self-healing mesh, as a build-driven animation, drawn in the survey map's style (MapArt):
 *   step 0  signal packets flow from A to B over the mesh
 *   step 1  an access point on the route goes dark: the route past it turns red, B loses the signal
 *   step 2  a standby relay wakes, fills the gap, and the signal reaches B again over a green route
 * Only the current slide animates (packets are SMIL along fixed paths; everything else is
 * opacity, transform or stroke-dashoffset on a few small shapes).
 */

type P = { x: number; y: number };
const W = 1600;
const H = 600;
const COLS = [300, 540, 780, 1020, 1260];
const ROWS = [120, 300, 480];
const A: P = { x: 80, y: 300 };
const B: P = { x: 1500, y: 300 };
const FAILED = 'r2-1'; // centre of the route
const SPARE = 'r2-0'; // standby relay above it

interface Node extends P {
  id: string;
}
const RELAYS: Node[] = COLS.flatMap((x, c) => ROWS.map((y, r) => ({ id: `r${c}-${r}`, x, y })));
const ALL: Node[] = [{ id: 'A', ...A }, ...RELAYS, { id: 'B', ...B }];
const byId = new Map(ALL.map((n) => [n.id, n]));
const LINKS: [string, string][] = [];
for (let i = 0; i < ALL.length; i++)
  for (let j = i + 1; j < ALL.length; j++) {
    const a = ALL[i];
    const b = ALL[j];
    if (Math.hypot(a.x - b.x, a.y - b.y) <= 300) LINKS.push([a.id, b.id]);
  }

const OLD = ['A', 'r0-1', 'r1-1', 'r2-1', 'r3-1', 'r4-1', 'B'];
const NEW = ['A', 'r0-1', 'r1-1', 'r2-0', 'r3-1', 'r4-1', 'B'];
const d = (ids: string[]) => ids.map((id, i) => `${i ? 'L' : 'M'}${byId.get(id)!.x},${byId.get(id)!.y}`).join('');
const OLD_D = d(OLD);
const NEW_D = d(NEW);
const LEAD_D = d(OLD.slice(0, 3)); // A to the relay before the failure: still alive
const DEAD_D = d(OLD.slice(2)); // from the last live relay on: no longer usable

export function MeshHeal() {
  const { step, lang } = useSlide();
  const en = lang === 'en';
  const failed = step >= 1;
  const healed = step >= 2;
  const route = healed ? NEW : OLD;
  const onRoute = new Set<string>();
  for (let i = 0; i + 1 < route.length; i++) onRoute.add(`${route[i]}|${route[i + 1]}`).add(`${route[i + 1]}|${route[i]}`);
  const f = byId.get(FAILED)!;
  const sp = byId.get(SPARE)!;
  const received = !failed || healed;

  return (
    <div className={`pz-mesh step-${Math.min(step, 2)}`}>
      <svg viewBox={`0 0 ${W} ${H}`} className="pz-mesh-svg" role="img" aria-label={healed ? 'A standby relay has taken over and the signal reaches B again.' : failed ? 'An access point on the route has gone dark; the signal no longer reaches B.' : 'Signal flowing from A to B across the mesh.'}>
        <AreaFrame w={W} h={H} />

        {/* The mesh in the map's good-link style. Links to the standby relay appear once it wakes. */}
        {LINKS.map(([a, b]) => {
          const touchesFailed = a === FAILED || b === FAILED;
          const touchesSpare = a === SPARE || b === SPARE;
          if (touchesSpare && !healed) return null;
          if (touchesFailed && failed) return null;
          if (onRoute.has(`${a}|${b}`)) return null;
          return <Link key={`${a}-${b}`} a={byId.get(a)!} b={byId.get(b)!} kind="mesh" />;
        })}

        {/* The route, as on the map: corridor band and salmon hops; after a failure, dead (red) and new (green). */}
        {!failed && (
          <>
            <Corridor d={OLD_D} />
            <path d={OLD_D} fill="none" stroke={PALETTE.salmon} strokeWidth={1.6 * S} strokeLinejoin="round" />
          </>
        )}
        {failed && !healed && (
          <>
            <Corridor d={LEAD_D} />
            <path d={LEAD_D} fill="none" stroke={PALETTE.salmon} strokeWidth={1.6 * S} strokeLinejoin="round" />
          </>
        )}
        {failed && (
          <g key="dead" className={`pz-mesh-dead${healed ? ' settled' : ''}`}>
            <path d={DEAD_D} pathLength={1} className="pz-mesh-dead-under" stroke={SIM_COLOR.dead} />
            <path d={DEAD_D} className="pz-mesh-dead-core" stroke={SIM_COLOR.dead} />
          </g>
        )}
        {healed && (
          <g key="new" className="pz-mesh-new">
            <Corridor d={NEW_D} color={SIM_COLOR.chosen} />
            <path d={NEW_D} pathLength={1} className="pz-mesh-new-glow" stroke={SIM_COLOR.chosen} />
            <path d={NEW_D} pathLength={1} className="pz-mesh-new-core" stroke={SIM_COLOR.chosen} />
          </g>
        )}

        {/* Signal packets, the map's glowing dots: arriving; dying at the last live relay; arriving again. */}
        {!failed && <Packets key="p-old" d={OLD_D} dur={3.6} n={4} />}
        {failed && !healed && <Packets key="p-lead" d={LEAD_D} dur={1.6} n={2} die />}
        {healed && <Packets key="p-new" d={NEW_D} dur={3.8} n={4} />}

        {/* Relays: the failed one goes dark (red), the standby one sleeps (dashed) until it takes over (green). */}
        {RELAYS.map((n) => {
          if (n.id === FAILED && failed) return <Relay key={n.id} p={n} color={SIM_COLOR.dead} dim />;
          if (n.id === SPARE) return healed ? <Relay key={n.id} p={n} color={SIM_COLOR.chosen} /> : <Relay key={n.id} p={n} color={PALETTE.dust} dim dashed />;
          return <Relay key={n.id} p={n} color={healed && NEW.includes(n.id) ? SIM_COLOR.chosen : PALETTE.salmon} />;
        })}

        {/* The failure: a red burst and a cross on the access point that went dark. */}
        {failed && (
          <g key="burst" transform={`translate(${f.x} ${f.y})`} className="pz-mesh-burst">
            {!healed && [0, 1, 2].map((i) => <circle key={i} r={40} className="pz-mesh-burst-ring" style={{ animationDelay: `${i * 260}ms` }} stroke={SIM_COLOR.dead} />)}
            <path d={`M${-6 * S},${-6 * S}L${6 * S},${6 * S}M${6 * S},${-6 * S}L${-6 * S},${6 * S}`} stroke={SIM_COLOR.dead} strokeWidth={2.2 * S} strokeLinecap="round" />
          </g>
        )}
        {failed && (
          <Tag p={{ x: f.x, y: f.y + 34 * S }} color={SIM_COLOR.dead} anchor="middle">
            DARK
          </Tag>
        )}
        {/* The standby relay: asleep, then waking with a green ring when it takes over. */}
        <g transform={`translate(${sp.x} ${sp.y})`}>
          {healed && [0, 1].map((i) => <circle key={i} r={40} className="pz-mesh-wake-ring" style={{ animationDelay: `${i * 300}ms` }} stroke={SIM_COLOR.chosen} />)}
        </g>
        <Tag p={{ x: sp.x, y: sp.y - 22 * S }} color={healed ? SIM_COLOR.chosen : PALETTE.dust} anchor="middle">
          {healed ? 'TAKES OVER' : 'STANDBY'}
        </Tag>

        {/* Endpoints in the map's style; B reports whether the signal arrives. */}
        <Endpoint p={A} label="A" />
        <Endpoint
          p={B}
          label="B"
          status={received ? 'SIGNAL' : 'NO SIGNAL'}
          statusColor={received ? (healed ? SIM_COLOR.chosen : PALETTE.dust) : SIM_COLOR.dead}
          ringColor={received ? (healed ? SIM_COLOR.chosen : PALETTE.traverse) : SIM_COLOR.dead}
        />
      </svg>

      <p className="pz-mesh-caption" aria-live="polite">
        {healed ? (
          <strong>{en ? 'The mesh heals itself' : 'მეში თვითაღდგენადია'}</strong>
        ) : failed ? (
          <strong>{en ? 'An access point went down and the signal from A to B is lost' : 'Access point-ი დაეცა და A დან B მდე სიგნალი იკარგება'}</strong>
        ) : (
          <strong>{en ? 'The signal hops from node to node, from A to B' : 'სიგნალი A-დან B-მდე კვანძიდან კვანძამდე გადადის'}</strong>
        )}
      </p>
    </div>
  );
}
