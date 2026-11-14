import type { Job, JobResult, Request, Response } from './protocol';

/**
 * Jobs run on named worker channels: 'main' for planning and analysis, 'traverse' for crew routing,
 * so a reroute never waits behind a slow coverage/cost analysis.
 */
type Channel = 'main' | 'traverse';
interface Lane {
  worker: Worker | null;
  pending: Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>;
}
const lanes: Record<Channel, Lane> = { main: { worker: null, pending: new Map() }, traverse: { worker: null, pending: new Map() } };
let seq = 0;

function getWorker(ch: Channel): Worker {
  const lane = lanes[ch];
  if (lane.worker) return lane.worker;
  const w = new Worker(new URL('./planner.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (ev: MessageEvent<Response>) => {
    const p = lane.pending.get(ev.data.id);
    if (!p) return;
    lane.pending.delete(ev.data.id);
    if (ev.data.ok) p.resolve(ev.data.result as never);
    else p.reject(new Error(ev.data.error));
  };
  w.onerror = (ev) => {
    for (const p of lane.pending.values()) p.reject(new Error(ev.message || 'Planning worker crashed'));
    lane.pending.clear();
    lane.worker = null;
  };
  lane.worker = w;
  return w;
}

/** Run a calculation off the main thread. */
export function runJob<J extends Job>(job: J, channel: Channel = job.type === 'traverse' ? 'traverse' : 'main'): Promise<JobResult<J>> {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    lanes[channel].pending.set(id, { resolve: resolve as (v: never) => void, reject });
    const req: Request = { id, job };
    getWorker(channel).postMessage(req);
  });
}
