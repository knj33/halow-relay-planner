import type { Analysis, NetworkAnalysis, NetworkLink, SiteNode, Traverse } from '../engine';
import { fmtDb, fmtDbm, fmtKm } from '../format';
import type { PlanState } from '../state/store';
import { STATUS_LABEL } from '../theme';

interface Props {
  nodes: SiteNode[];
  labels: Map<string, string>;
  net: NetworkAnalysis;
  shownLinks: NetworkLink[];
  analysis: Analysis | null;
  plan: PlanState;
  inputsValid: boolean;
  requiredMarginDb: number;
  walk: Traverse | null;
}

export const TOPOLOGY_TEXT: Record<NetworkAnalysis['topology'], { title: string; body: string; tone: string }> = {
  incomplete: { title: 'Waiting for endpoints', body: 'Place both A and B to evaluate connectivity.', tone: 'neutral' },
  disconnected: { title: 'Disconnected', body: 'No chain of usable links joins A and B with the nodes that are currently on.', tone: 'bad' },
  direct: { title: 'Connected directly', body: 'A reaches B in one hop. There is no alternate path if that link fades.', tone: 'ok' },
  chain: { title: 'Route found', body: 'Traffic has exactly one independent path. Losing any critical node cuts A from B.', tone: 'warn' },
  mesh: { title: 'Mesh route found', body: 'At least two paths share no relay, so no single relay failure cuts A from B.', tone: 'ok' },
};

export function StatusTag({ status }: { status: NetworkLink['result']['status'] }) {
  return (
    <span className="status-tag" data-status={status}>
      {STATUS_LABEL[status]}
    </span>
  );
}

const RouteIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true">
    <path d="M3 15 C7 13 9 9 11 8 C13 7 15 5 17 4" />
    <circle cx="3" cy="15" r="1.6" />
    <circle cx="17" cy="4" r="1.6" />
  </svg>
);

