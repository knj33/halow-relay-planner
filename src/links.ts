import type { NetworkLink, RadioProfile, SiteNode } from './engine';

/**
 * Which evaluated pairs are worth drawing and listing. Every usable link is shown. A failed pair is
 * shown only when it is informative: the direct A-B link, or a pair that free-space loss alone
 * would allow but terrain or curvature blocks.
 */
export function displayLinks(links: NetworkLink[], nodes: SiteNode[], radio: RadioProfile): NetworkLink[] {
  const kind = new Map(nodes.map((n) => [n.id, n.kind]));
  return links.filter((l) => {
    if (l.result.status !== 'fail') return true;
    const ka = kind.get(l.a);
    const kb = kind.get(l.b);
    if ((ka === 'A' && kb === 'B') || (ka === 'B' && kb === 'A')) return true;
    return l.result.marginDb + l.result.diffractionLossDb >= radio.requiredMarginDb;
  });
}

export function onRoute(l: NetworkLink, route: string[]): boolean {
  for (let i = 1; i < route.length; i++) {
    if ((route[i - 1] === l.a && route[i] === l.b) || (route[i - 1] === l.b && route[i] === l.a)) return true;
  }
  return false;
}
