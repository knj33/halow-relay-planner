/**
 * The only way a slide touches the planner. `App` registers the implementation once it mounts
 * (`registerBridge`); slides get it in `onEnter`. Keeping this surface small and explicit means a
 * deck cannot reach into the store or component internals and break when they change.
 */
export type MapView = 'survey' | '3d' | 'globe';

export interface PresentationBridge {
  /** Install the bundled 200 km Arcadia Planitia scenario (no network) and show the survey map. */
  loadPremadeDemo(): Promise<void>;
  /**
   * Like loadPremadeDemo, but a no-op while that demo is still loaded (or loading), so a deck can
   * preload it when it opens and the live slide shows it with no loading screen.
   */
  ensureDemo(): Promise<void>;
  setView(view: MapView): void;
  /** Switch to the 3D relief, set its vertical exaggeration (1–12) and fly once around the area. */
  showRelief(exaggeration: number): void;
  /** Re-plan relays from scratch, as the Plan relays button does. */
  planRelays(): Promise<void>;
  /** Knock out a random working relay or base station on the route, with the failure animation. */
  randomFailure(): void;
  /** Bring every failed node back and end the failure simulation. */
  restoreAll(): void;
}

const noop: PresentationBridge = {
  loadPremadeDemo: async () => {},
  ensureDemo: async () => {},
  setView: () => {},
  showRelief: () => {},
  planRelays: async () => {},
  randomFailure: () => {},
  restoreAll: () => {},
};

let current: PresentationBridge = noop;

export function registerBridge(b: PresentationBridge): () => void {
  current = b;
  return () => {
    if (current === b) current = noop;
  };
}

/** A stable proxy, so a slide that keeps the reference still calls the latest implementation. */
export const bridge: PresentationBridge = {
  loadPremadeDemo: () => current.loadPremadeDemo(),
  ensureDemo: () => current.ensureDemo(),
  setView: (v) => current.setView(v),
  showRelief: (e) => current.showRelief(e),
  planRelays: () => current.planRelays(),
  randomFailure: () => current.randomFailure(),
  restoreAll: () => current.restoreAll(),
};