export function ResultsPanel({ nodes, labels, net, shownLinks, analysis, plan, inputsValid, requiredMarginDb, walk }: Props) {
  const relays = nodes.filter((n) => n.kind === 'relay');
  const bases = nodes.filter((n) => n.kind === 'base');
  const name = (id: string) => labels.get(id) ?? id;
  const topo = TOPOLOGY_TEXT[net.topology];
  const failed = shownLinks.filter((l) => l.result.status === 'fail');
  const marginal = shownLinks.filter((l) => l.result.status === 'marginal');
  const unused = relays.filter((r) => r.enabled && net.connected && !net.route.includes(r.id));

  if (!inputsValid) {
    return (
      <div className="state-card bad" role="alert">
        <h3>Invalid input</h3>
        <p>One or more radio, cost or environment fields are empty or out of range. Results are hidden until they are fixed, rather than calculated from a guess.</p>
      </div>
    );
  }

  const weakest = net.connected && net.hops.length ? net.hops.reduce((w, h) => (h.result.marginDb < w.result.marginDb ? h : w)) : null;
  const ab = shownLinks.find((l) => (l.a === 'A' && l.b === 'B') || (l.a === 'B' && l.b === 'A'));

  return (
    <div className="readout">
      <div className="readout-stats">
        <div className="stat-icon" data-tone={topo.tone}>
          <span className="rail top" />
          <span className="ring">
            <RouteIcon />
          </span>
          <span className="rail" />
        </div>
        <div className="stat-body" role="status" aria-live="polite">
          <h2 className="cap hi">{topo.title}</h2>
          <dl className="stat-grid">
            <div>
              <dt className="cap">Hops</dt>
              <dd className="num">{net.connected ? net.route.length - 1 : '–'}</dd>
            </div>
            <div>
              <dt className="cap">Weakest link</dt>
              <dd className="num">{net.minMarginDb !== null ? fmtDb(net.minMarginDb) : '–'}</dd>
            </div>
            <div>
              <dt className="cap">Crew path</dt>
              <dd className="num">{walk ? fmtKm(walk.lengthM, 1) : '–'}</dd>
            </div>
          </dl>
          <p className="body">
            {topo.body}
            {net.topology === 'disconnected' && ' Run Plan relays, add relays by hand, or switch a node back on.'} Required margin {fmtDb(requiredMarginDb)}.
            {walk &&
              ` Crew path ${fmtKm(walk.lengthM, 1)}, steepest step ${walk.maxGradeDeg.toFixed(0)}°, ${walk.uncoveredM > 0 ? `${fmtKm(walk.uncoveredM, 1)} without radio signal (red on the map)` : 'radio signal the whole way'}${walk.hazardM > 0 ? `, and ${fmtKm(walk.hazardM, 2)} through a hazard it could not avoid (amber)` : ', clear of every hazard'}.`}
          </p>
        </div>
      </div>

      <div className="readout-cols">
        <section aria-labelledby="lb-h">
          <h3 id="lb-h" className="cap hi">
            Link budget
          </h3>
          <span className="rule" />
          <div className="iconed">
            <span className="disc">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true">
                <path d="M4 18 L9 10 L13 14 L20 5" />
                <path d="M4 21h16" strokeOpacity=".5" />
              </svg>
            </span>
            <p className="body">
              {weakest
                ? `Weakest hop ${name(weakest.a)} to ${name(weakest.b)}: ${fmtKm(weakest.result.distanceM)}, free-space loss ${weakest.result.fsplDb.toFixed(0)} dB${weakest.result.diffractionLossDb > 0 ? ` plus ${weakest.result.diffractionLossDb.toFixed(1)} dB knife-edge` : ''}, received ${fmtDbm(weakest.result.rxPowerDbm)}, margin ${fmtDb(weakest.result.marginDb)}.`
                : ab
                  ? `A to B directly: ${ab.result.reasons[0] ?? STATUS_LABEL[ab.result.status]}`
                  : 'Place A and B inside the planning area to see the link budget.'}
            </p>
          </div>
          {net.connected && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Hop</th>
                    <th scope="col" className="num">
                      Distance
                    </th>
                    <th scope="col" className="num">
                      Margin
                    </th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {net.hops.map((h) => (
                    <tr key={`${h.a}-${h.b}`}>
                      <th scope="row">
                        {name(h.a)} to {name(h.b)}
                      </th>
                      <td className="num">{fmtKm(h.result.distanceM)}</td>
                      <td className="num">{fmtDb(h.result.marginDb)}</td>
                      <td>
                        <StatusTag status={h.result.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="sat-h">
          <h3 id="sat-h" className="cap hi">
            Satellite backhaul
          </h3>
          <span className="rule" />
          <div className="iconed">
            <span className="disc ice">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-25 12 12)" />
              </svg>
            </span>
            {bases.length === 0 ? (
              <p className="body">No base station placed. Add one to check which satellite it can see above the local skyline.</p>
            ) : (
              <ul className="plain">
                {bases.map((b) => {
                  const st = analysis?.stations.find((s) => s.stationId === b.id);
                  const reach = net.bases.find((r) => r.id === b.id);
                  return (
                    <li key={b.id} className="body">
                      <strong>{name(b.id)}</strong>{' '}
                      {!b.enabled
                        ? 'is switched off.'
                        : !st
                          ? 'calculating…'
                          : st.chosen
                            ? `sees ${st.chosen.name.replace(' (illustrative)', '')} at ${st.chosen.elevationDeg.toFixed(0)}° elevation, ${(st.chosen.elevationDeg - st.chosen.horizonDeg).toFixed(0)}° above the terrain skyline; slant range ${fmtKm(st.chosen.slantRangeM, 0)}, one-way delay ${st.chosen.oneWayDelayMs.toFixed(1)} ms.`
                            : 'has no satellite above the terrain mask in this snapshot.'}
                      {b.enabled && reach && (
                        <span className="muted">
                          {' '}
                          {reach.hopsFromA !== null ? `${reach.hopsFromA} hop(s) from A` : 'Not reachable from A'}, {reach.hopsFromB !== null ? `${reach.hopsFromB} from B` : 'not reachable from B'}.
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <p className="note">Fixed illustrative satellite snapshot. Geometry only; no satellite link budget.</p>
        </section>
      </div>

      {(plan.status === 'no-route' || plan.status === 'error' || (plan.status === 'ok' && plan.result) || net.criticalIds.length > 0 || unused.length > 0) && (
        <section className="readout-notes" aria-labelledby="planner-h">
          <h3 id="planner-h" className="cap hi">
            Planner
          </h3>
          {plan.status === 'no-route' && (
            <div className="state-card bad" role="alert">
              <h3>No feasible route found</h3>
              {plan.result?.notes.map((n, i) => <p key={i}>{n}</p>)}
            </div>
          )}
          {plan.status === 'error' && (
            <div className="state-card bad" role="alert">
              <h3>Planner error</h3>
              <p>{plan.message}</p>
            </div>
          )}
          {plan.status === 'ok' && plan.result && (
            <p className="body">
              {plan.result.relays.length} new relay{plan.result.relays.length === 1 ? '' : 's'} suggested from {plan.result.candidatesSampled} sampled sites and {plan.result.linksEvaluated.toLocaleString('en-US')} evaluated links (
              {plan.result.feasibleLinks.toLocaleString('en-US')} feasible). Fewest relays first, then the best weakest-link margin; a heuristic, not a global optimum. {plan.result.notes.join(' ')}
            </p>
          )}
          {net.criticalIds.length > 0 && (
            <p className="body warn-text">
              Critical node{net.criticalIds.length === 1 ? '' : 's'}: {net.criticalIds.map(name).join(', ')}. Switching any of these off disconnects A from B.
            </p>
          )}
          {unused.length > 0 && <p className="body">Not on the preferred route: {unused.map((r) => name(r.id)).join(', ')} (available as alternates or coverage).</p>}
        </section>
      )}

      {(failed.length > 0 || marginal.length > 0) && (
        <section className="readout-notes" aria-labelledby="fail-h">
          <h3 id="fail-h" className="cap hi">
            Link explanations
          </h3>
          <ul className="explain-list">
            {[...failed, ...marginal].slice(0, 14).map((l) => (
              <li key={`${l.a}-${l.b}`}>
                <div className="explain-head">
                  <span className="cap hi">
                    {name(l.a)} to {name(l.b)}
                  </span>
                  <StatusTag status={l.result.status} />
                  <span className="num muted">
                    {fmtKm(l.result.distanceM)} · {fmtDb(l.result.marginDb)}
                  </span>
                </div>
                {l.result.reasons.map((r, i) => (
                  <p key={i} className="body">
                    {r}
                  </p>
                ))}
              </li>
            ))}
          </ul>
          {failed.length + marginal.length > 14 && <p className="note">Showing 14 of {failed.length + marginal.length}.</p>}
        </section>
      )}
    </div>
  );
}
