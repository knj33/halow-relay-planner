/// <reference lib="webworker" />
import { analyzeScenario, coverageField, hazardBase, hazardClasses, planRelays, safeTraverse } from '../engine';
import type { HazardBase } from '../engine';
import type { Request, Response, TraverseJob, TraverseResult } from './protocol';

/** The per-grid hazard analysis (slope, depression depth) is reused while the grid stays the same. */
let cached: { key: string; base: HazardBase } | null = null;

function traverse(job: TraverseJob): TraverseResult {
  if (!cached || cached.key !== job.gridKey) cached = { key: job.gridKey, base: hazardBase(job.grid) };
  const base = cached.base;
  const hazards = hazardClasses(job.grid, base, job.safety, job.zones);
  const coverage = coverageField(job.grid, job.env, job.radio, job.heights, job.nodes, job.clientHeightM);
  const t = job.stops.length >= 2 ? safeTraverse(job.grid, base, hazards, coverage, job.stops, job.safety) : null;
  return { traverse: t, coverage, hazards };
}

self.onmessage = (ev: MessageEvent<Request>) => {
  const { id, job } = ev.data;
  let res: Response;
  const transfer: Transferable[] = [];
  try {
    if (job.type === 'traverse') {
      const result = traverse(job);
      transfer.push(result.coverage.buffer, result.hazards.buffer);
      res = { id, ok: true, result };
    } else {
      const result = job.type === 'plan' ? planRelays(job.grid, job.env, job.radio, job.heights, job.options, job.nodes) : analyzeScenario(job.scenario);
      res = { id, ok: true, result };
    }
  } catch (err) {
    res = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  (self as DedicatedWorkerGlobalScope).postMessage(res, transfer);
};
