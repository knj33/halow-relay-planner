import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { COMPARISON_ONLY, COST_FIELDS, COST_SOURCES, MARS_COST_BASIS, baseUnitUsd, clientUnitUsd, relayUnitUsd } from '../engine';
import type { BodyId, CostBasisKind, CostModel } from '../engine';
import { fmtUsd } from '../format';
import type { PremadeDemo } from '../state/store';

interface Props {
  body: BodyId;
  cost: CostModel;
  /** The editable cost inputs. */
  children: ReactNode;
}

interface DemoCounts {
  site: string;
  endpoints: number;
  relays: number;
  bases: number;
}

let demoCounts: Promise<DemoCounts> | null = null;
/** Node counts of the bundled Arcadia Planitia demo (manifest only, ~15 kB; the elevation is not fetched). */
function loadDemoCounts(): Promise<DemoCounts> {
  demoCounts ??= fetch(`${import.meta.env.BASE_URL}demo/arcadia-200km.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<PremadeDemo>;
    })
    .then((m) => ({
      site: m.site.name,
      endpoints: m.nodes.filter((n) => n.kind === 'A' || n.kind === 'B').length,
      relays: m.nodes.filter((n) => n.kind === 'relay').length,
      bases: m.nodes.filter((n) => n.kind === 'base').length,
    }))
    .catch((e) => {
      demoCounts = null;
      throw e;
    });
  return demoCounts;
}

const BASIS_LABEL: Record<CostBasisKind, string> = { sourced: 'Sourced', derived: 'Derived', estimate: 'Team estimate' };
const fmtKg = (kg: number) => `${kg.toLocaleString('en-US', { maximumFractionDigits: 1 })} kg`;

function Refs({ ids }: { ids: number[] }) {
  if (!ids.length) return null;
  return (
    <sup className="cost-refs">
      {ids.map((id, i) => (
        <span key={id}>
          {i > 0 && ', '}
          <a href={`#cost-src-${id}`}>{id}</a>
        </span>
      ))}
    </sup>
  );
}

