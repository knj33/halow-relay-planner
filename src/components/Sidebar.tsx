import { areaLimitsFor, BODIES, COMPARISON_ONLY, CONSERVATIVE_SAFETY, COST_FIELDS, MODERATE_SAFETY, RADIO_FIELDS, SAFETY_FIELDS, maxAreaM, maxFreeSpaceRangeM, isRadioValid } from '../engine';
import type { CostField, GeoNode, SafetySettings } from '../engine';
import { formatGeo, localToGeo } from '../engine/terrain/geo';
import { fmtKm } from '../format';
import { DEMO_SITES, PRESETS } from '../presets';
import { nativeActive, nodeLabels, useStore } from '../state/store';
import type { Tool } from '../state/store';
import { NumberField } from './NumberField';

export const TOOLS: { id: Tool; label: string; short: string; hint: string }[] = [
  { id: 'select', label: 'Select', short: 'Sel', hint: 'Click a node to select it. On the globe, drag to orbit, right-drag to tilt, scroll to zoom.' },
  { id: 'setA', label: 'Set A', short: 'A', hint: 'Click the map to place endpoint A. The planning area grows to include it.' },
  { id: 'setB', label: 'Set B', short: 'B', hint: 'Click the map to place endpoint B.' },
  { id: 'relay', label: 'Add relay', short: 'Relay', hint: 'Click the map to add relay nodes.' },
  { id: 'base', label: 'Add base station', short: 'Base', hint: 'Click the map to add a base station with satellite backhaul.' },
  { id: 'waypoint', label: 'Add crew waypoint', short: 'Way', hint: 'Click the map to add a stop the crew must walk through between A and B, in order.' },
  { id: 'zone', label: 'Draw no-go zone', short: 'Zone', hint: 'Click corners of an area the crew must not enter. Click the first corner or press Enter to close it; Esc cancels.' },
  { id: 'move', label: 'Move', short: 'Move', hint: 'Select a node, then click the map to move it there.' },
  { id: 'fail', label: 'Fail a node', short: 'Fail', hint: 'Click a relay or base station to make it go dark (click again to restore). The network and the crew route re-plan, animated.' },
  { id: 'delete', label: 'Delete', short: 'Del', hint: 'Click a node, waypoint or no-go zone to delete it.' },
];

