import { ENGINE_BASE } from '../native/engine';
import { useStore } from '../state/store';

/**
 * First-run ask for the optional native Relay Engine. The prompt is deliberately
 * dismissible: the planner must remain fully usable in a plain browser.
 */
export function EnginePrompt() {
  const prompt = useStore((s) => s.enginePrompt);
  const status = useStore((s) => s.engineStatus);
  const info = useStore((s) => s.engineInfo);
  const enabled = useStore((s) => s.engineEnabled);
  const dismiss = useStore((s) => s.dismissEnginePrompt);
  const probe = useStore((s) => s.probeEngine);

  if (!prompt) return null;

  if (status === 'available' && info) {
    return (
      <div className="engine-prompt ok" role="status">
        <div className="engine-prompt-copy">
          <strong>Native Relay Engine active</strong>
          <span>
            {info.threads} threads · {info.avx2 ? 'AVX2' : 'baseline'} · v{info.version}. Terrain is being downloaded and resampled natively.
          </span>
        </div>
        <div className="row gap wrap">
          <button type="button" onClick={() => void probe()}>
            Re-check
          </button>
          <button type="button" className="ghost" onClick={dismiss}>
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="engine-prompt" role="region" aria-label="Native Relay Engine">
      <div className="engine-prompt-copy">
        <strong>Make terrain load faster (optional)</strong>
        <span>
          The optional Linux Relay Engine downloads and resamples terrain in parallel using your CPU. Detect it to enable larger planning areas and finer elevation grids. The planner works without it.
        </span>
        {status === 'unavailable' && enabled && <span className="muted">Not detected on {ENGINE_BASE}. Start it, then re-check.</span>}
      </div>
      <div className="row gap wrap">
        <a className="button-link primary" href={`${import.meta.env.BASE_URL}engine/`} target="_blank" rel="noreferrer">
          Install / instructions
        </a>
        <button type="button" onClick={() => void probe()} disabled={status === 'checking'}>
          {status === 'checking' ? 'Checking…' : 'Detect engine'}
        </button>
        <button type="button" className="ghost" onClick={dismiss}>
          Continue in browser
        </button>
      </div>
    </div>
  );
}
