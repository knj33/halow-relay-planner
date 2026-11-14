import { describe, expect, it } from 'vitest';
import { CONSERVATIVE_SAFETY } from '../src/engine';
import type { TraverseExplanation } from '../src/engine';
import { whyThisPath } from '../src/whyThisPath';

const none = { steep: 0, cliff: 0, crater: 0, zone: 0 };
const base: TraverseExplanation = {
  cellM: 195,
  waypoints: 0,
  path: { lengthM: 10_000, hazardM: 0, gapM: 0, gapStretches: 0, longestGapM: 0, hazards: none, maxGradeDeg: 6, meanGradeDeg: 1.2 },
  straight: { lengthM: 9_000, hazardM: 1200, gapM: 0, hazards: { ...none, crater: 1200 } },
  gapTradeM: 58,
  hazardTradeM: 393,
};

describe('why this path text', () => {
  it('explains a safe, covered detour around a crater', () => {
    const t = whyThisPath(base, CONSERVATIVE_SAFETY, { areaKm: 200, zones: 0 }).join(' ');
    expect(t).toMatch(/Safe the whole way/);
    expect(t).toMatch(/Radio contact the whole way/);
    expect(t).toMatch(/1\.2 km of crater-rim buffer/);
    expect(t).toMatch(/11% longer/);
  });

  it('owns up to hazards and signal gaps it could not avoid', () => {
    const e: TraverseExplanation = { ...base, waypoints: 2, path: { ...base.path, hazardM: 300, hazards: { ...none, zone: 300 }, gapM: 2500, gapStretches: 2, longestGapM: 2000 } };
    const t = whyThisPath(e, CONSERVATIVE_SAFETY, { areaKm: 10, zones: 1 }).join(' ');
    expect(t).toMatch(/through 2 waypoints/);
    expect(t).toMatch(/cannot avoid every hazard: 300 m of no-go zone/);
    expect(t).toMatch(/2\.5 km \(25%\) has no signal, in 2 stretches, the longest 2\.0 km/);
    expect(t).not.toMatch(/Safe the whole way/);
  });

  it('says so when the straight line is already fine', () => {
    const e: TraverseExplanation = { ...base, straight: { lengthM: 9_950, hazardM: 0, gapM: 0, hazards: none } };
    expect(whyThisPath(e, CONSERVATIVE_SAFETY, { areaKm: 10, zones: 0 }).join(' ')).toMatch(/almost exactly/);
  });

  it('notes when coverage is not enforced', () => {
    const t = whyThisPath({ ...base, path: { ...base.path, gapM: 800, gapStretches: 1, longestGapM: 800 } }, { ...CONSERVATIVE_SAFETY, requireCoverage: false }, { areaKm: 10, zones: 0 }).join(' ');
    expect(t).toMatch(/not being enforced/);
    expect(t).toMatch(/800 m of the path has no signal/);
  });
});
