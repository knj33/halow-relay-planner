import { ENGINE_BASE } from '../native/engine';
import { useStore } from '../state/store';

/**
 * Persistent status panel for the optional native Relay Engine. The planner works
 * without it; this panel makes the trade-off visible and lets the user turn it off.
 */
export function EnginePanel() {
  const status = useStore((s) => s.engineStatus);
  const info = useStore((s) => s.engineInfo);
  const enabled = useStore((s) => s.engineEnabled);
  const setEnabled = useStore((s) => s.setEngineEnabled);
  const probe = useStore((s) => s.probeEngine);

  const label =
    !enabled ? 'Off' : status === 'available' ? 'Running' : status === 'checking' ? 'Checking…' : status === 'unavailable' ? 'Not detected' : 'Not checked';

  return (
    <section className="panel engine-panel" aria-labelledby="engine-h">
      <h2 id="engine-h">
        Native terrain engine <span className={`engine-dot ${!enabled ? 'off' : status === 'available' ? 'ok' : status === 'checking' ? 'wait' : 'idle'}`} aria-hidden="true" />
      </h2>
      <p className="hint">
        Optional Linux companion, optimized for x86-64-v3. It downloads and resamples terrain in parallel, enabling up to 300 km Earth / 120 km Moon and Mars areas and finer grids. The browser loader is used
        whenever it is off or unavailable.
      </p>
      <p className="hint">Choose download concurrency with <code>--threads N</code>. Radio range is unchanged; speed depends on the network and terrain source. A hosted site may ask for local network access.</p>
      <p className="hint engine-status-line">
        <strong>{label}</strong>
        {info && status === 'available' && (
          <span className="muted">
            {' '}
            · {info.threads} threads · {info.avx2 ? 'AVX2' : 'baseline'} · v{info.version}
          </span>
        )}
        {enabled && status === 'unavailable' && <span className="muted"> · nothing answering on {ENGINE_BASE}</span>}
      </p>

      <label className="check">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span>Use the native engine when it is running</span>
      </label>

      <div className="row gap wrap">
        <button type="button" onClick={() => void probe()} disabled={!enabled || status === 'checking'}>
          {status === 'checking' ? 'Checking…' : 'Detect'}
        </button>
        <a className="button-link" href={`${import.meta.env.BASE_URL}engine/`} target="_blank" rel="noreferrer">
          Install / instructions
        </a>
      </div>
    </section>
  );
}
