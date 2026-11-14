import type { HazardBreakdown, SafetySettings, TraverseExplanation } from './engine';

/**
 * Plain-language reasons for the crew path, built only from measured facts (explainTraverse), so
 * the text stays true for any stops, zones, failures or safety settings. One string per paragraph.
 */

const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function hazardList(h: HazardBreakdown, s: SafetySettings): string {
  const parts: [number, string][] = [
    [h.steep, `ground steeper than ${s.maxSlopeDeg}°`],
    [h.cliff, `cliff buffer`],
    [h.crater, `crater-rim buffer`],
    [h.zone, `no-go zone`],
  ];
  const used = parts.filter(([m]) => m > 0).sort((a, b) => b[0] - a[0]);
  return used.map(([m, what]) => `${km(m)} of ${what}`).join(', ');
}

export function whyThisPath(e: TraverseExplanation, s: SafetySettings, opts: { areaKm: number; zones: number }): string[] {
  const out: string[] = [];
  const { path: p, straight: st } = e;
  const via = e.waypoints ? ` through ${plural(e.waypoints, 'waypoint')}` : '';

  out.push(
    `${km(p.lengthM)} from A${via} to B. The route comes from an A* search over every ${Math.round(e.cellM)} m cell of the ${opts.areaKm} km area, which always finds the lowest-cost path on that grid. The cost puts crew safety first, radio signal second and walking effort third.`,
  );

  if (p.hazardM === 0) {
    out.push(
      `Safe the whole way: no slope steeper than ${s.maxSlopeDeg}°, nothing within ${s.cliffBufferM} m of a cliff or ${s.craterBufferM} m outside a crater rim${opts.zones ? `, and outside ${opts.zones === 1 ? 'the' : `all ${opts.zones}`} no-go ${opts.zones === 1 ? 'zone' : 'zones'}` : ''}.`,
    );
  } else {
    out.push(
      `It cannot avoid every hazard: ${hazardList(p.hazards, s)}, marked amber. The search accepts hazard only when every alternative is far worse: more than about ${e.hazardTradeM} m without signal, or a much longer detour, for each metre of hazard avoided.`,
    );
  }

  if (!s.requireCoverage) {
    out.push(`Radio coverage is not being enforced (it is switched off in Safety rules)${p.gapM > 0 ? `, and ${km(p.gapM)} of the path has no signal` : ''}.`);
  } else if (p.gapM === 0) {
    out.push('Radio contact the whole way: every point on the path is in line of sight of at least one working node.');
  } else {
    const pct = Math.round((p.gapM / Math.max(1, p.lengthM)) * 100);
    out.push(
      `${km(p.gapM)} (${pct}%) has no signal, in ${plural(p.gapStretches, 'stretch', 'stretches')}${p.gapStretches > 1 ? `, the longest ${km(p.longestGapM)}` : ''}. Staying in coverage there would have meant crossing a hazard or walking more than about ${e.gapTradeM} m extra per metre of signal gained. It is marked red; adding a relay near it would close it.`,
    );
  }

  const detour = st.lengthM > 0 ? (p.lengthM / st.lengthM - 1) * 100 : 0;
  const problems: string[] = [];
  if (st.hazardM > 0) problems.push(`cross ${hazardList(st.hazards, s)}`);
  if (s.requireCoverage && st.gapM > 0) problems.push(`spend ${km(st.gapM)} out of signal`);
  if (problems.length) {
    out.push(`Walking in straight lines between the same stops would be ${km(st.lengthM)}, but it would ${problems.join(' and ')}. This route is ${Math.max(0, Math.round(detour))}% longer to avoid that.`);
  } else {
    out.push(
      detour < 1
        ? `It follows the straight line between the stops almost exactly (${km(st.lengthM)}), because that line is already safe and covered.`
        : `The straight line between the stops (${km(st.lengthM)}) is already safe and covered. This route is ${Math.round(detour)}% longer because it bends onto easier ground.`,
    );
  }

  out.push(`Steepest step ${p.maxGradeDeg.toFixed(0)}°, average grade ${p.meanGradeDeg.toFixed(1)}°.`);
  out.push(`"Lowest cost" is measured within this model: the ${Math.round(e.cellM)} m grid, line-of-sight coverage and these safety rules. Boulders, soil strength and lighting are not modelled.`);
  return out;
}
