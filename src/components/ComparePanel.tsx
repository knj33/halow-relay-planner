import type { Analysis, CostModel, StrategyResult } from '../engine';
import { fmtUsd } from '../format';
import type { Overlay } from '../state/store';

interface Props {
  analysis: Analysis | null;
  busy: boolean;
  cost: CostModel;
  overlay: Overlay;
  setOverlay: (o: Overlay) => void;
  inputsValid: boolean;
}

function headline(a: Analysis): string[] {
  const by = Object.fromEntries(a.strategies.map((s) => [s.id, s])) as Record<StrategyResult['id'], StrategyResult>;
  const out: string[] = [];
  const { mesh, direct, towers, satellite } = by;
  if (mesh.connects === null) return ['Place A and B to compare architectures.'];
  if (mesh.connects && direct.connects === false) {
    out.push(`Without relay nodes A and B cannot communicate, and only ${direct.coveragePct.toFixed(0)}% of the area is served (${mesh.coveragePct.toFixed(0)}% with this relay plan).`);
  } else if (!mesh.connects) {
    out.push('This deployment does not yet connect A and B. Run “Plan relays” to see a like-for-like comparison.');
  } else if (direct.connects) {
    out.push('A direct link already closes here, so relays add coverage and redundancy rather than basic connectivity.');
  }
  if (mesh.connects && mesh.totalUsd > 0) {
    if (towers.totalUsd > mesh.totalUsd) out.push(`Tall masts would cost about ${(towers.totalUsd / mesh.totalUsd).toFixed(1)}× this relay plan with the placeholder figures.`);
    if (satellite.totalUsd > mesh.totalUsd) out.push(`A satellite terminal for every user would cost about ${(satellite.totalUsd / mesh.totalUsd).toFixed(1)}× and grows with each added user.`);
    else out.push('With these placeholder figures and this few users, individual satellite terminals are not more expensive than the relay plan. Check the per-user growth.');
  }
  return out;
}

export function ComparePanel({ analysis, busy, cost, overlay, setOverlay, inputsValid }: Props) {
  if (!inputsValid) {
    return (
      <div className="state-card bad" role="alert">
        <h3>Invalid input</h3>
        <p>Fix the highlighted settings to compare architectures.</p>
      </div>
    );
  }
  if (!analysis) {
    return (
      <div className="state-card neutral" role="status">
        <h3>Calculating…</h3>
        <p>Computing coverage and alternative architectures in the background.</p>
      </div>
    );
  }
  const maxUsd = Math.max(cost.budgetUsd, ...analysis.strategies.map((s) => s.totalUsd), 1);
  const budgetPos = (cost.budgetUsd / maxUsd) * 100;

  return (
    <div className={`compare${busy ? ' busy' : ''}`} aria-busy={busy}>
      <div className="state-card neutral">
        <h3>What the comparison shows</h3>
        {headline(analysis).map((t, i) => (
          <p key={i}>{t}</p>
        ))}
      </div>

      <fieldset className="seg-field">
        <legend>Show coverage on the map</legend>
        <div className="seg" role="radiogroup" aria-label="Coverage overlay">
          {(
            [
              ['off', 'Off'],
              ['mesh', 'With relays'],
              ['direct', 'Without relays'],
            ] as [Overlay, string][]
          ).map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={overlay === id} className={overlay === id ? 'active' : ''} onClick={() => setOverlay(id)}>
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      {analysis.strategies.map((s) => {
        const over = s.totalUsd > cost.budgetUsd;
        const gap = s.coveragePct < cost.coverageTargetPct;
        return (
          <article key={s.id} className={`strategy${s.id === 'mesh' ? ' ours' : ''}`} aria-labelledby={`st-${s.id}`}>
            <header>
              <h3 id={`st-${s.id}`}>{s.name}</h3>
              <span className={`pill solid ${s.connects === null ? 'neutral' : s.connects ? 'ok' : 'bad'}`}>
                {s.connects === null ? 'A/B not set' : s.connects ? 'A ↔ B connects' : 'A ↔ B fails'}
              </span>
            </header>
            <p className="muted">{s.summary}</p>
            <p className="hardware">{s.hardware}</p>

            <div className="meter">
              <div className="meter-head">
                <span>Cost</span>
                <strong className={over ? 'bad-text' : ''}>{fmtUsd(s.totalUsd)}</strong>
              </div>
              <div className="bar" role="img" aria-label={`Cost ${fmtUsd(s.totalUsd)}; budget ${fmtUsd(cost.budgetUsd)}`}>
                <div className={`fill ${over ? 'bad' : 'cost'}`} style={{ width: `${Math.max(1, (s.totalUsd / maxUsd) * 100)}%` }} />
                <div className="marker" style={{ left: `${budgetPos}%` }} title={`Budget ${fmtUsd(cost.budgetUsd)}`} />
              </div>
            </div>
            <div className="meter">
              <div className="meter-head">
                <span>Area covered</span>
                <strong className={gap ? 'warn-text' : ''}>{s.coveragePct.toFixed(0)}%</strong>
              </div>
              <div className="bar" role="img" aria-label={`Coverage ${s.coveragePct.toFixed(0)} percent; target ${cost.coverageTargetPct} percent`}>
                <div className={`fill ${gap ? 'warn' : 'ok'}`} style={{ width: `${Math.max(1, s.coveragePct)}%` }} />
                <div className="marker" style={{ left: `${cost.coverageTargetPct}%` }} title={`Target ${cost.coverageTargetPct}%`} />
              </div>
            </div>

            {s.issues.length > 0 && (
              <ul className="issues">
                {s.issues.map((i, k) => (
                  <li key={k} className={i.severity}>
                    <span className="issue-tag">{i.severity === 'bad' ? 'Problem' : i.severity === 'warn' ? 'Risk' : 'Note'}</span>
                    {i.text}
                  </li>
                ))}
              </ul>
            )}
            {s.issues.every((i) => i.severity === 'info') && s.connects && <p className="note ok-text">No blocking problems under these assumptions.</p>}

            <details className="sub">
              <summary>Cost breakdown</summary>
              <table>
                <tbody>
                  {s.costLines.map((l) => (
                    <tr key={l.label}>
                      <th scope="row">
                        {l.count} × {l.label}
                      </th>
                      <td className="num">{fmtUsd(l.unitUsd)} each</td>
                      <td className="num">{fmtUsd(l.totalUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </article>
        );
      })}
      <p className="note">
        The thin white tick on each bar marks the budget ({fmtUsd(cost.budgetUsd)}) or coverage target ({cost.coverageTargetPct}%). Costs are capital placeholders only; coverage for the satellite option is sky visibility in a fixed snapshot.
      </p>
    </div>
  );
}
