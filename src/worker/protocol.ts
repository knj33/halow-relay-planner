import type { Analysis, Env, HeightGrid, Heights, PlanResult, PlannerOptions, RadioProfile, SafetySettings, Scenario, SiteNode, Traverse } from '../engine';

export interface PlanJob {
  type: 'plan';
  grid: HeightGrid;
  env: Env;
  radio: RadioProfile;
  heights: Heights;
  options: PlannerOptions;
  nodes: SiteNode[];
}
export interface AnalyzeJob {
  type: 'analyze';
  scenario: Scenario;
}
/** Crew traverse: hazards, radio coverage for the crew and the safest covered route through the stops. */
export interface TraverseJob {
  type: 'traverse';
  grid: HeightGrid;
  /** Identifies the grid so the worker can reuse its per-grid hazard analysis. */
  gridKey: string;
  env: Env;
  radio: RadioProfile;
  heights: Heights;
  nodes: SiteNode[];
  clientHeightM: number;
  /** A, crew waypoints in order, B; grid metres. */
  stops: { x: number; y: number }[];
  zones: { x: number; y: number }[][];
  safety: SafetySettings;
}
export interface TraverseResult {
  traverse: Traverse | null;
  coverage: Uint8Array;
  hazards: Uint8Array;
}
export type Job = PlanJob | AnalyzeJob | TraverseJob;
export type JobResult<J extends Job> = J extends PlanJob ? PlanResult : J extends TraverseJob ? TraverseResult : Analysis;

export interface Request {
  id: number;
  job: Job;
}
export type Response = { id: number; ok: true; result: PlanResult | Analysis | TraverseResult } | { id: number; ok: false; error: string };
