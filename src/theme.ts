import type { LinkStatus, NodeKind } from './engine';

/** Survey palette (see styles.css :root). Status colours also differ in dash pattern wherever they are drawn. */
export const PALETTE = {
  ground: '#16110e',
  panel: '#1d1714',
  bone: '#efe3d6',
  dust: '#b3a291',
  salmon: '#e8a07e',
  salmonText: '#f0c3a8',
  ochre: '#d9b46c',
  ice: '#a9c4c3',
  iceText: '#cfe0df',
  traverse: '#fbf1e4',
} as const;

export const STATUS_COLOR: Record<LinkStatus, string> = { good: '#a7c78f', marginal: '#e3b85c', fail: '#e46a5a' };
export const STATUS_LABEL: Record<LinkStatus, string> = { good: 'Good', marginal: 'Marginal', fail: 'Blocked' };
export const NODE_COLOR: Record<NodeKind, string> = { A: '#fbf1e4', B: '#f0c3a8', relay: '#e8a07e', base: '#a9c4c3' };
export const SAT_COLOR = '#a9c4c3';
export const COVERAGE_COLOR = { none: '#7a2a22', marginal: '#b8862e', good: '#6f9a5a' };