/** Planning-area controls: auto-fit, fixed size and the bundled presets. */
export function AreaPanel() {
  const body = useStore((s) => s.body);
  const area = useStore((s) => s.area);
  const autoFit = useStore((s) => s.autoFit);
  const setAutoFit = useStore((s) => s.setAutoFit);
  const setAreaSize = useStore((s) => s.setAreaSize);
  const setFixedArea = useStore((s) => s.setFixedArea);
  const viewCentre = useStore((s) => s.viewCentre);
  const zoomToArea = useStore((s) => s.zoomToArea);
  const flyToPreset = useStore((s) => s.flyToPreset);
  const native = useStore(nativeActive);
  const engineUp = useStore((s) => s.engineEnabled && s.engineStatus === 'available');
  const steps = areaLimitsFor(body, native).steps;
  const visibleSteps = area && !steps.includes(area.sizeM) ? [...steps, area.sizeM].sort((a, b) => a - b) : steps;
  const here = viewCentre ?? area?.centre ?? DEMO_SITES[body];

  return (
    <section className="panel" aria-labelledby="area-h">
      <h2 id="area-h">Planning area</h2>
      <p className="hint">
        The area is the square patch of real elevation used for link calculations. It grows automatically to hold every node, up to {maxAreaM(body, native) / 1000} km. The globe itself keeps streaming imagery and relief at any zoom.
      </p>
      <p className="hint">
        {native
          ? 'Native engine: larger areas and finer elevation grids enabled.'
          : engineUp
            ? `The running native engine cannot load ${BODIES[body].name} terrain; rebuild it from the latest source. Using the browser loader.`
            : 'Detect the optional Linux engine to enable larger areas and finer elevation grids.'}
        {' '}Larger areas have wider sample spacing; short ridges may be missed. Radio range still depends on terrain and the link budget.
      </p>
      {area ? (
        <p className="hint">
          <strong>
            {(area.sizeM / 1000).toFixed(0)} × {(area.sizeM / 1000).toFixed(0)} km
          </strong>{' '}
          centred on {formatGeo(area.centre)}.
        </p>
      ) : (
        <p className="hint">No area yet: click the globe or set one at the view centre.</p>
      )}

      <label className="check">
        <input type="checkbox" checked={autoFit} onChange={(e) => setAutoFit(e.target.checked)} />
        <span>Grow automatically to fit every node</span>
      </label>

      <div className="field">
        <label htmlFor="area-size">Area size</label>
        <div className="field-input">
          <select
            id="area-size"
            value={area ? String(area.sizeM) : ''}
            disabled={autoFit}
            onChange={(e) => Number(e.target.value) && void setAreaSize(Number(e.target.value))}
          >
            {!area && <option value="">—</option>}
            {visibleSteps.map((size) => (
              <option key={size} value={size}>
                {(size / 1000).toFixed(0)} × {(size / 1000).toFixed(0)} km
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="row gap wrap">
        <button type="button" onClick={() => void setFixedArea(here, area?.sizeM ?? steps[3])}>
          Set area here
        </button>
        <button type="button" onClick={zoomToArea} disabled={!area}>
          Zoom to area
        </button>
      </div>
      <p className="hint">“Here” is {formatGeo(here)} — the point under the centre of the view.</p>

      <div className="field">
        <label htmlFor="preset">Fly to a place</label>
        <div className="field-input">
          <select
            id="preset"
            value=""
            onChange={(e) => {
              const p = PRESETS[body].find((x) => x.name === e.target.value);
              if (p) flyToPreset({ lat: p.lat, lon: p.lon });
            }}
          >
            <option value="">Choose a preset…</option>
            {PRESETS[body].map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </section>
  );
}

export function toolHint(tool: Tool): string {
  return TOOLS.find((t) => t.id === tool)!.hint;
}

export function ToolPanel({ onPlan, canPlan, planBlockedReason }: { onPlan: () => void; canPlan: boolean; planBlockedReason: string | null }) {
  const plan = useStore((s) => s.plan);
  const planner = useStore((s) => s.planner);
  const setPlanner = useStore((s) => s.setPlanner);
  const reset = useStore((s) => s.resetDeployment);
  const loadDemo = useStore((s) => s.loadDemo);
  const running = plan.status === 'running';

  return (
    <section className="panel" aria-labelledby="tools-h">
      <h2 id="tools-h">Planner</h2>
      <p className="hint">Place nodes with the round tools on the right edge of the map.</p>

      <div className="row gap">
        <button type="button" className="primary grow" onClick={onPlan} disabled={!canPlan || running} aria-describedby="plan-note">
          {running ? 'Planning…' : 'Plan relays'}
        </button>
        <button
          type="button"
          onClick={() => {
            if (useStore.getState().nodes.length === 0 || window.confirm('Remove every node and the planning area? This cannot be undone.')) reset();
          }}
        >
          Reset
        </button>
      </div>
      <p id="plan-note" className="hint">
        {planBlockedReason ?? 'Heuristic search over sampled candidate sites. Starts clean: removes every existing relay and brings failed nodes back, keeping A, B, base stations, waypoints and zones.'}
      </p>
      <button type="button" className="link-btn" onClick={loadDemo}>
        Load demo scenario (A, B and one base station)
      </button>

      <details className="sub">
        <summary>Planner options</summary>
        <NumberField label="Candidate grid" unit="× per side" value={planner.gridDivisions} min={0} max={32} step={1} onChange={(v) => setPlanner({ gridDivisions: v })} hint="One candidate site per cell, at its highest point. 0 = automatic (~1.2 km cells)." />
        <label className="check">
          <input type="checkbox" checked={planner.redundancy} onChange={(e) => setPlanner({ redundancy: e.target.checked })} />
          <span>Add a second, independent path (mesh)</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={planner.requireFresnel} onChange={(e) => setPlanner({ requireFresnel: e.target.checked })} />
          <span>Only use links with a clear Fresnel zone</span>
        </label>
      </details>
    </section>
  );
}

function NodeRow({ node, label }: { node: GeoNode; label: string }) {
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const update = useStore((s) => s.updateNode);
  const remove = useStore((s) => s.removeNode);
  const canDisable = node.kind === 'relay' || node.kind === 'base';
  return (
    <li className={`node-row${selectedId === node.id ? ' selected' : ''}${node.enabled ? '' : ' off'}`}>
      <button type="button" className={`node-chip kind-${node.kind}`} onClick={() => select(node.id)} aria-pressed={selectedId === node.id} aria-label={`Select ${label}`}>
        {label}
      </button>
      <NumberField compact label={`${label} latitude`} unit="°" value={node.lat} min={-84} max={84} step={0.001} onChange={(v) => update(node.id, { lat: v })} />
      <NumberField compact label={`${label} longitude`} unit="°" value={node.lon} min={-180} max={180} step={0.001} onChange={(v) => update(node.id, { lon: v })} />
      {canDisable ? (
        <label className="check mini" title="Untick to simulate this node failing">
          <input type="checkbox" checked={node.enabled} onChange={(e) => update(node.id, { enabled: e.target.checked })} aria-label={`${label} enabled`} />
          <span>on</span>
        </label>
      ) : (
        <span />
      )}
      <button type="button" className="icon-btn" onClick={() => remove(node.id)} aria-label={`Delete ${label}`} title="Delete">
        ×
      </button>
    </li>
  );
}

export function NodePanel() {
  const nodes = useStore((s) => s.nodes);
  const body = useStore((s) => s.body);
  const viewCentre = useStore((s) => s.viewCentre);
  const area = useStore((s) => s.area);
  const place = useStore((s) => s.placeNode);
  const labels = nodeLabels(nodes);
  const has = (k: string) => nodes.some((n) => n.kind === k);
  const order = { A: 0, B: 1, base: 2, relay: 3 };
  const sorted = [...nodes].sort((p, q) => order[p.kind] - order[q.kind]);
  const R = BODIES[body].radiusM;
  const centre = area?.centre ?? viewCentre ?? DEMO_SITES[body];
  const span = area?.sizeM ?? 10_000;
  const at = (fracE: number, fracN: number) => localToGeo(centre, (fracE - 0.5) * span, (fracN - 0.5) * span, R);
  return (
    <section className="panel" aria-labelledby="nodes-h">
      <h2 id="nodes-h">
        Nodes <span className="count">{nodes.length}</span>
      </h2>
      {nodes.length === 0 ? (
        <p className="hint">Nothing placed yet. Click the globe, or use the buttons below to place nodes without a mouse and then type coordinates.</p>
      ) : (
        <ul className="node-list">
          {sorted.map((n) => (
            <NodeRow key={n.id} node={n} label={labels.get(n.id)!} />
          ))}
        </ul>
      )}
      <div className="row gap wrap">
        {!has('A') && (
          <button
            type="button"
            onClick={() => {
              const p = at(0.3, 0.5);
              place('A', p.lat, p.lon);
            }}
          >
            + A
          </button>
        )}
        {!has('B') && (
          <button
            type="button"
            onClick={() => {
              const p = at(0.7, 0.5);
              place('B', p.lat, p.lon);
            }}
          >
            + B
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            const p = at(0.5, 0.5);
            place('relay', p.lat, p.lon);
          }}
        >
          + Relay
        </button>
        <button
          type="button"
          onClick={() => {
            const p = at(0.5, 0.6);
            place('base', p.lat, p.lon);
          }}
        >
          + Base station
        </button>
      </div>
      <p className="hint">Untick “on” to simulate a relay or base station failing; connectivity is recalculated at once.</p>
    </section>
  );
}

export function RadioPanel() {
  const radio = useStore((s) => s.radio);
  const setRadio = useStore((s) => s.setRadio);
  const resetRadio = useStore((s) => s.resetRadio);
  const body = useStore((s) => s.body);
  const kFactor = useStore((s) => s.kFactor);
  const setK = useStore((s) => s.setKFactor);
  const backhaul = useStore((s) => s.backhaul);
  const setBackhaul = useStore((s) => s.setBackhaul);
  const valid = isRadioValid(radio);
  return (
    <section className="panel" aria-labelledby="radio-h">
      <h2 id="radio-h">Radio settings</h2>
      <div className="callout">
        <strong>Illustrative profile.</strong> Example values for a sub-GHz HaLow link, not a datasheet or a qualified design. Edit every field to match your hardware.
      </div>
      <div className="field">
        <label htmlFor="radio-name">Profile name</label>
        <div className="field-input">
          <input id="radio-name" type="text" value={radio.name} onChange={(e) => setRadio({ name: e.target.value })} />
        </div>
      </div>
      <div className="field-grid">
        {RADIO_FIELDS.map((f) => (
          <NumberField key={f.key} label={f.label} unit={f.unit} value={radio[f.key]} min={f.min} max={f.max} step={f.step} onChange={(v) => setRadio({ [f.key]: v })} />
        ))}
        <NumberField label="Base station antenna" unit="m" value={backhaul.baseAntennaHeightM} min={0.1} max={200} step={0.5} onChange={(v) => setBackhaul({ baseAntennaHeightM: v })} />
        <NumberField
          label="Refraction k-factor"
          value={kFactor}
          min={0.5}
          max={10}
          step={0.01}
          disabled={!BODIES[body].kFactorEditable}
          hint={BODIES[body].kFactorNote}
          onChange={setK}
        />
      </div>
      <p className="hint">
        {valid ? `Free-space range at the required margin: ${fmtKm(maxFreeSpaceRangeM(radio), 1)} (before terrain and curvature).` : 'Fix the highlighted fields to resume link calculations.'}
      </p>
      <button type="button" className="link-btn" onClick={resetRadio}>
        Restore example profile
      </button>
    </section>
  );
}

export function CostPanel() {
  const cost = useStore((s) => s.cost);
  const setCost = useStore((s) => s.setCost);
  const resetCost = useStore((s) => s.resetCost);
  const backhaul = useStore((s) => s.backhaul);
  const setBackhaul = useStore((s) => s.setBackhaul);
  const fields = COST_FIELDS.filter((f) => !COMPARISON_ONLY.has(f.key));
  const groups = [...new Set(fields.map((f) => f.group))];
  const field = (f: CostField) => <NumberField key={f.key} label={f.label} unit={f.unit} value={cost[f.key]} min={f.min} max={f.max} onChange={(v) => setCost({ [f.key]: v })} />;
  return (
    <section className="panel" aria-labelledby="cost-h">
      <h2 id="cost-h">Cost &amp; backhaul inputs</h2>
      <div className="callout">
        <strong>Not quotes or mission estimates.</strong> Delivery per kilogram is derived from Mars 2020; most prices are team estimates (see “Where the numbers come from”). Replace them with your own numbers before drawing conclusions.
      </div>
      {groups.map((g) => (
        <details key={g} className="sub" open={g === 'Scenario'}>
          <summary>{g}</summary>
          <div className="field-grid">
            {fields.filter((f) => f.group === g).map(field)}
            {g === 'Base station' && (
              <NumberField label="Min. satellite elevation" unit="°" value={backhaul.minElevationDeg} min={0} max={80} step={1} onChange={(v) => setBackhaul({ minElevationDeg: v })} />
            )}
          </div>
        </details>
      ))}
      <button type="button" className="link-btn" onClick={resetCost}>
        Restore default costs
      </button>
    </section>
  );
}

/** Crew waypoints, no-go zones and the walking-route safety rules. */
export function CrewPanel() {
  const waypoints = useStore((s) => s.waypoints);
  const zones = useStore((s) => s.zones);
  const removeWaypoint = useStore((s) => s.removeWaypoint);
  const moveWaypoint = useStore((s) => s.moveWaypoint);
  const removeZone = useStore((s) => s.removeZone);
  const setTool = useStore((s) => s.setTool);
  const safety = useStore((s) => s.safety);
  const setSafety = useStore((s) => s.setSafety);
  const preset = (p: SafetySettings) => setSafety({ ...p, requireCoverage: safety.requireCoverage });
  const isPreset = (p: SafetySettings) => SAFETY_FIELDS.every((f) => safety[f.key] === p[f.key]);
  return (
    <section className="panel" aria-labelledby="crew-h">
      <h2 id="crew-h">
        Crew route &amp; safety <span className="count">{waypoints.length}</span>
      </h2>
      <p className="hint">The crew walks from A through these stops in order to B, on the safest path that keeps radio coverage.</p>
      {waypoints.length === 0 ? (
        <p className="hint">No waypoints. Use the waypoint tool (W) and click the map.</p>
      ) : (
        <ol className="crew-list">
          {waypoints.map((w, i) => (
            <li key={w.id}>
              <span className="crew-tag">W{i + 1}</span>
              <span className="num muted">{formatGeo(w)}</span>
              <span className="crew-actions">
                <button type="button" className="icon-btn" aria-label={`Move W${i + 1} earlier`} disabled={i === 0} onClick={() => moveWaypoint(w.id, -1)}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
                    <path d="M2 8l4-4 4 4" />
                  </svg>
                </button>
                <button type="button" className="icon-btn" aria-label={`Move W${i + 1} later`} disabled={i === waypoints.length - 1} onClick={() => moveWaypoint(w.id, 1)}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
                    <path d="M2 4l4 4 4-4" />
                  </svg>
                </button>
                <button type="button" className="icon-btn" aria-label={`Delete W${i + 1}`} onClick={() => removeWaypoint(w.id)}>
                  ×
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      <div className="row gap wrap">
        <button type="button" onClick={() => setTool('waypoint')}>
          + Waypoint (W)
        </button>
        <button type="button" onClick={() => setTool('zone')}>
          + No-go zone (Z)
        </button>
      </div>
      {zones.length > 0 && (
        <ul className="crew-list">
          {zones.map((z, i) => (
            <li key={z.id}>
              <span className="crew-tag zone">Z{i + 1}</span>
              <span className="muted">{z.points.length} corners</span>
              <span className="crew-actions">
                <button type="button" className="icon-btn" aria-label={`Delete no-go zone Z${i + 1}`} onClick={() => removeZone(z.id)}>
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <details className="sub" open>
        <summary>Safety rules</summary>
        <div className="seg" role="radiogroup" aria-label="Safety preset">
          <button type="button" role="radio" aria-checked={isPreset(CONSERVATIVE_SAFETY)} className={isPreset(CONSERVATIVE_SAFETY) ? 'active' : ''} onClick={() => preset(CONSERVATIVE_SAFETY)}>
            Conservative
          </button>
          <button type="button" role="radio" aria-checked={isPreset(MODERATE_SAFETY)} className={isPreset(MODERATE_SAFETY) ? 'active' : ''} onClick={() => preset(MODERATE_SAFETY)}>
            Moderate
          </button>
        </div>
        <div className="field-grid">
          {SAFETY_FIELDS.map((f) => (
            <NumberField key={f.key} label={f.label} unit={f.unit} value={safety[f.key]} min={f.min} max={f.max} step={f.step} onChange={(v) => setSafety({ [f.key]: v })} />
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={safety.requireCoverage} onChange={(e) => setSafety({ requireCoverage: e.target.checked })} />
          <span>Keep the crew inside radio coverage (flag any stretch without signal)</span>
        </label>
        <p className="hint">Hazards cost far more than coverage gaps, which cost more than effort: the route is the safest one first, then the best covered, then the easiest.</p>
      </details>
    </section>
  );
}
