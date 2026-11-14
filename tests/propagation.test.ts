import { describe, expect, it } from 'vitest';
import {
  curvatureBulgeM,
  evaluateLink,
  freeSpaceRxPowerDbm,
  fresnelRadiusM,
  fsplDb,
  knifeEdgeLossDb,
  makeEnv,
  maxFreeSpaceRangeM,
  mhzToHz,
  validateRadio,
  wavelengthM,
} from '../src/engine';
import { EARTH, MOON, flatGrid, radio, ridgeGrid } from './helpers';

describe('free-space path loss and units', () => {
  it('matches textbook values', () => {
    expect(fsplDb(1000, mhzToHz(2400))).toBeCloseTo(100.05, 1);
    expect(fsplDb(1000, mhzToHz(915))).toBeCloseTo(91.67, 1);
    expect(fsplDb(10_000, mhzToHz(915))).toBeCloseTo(111.67, 1);
  });

  it('takes metres and hertz, not kilometres or megahertz', () => {
    // 1 km at 915 MHz expressed in the wrong units would be off by 60 dB or more.
    expect(fsplDb(1, 915)).toBeLessThan(0);
    expect(mhzToHz(915)).toBe(915_000_000);
    expect(wavelengthM(mhzToHz(915))).toBeCloseTo(0.3276, 3);
  });

  it('adds 6.02 dB per doubling of distance or frequency', () => {
    const base = fsplDb(2500, 9e8);
    expect(fsplDb(5000, 9e8) - base).toBeCloseTo(6.0206, 3);
    expect(fsplDb(2500, 1.8e9) - base).toBeCloseTo(6.0206, 3);
  });

  it('computes received power from the full link budget', () => {
    // 21 dBm + 3 + 3 - 1 - 1 - 91.67 dB
    expect(freeSpaceRxPowerDbm(radio, 1000)).toBeCloseTo(-66.67, 1);
  });

  it('max range is the distance where margin equals the requirement', () => {
    const d = maxFreeSpaceRangeM(radio);
    expect(freeSpaceRxPowerDbm(radio, d) - radio.rxSensitivityDbm).toBeCloseTo(radio.requiredMarginDb, 6);
  });

  it('rejects non-numeric and out-of-range radio settings', () => {
    expect(validateRadio(radio)).toEqual({});
    expect(validateRadio({ ...radio, frequencyMHz: NaN }).frequencyMHz).toBeDefined();
    expect(validateRadio({ ...radio, txCableLossDb: -3 }).txCableLossDb).toBeDefined();
  });
});

describe('Fresnel and diffraction helpers', () => {
  it('first Fresnel radius at mid-path', () => {
    expect(fresnelRadiusM(500, 500, 0.3276)).toBeCloseTo(9.05, 1);
  });
  it('knife-edge loss is 0 well clear, ~6 dB at grazing, larger when blocked', () => {
    expect(knifeEdgeLossDb(-1)).toBe(0);
    expect(knifeEdgeLossDb(0)).toBeCloseTo(6.0, 0);
    expect(knifeEdgeLossDb(2)).toBeGreaterThan(18);
  });
});