/** The demo's capital cost under the current cost model, line by line, with mass and delivery split out. */
function DemoBreakdown({ counts, cost }: { counts: DemoCounts; cost: CostModel }) {
  const rows = [
    { label: 'HaLow nodes (A, B and relays)', count: counts.endpoints + counts.relays, hw: cost.relayHardwareUsd + cost.relayInstallUsd, kg: cost.relayMassKg, unit: relayUnitUsd(cost) },
    { label: 'Base stations with orbiter relay radio', count: counts.bases, hw: cost.baseHardwareUsd + cost.baseInstallUsd, kg: cost.baseMassKg, unit: baseUnitUsd(cost) },
    { label: 'Crew / rover client radios', count: cost.userSites, hw: cost.clientRadioUsd, kg: cost.clientMassKg, unit: clientUnitUsd(cost) },
  ].filter((r) => r.count > 0);
  const total = rows.reduce((s, r) => s + r.count * r.unit, 0);
  const mass = rows.reduce((s, r) => s + r.count * r.kg, 0);
  const delivery = mass * cost.deliveryUsdPerKg;
  const over = total > cost.budgetUsd;
  return (
    <>
      <div className="cost-headline">
        <div>
          <span className="cap">Total capital cost</span>
          <strong className={`num${over ? ' bad-text' : ''}`}>{fmtUsd(total)}</strong>
        </div>
        <div>
          <span className="cap">Mass landed</span>
          <strong className="num">{fmtKg(mass)}</strong>
        </div>
        <div>
          <span className="cap">Of which delivery</span>
          <strong className="num">{total > 0 ? `${((delivery / total) * 100).toFixed(0)}%` : '–'}</strong>
        </div>
        <div>
          <span className="cap">Budget</span>
          <strong className="num">{fmtUsd(cost.budgetUsd)}</strong>
        </div>
      </div>
      <div className="cost-table-wrap">
        <table className="cost-table">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col" className="num">Count</th>
              <th scope="col" className="num">Hardware each</th>
              <th scope="col" className="num">Mass each</th>
              <th scope="col" className="num">Delivery each</th>
              <th scope="col" className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                <td className="num">{r.count}</td>
                <td className="num">{fmtUsd(r.hw)}</td>
                <td className="num">{fmtKg(r.kg)}</td>
                <td className="num">{fmtUsd(r.kg * cost.deliveryUsdPerKg)}</td>
                <td className="num">{fmtUsd(r.count * r.unit)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td className="num">{rows.reduce((s, r) => s + r.count, 0)}</td>
              <td />
              <td className="num">{fmtKg(mass)}</td>
              <td className="num">{fmtUsd(delivery)}</td>
              <td className="num">{fmtUsd(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="note">
        Each unit costs hardware + installation + mass × {fmtUsd(cost.deliveryUsdPerKg)} per kg delivered to the surface. For scale: the whole Mars 2020 mission cost about $2.7B
        <Refs ids={[1]} />, and Ingenuity about $85M for 1.8 kg
        <Refs ids={[4]} />. Operations, power and maintenance are not included.
      </p>
    </>
  );
}

export function CostsPage({ body, cost, children }: Props) {
  const [counts, setCounts] = useState<DemoCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadDemoCounts().then(
      (c) => live && setCounts(c),
      (e) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, []);
  const basis = body === 'mars' ? MARS_COST_BASIS : {};
  const basisRows = COST_FIELDS.filter((f) => basis[f.key] && !COMPARISON_ONLY.has(f.key));

  return (
    <div className="costs-page">
      <section aria-labelledby="costs-demo-h">
        <h2 id="costs-demo-h" className="cap hi">
          Demo cost · {counts ? counts.site : 'Arcadia Planitia'}
        </h2>
        <p className="body">
          {counts
            ? `The bundled 200 km demo: ${counts.relays} relays, ${counts.bases} base stations and endpoints A and B, priced with the cost inputs below.`
            : 'The bundled 200 km demo, priced with the cost inputs below.'}
        </p>
        {counts ? <DemoBreakdown counts={counts} cost={cost} /> : <p className="note">{error ? `The demo manifest could not be read: ${error}` : 'Reading the demo…'}</p>}
      </section>

      {basisRows.length > 0 && (
        <section aria-labelledby="costs-basis-h">
          <h2 id="costs-basis-h" className="cap hi">
            Where the numbers come from
          </h2>
          <p className="body">
            Each default is marked by how it was set. <em>Sourced</em> is taken from a published figure, <em>Derived</em> is calculated from published figures, and <em>Team estimate</em> is our own judgement where no public price exists.
          </p>
          <div className="cost-table-wrap">
            <table className="cost-table basis-table">
              <thead>
                <tr>
                  <th scope="col">Input</th>
                  <th scope="col" className="num">Value</th>
                  <th scope="col">Basis</th>
                  <th scope="col">How it was set</th>
                </tr>
              </thead>
              <tbody>
                {basisRows.map((f) => {
                  const b = basis[f.key]!;
                  const v = cost[f.key];
                  return (
                    <tr key={f.key}>
                      <th scope="row">{f.label}</th>
                      <td className="num">{f.unit === 'USD' ? fmtUsd(v) : f.unit === 'USD/kg' ? `${fmtUsd(v)}/kg` : `${v.toLocaleString('en-US')} ${f.unit}`}</td>
                      <td>
                        <span className={`basis basis-${b.kind}`}>{BASIS_LABEL[b.kind]}</span>
                      </td>
                      <td>
                        {b.note}
                        <Refs ids={b.refs} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <h3 className="cap">Sources</h3>
          <ol className="cost-sources">
            {COST_SOURCES.map((s) => (
              <li key={s.id} id={`cost-src-${s.id}`}>
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.title}
                </a>
                <span className="muted"> · {s.publisher}.</span> {s.used}
              </li>
            ))}
          </ol>
          <p className="note">Values on this page change when you edit the inputs below; the basis column describes the defaults. Restore them with “Restore default costs”.</p>
        </section>
      )}

      <div className="costs-inputs">{children}</div>
    </div>
  );
}