describe('flat terrain', () => {
  const grid = flatGrid();
  it('short link on tall masts is fully clear and matches the free-space budget', () => {
    const r = evaluateLink(grid, EARTH, radio, { x: 1000, y: 5000, heightM: 10 }, { x: 2000, y: 5000, heightM: 10 });
    expect(r.status).toBe('good');
    expect(r.losClear).toBe(true);
    expect(r.fresnelClear).toBe(true);
    expect(r.diffractionLossDb).toBe(0);
    expect(r.distanceM).toBeCloseTo(1000, 3);
    expect(r.rxPowerDbm).toBeCloseTo(-66.67, 1);
    expect(r.marginDb).toBeCloseTo(31.33, 1);
  });

  it('separates line of sight from Fresnel clearance: low masts see each other but are only marginal', () => {
    const r = evaluateLink(grid, EARTH, radio, { x: 1000, y: 5000, heightM: 2 }, { x: 4000, y: 5000, heightM: 2 });
    expect(r.losClear).toBe(true);
    expect(r.fresnelClear).toBe(false);
    expect(r.status).toBe('marginal');
    expect(r.diffractionLossDb).toBeGreaterThan(0);
    expect(r.reasons.join(' ')).toMatch(/Fresnel/);
  });

  it('visibility alone is not a link: a clear path with too little power fails on margin', () => {
    const weak = { ...radio, txPowerDbm: -10 };
    const r = evaluateLink(grid, EARTH, weak, { x: 1000, y: 5000, heightM: 30 }, { x: 5000, y: 5000, heightM: 30 });
    expect(r.losClear).toBe(true);
    expect(r.fresnelClear).toBe(true);
    expect(r.status).toBe('fail');
    expect(r.reasons.join(' ')).toMatch(/margin/i);
  });
});

describe('ridge-blocked terrain', () => {
  const grid = ridgeGrid();
  const a = { x: 1000, y: 5000, heightM: 10 };
  const b = { x: 9000, y: 5000, heightM: 10 };
  it('blocks the direct path and explains why', () => {
    const r = evaluateLink(grid, EARTH, radio, a, b);
    expect(r.losClear).toBe(false);
    expect(r.status).toBe('fail');
    expect(r.blockedByCurvature).toBe(false);
    expect(r.minClearanceM).toBeLessThan(-150);
    expect(r.worstAtM).toBeGreaterThan(3500);
    expect(r.worstAtM).toBeLessThan(4500);
    expect(r.reasons[0]).toMatch(/Terrain blocks/);
  });
  it('both halves work through a relay on the crest', () => {
    const top = { x: 5000, y: 5000, heightM: 10 };
    expect(evaluateLink(grid, EARTH, radio, a, top).status).not.toBe('fail');
    expect(evaluateLink(grid, EARTH, radio, top, b).status).not.toBe('fail');
  });
});

describe('body curvature', () => {
  const grid = flatGrid(20_000);
  const a = { x: 2000, y: 10_000, heightM: 2 };
  it('bulge uses the body radius and k-factor', () => {
    expect(curvatureBulgeM(5000, 5000, { radiusM: 6_371_000, kFactor: 1 })).toBeCloseTo(1.962, 2);
    expect(curvatureBulgeM(5000, 5000, MOON)).toBeCloseTo(7.195, 2);
    expect(curvatureBulgeM(5000, 5000, EARTH)).toBeCloseTo(1.962 * 0.75, 2);
  });

  it('the same 8 km path with 2 m masts is visible on Earth but over the horizon on the Moon', () => {
    const b = { x: 10_000, y: 10_000, heightM: 2 };
    const earth = evaluateLink(grid, EARTH, radio, a, b);
    const moon = evaluateLink(grid, MOON, radio, a, b);
    expect(earth.losClear).toBe(true);
    expect(moon.losClear).toBe(false);
    expect(moon.blockedByCurvature).toBe(true);
    expect(moon.status).toBe('fail');
    expect(moon.reasons[0]).toMatch(/curvature/);
  });

  it('Earth refraction (k = 4/3) extends the horizon relative to k = 1', () => {
    const b = { x: 12_900, y: 10_000, heightM: 2 }; // 10.9 km: between the k=1 (10.1 km) and k=4/3 (11.7 km) horizons
    expect(evaluateLink(grid, makeEnv('earth', 4 / 3), radio, a, b).losClear).toBe(true);
    expect(evaluateLink(grid, makeEnv('earth', 1), radio, a, b).losClear).toBe(false);
  });

  it('never applies atmospheric refraction on the Moon, whatever k is requested', () => {
    expect(makeEnv('moon', 4 / 3).kFactor).toBe(1);
    expect(makeEnv('moon').radiusM).toBe(1_737_400);
    expect(makeEnv('earth').radiusM).toBe(6_371_000);
  });
});
