import type { Antenna, Env, HeightGrid, LinkResult, RadioProfile } from './types';
import { cellSizeM, sampleElevation } from './terrain/grid';

export const SPEED_OF_LIGHT = 299_792_458;
/** Fraction of the first Fresnel radius that must be free of terrain for a link to count as unobstructed. */
export const FRESNEL_CLEARANCE_FRACTION = 0.6;

export function mhzToHz(mhz: number): number {
  return mhz * 1e6;
}

export function wavelengthM(frequencyHz: number): number {
  return SPEED_OF_LIGHT / frequencyHz;
}

/** Free-space path loss in dB for a distance in metres and a frequency in Hz. */
export function fsplDb(distanceM: number, frequencyHz: number): number {
  if (distanceM <= 0) return 0;
  return 20 * Math.log10((4 * Math.PI * distanceM * frequencyHz) / SPEED_OF_LIGHT);
}

/** Radius of the first Fresnel zone at a point d1 from one end and d2 from the other, metres. */
export function fresnelRadiusM(d1: number, d2: number, lambdaM: number): number {
  const d = d1 + d2;
  if (d <= 0) return 0;
  return Math.sqrt((lambdaM * d1 * d2) / d);
}

/** Apparent terrain rise caused by body curvature at d1/d2 along a path, metres. */
export function curvatureBulgeM(d1: number, d2: number, env: Env): number {
  return (d1 * d2) / (2 * env.kFactor * env.radiusM);
}

/** ITU-R P.526 single knife-edge approximation. v is the dimensionless Fresnel-Kirchhoff parameter. */
export function knifeEdgeLossDb(v: number): number {
  if (v <= -0.78) return 0;
  return 6.9 + 20 * Math.log10(Math.sqrt((v - 0.1) * (v - 0.1) + 1) + v - 0.1);
}

/** Received power before any terrain loss: Ptx + Gtx + Grx - cable losses - FSPL. */
export function freeSpaceRxPowerDbm(radio: RadioProfile, distanceM: number): number {
  return (
    radio.txPowerDbm +
    radio.txAntennaGainDbi +
    radio.rxAntennaGainDbi -
    radio.txCableLossDb -
    radio.rxCableLossDb -
    fsplDb(distanceM, mhzToHz(radio.frequencyMHz))
  );
}

/** Longest distance at which free-space loss alone still meets sensitivity + required margin, metres. */
export function maxFreeSpaceRangeM(radio: RadioProfile): number {
  const budgetDb =
    radio.txPowerDbm +
    radio.txAntennaGainDbi +
    radio.rxAntennaGainDbi -
    radio.txCableLossDb -
    radio.rxCableLossDb -
    radio.rxSensitivityDbm -
    radio.requiredMarginDb;
  return (SPEED_OF_LIGHT / (4 * Math.PI * mhzToHz(radio.frequencyMHz))) * Math.pow(10, budgetDb / 20);
}

const km = (m: number) => (m / 1000).toFixed(2);

/**
 * Evaluate one point-to-point link over the terrain grid.
 *
 * The terrain profile is sampled between the antennas, raised by the curvature bulge for the
 * body radius and k-factor, and compared with the straight ray. Geometric line of sight and
 * first-Fresnel-zone clearance are reported separately. Received power is free-space loss plus
 * a single knife-edge estimate for the worst intrusion.
 */
export function evaluateLink(grid: HeightGrid, env: Env, radio: RadioProfile, a: Antenna, b: Antenna): LinkResult {
  const lambda = wavelengthM(mhzToHz(radio.frequencyMHz));
  const za = sampleElevation(grid, a.x, a.y) + a.heightM;
  const zb = sampleElevation(grid, b.x, b.y) + b.heightM;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const distanceM = Math.hypot(d, zb - za);

  let minClr = Infinity;
  let minClrFlat = Infinity;
  let minFrac = Infinity;
  let worstAt = 0;

  if (d > 1) {
    const step = cellSizeM(grid) * 0.75;
    const n = Math.max(8, Math.min(600, Math.ceil(d / step)));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const d1 = t * d;
      const d2 = d - d1;
      const ground = sampleElevation(grid, a.x + dx * t, a.y + dy * t);
      const ray = za + (zb - za) * t;
      const clrFlat = ray - ground;
      const clr = clrFlat - curvatureBulgeM(d1, d2, env);
      const f1 = fresnelRadiusM(d1, d2, lambda);
      const frac = f1 > 0 ? clr / f1 : Infinity;
      if (clr < minClr) minClr = clr;
      if (clrFlat < minClrFlat) minClrFlat = clrFlat;
      if (frac < minFrac) {
        minFrac = frac;
        worstAt = d1;
      }
    }
  }

  const losClear = minClr > 0;
  const fresnelClear = minFrac >= FRESNEL_CLEARANCE_FRACTION;
  const blockedByCurvature = !losClear && minClrFlat > 0;
  const diffractionLossDb = Number.isFinite(minFrac) ? knifeEdgeLossDb(-minFrac * Math.SQRT2) : 0;
  const fspl = fsplDb(distanceM, mhzToHz(radio.frequencyMHz));
  const rxPowerDbm = freeSpaceRxPowerDbm(radio, distanceM) - diffractionLossDb;
  const marginDb = rxPowerDbm - radio.rxSensitivityDbm;
  const marginOk = marginDb >= radio.requiredMarginDb;

  const reasons: string[] = [];
  if (!losClear) {
    reasons.push(
      blockedByCurvature
        ? `Blocked by body curvature: the surface bulge rises ${(-minClr).toFixed(1)} m above the ray about ${km(worstAt)} km along the path (beyond the radio horizon for these antenna heights).`
        : `Terrain blocks geometric line of sight about ${km(worstAt)} km along the path (${(-minClr).toFixed(1)} m above the ray).`,
    );
  }
  if (!marginOk) {
    reasons.push(
      `Link margin ${marginDb.toFixed(1)} dB is below the required ${radio.requiredMarginDb.toFixed(1)} dB ` +
        `(free-space loss ${fspl.toFixed(1)} dB over ${km(distanceM)} km` +
        (diffractionLossDb > 0.05 ? `, plus ~${diffractionLossDb.toFixed(1)} dB obstruction loss` : '') +
        ').',
    );
  }
  if (losClear && !fresnelClear) {
    reasons.push(
      `First Fresnel zone is only ${Math.max(0, minFrac * 100).toFixed(0)}% clear about ${km(worstAt)} km along the path ` +
        `(${(FRESNEL_CLEARANCE_FRACTION * 100).toFixed(0)}% needed). A ~${diffractionLossDb.toFixed(1)} dB knife-edge loss estimate is included; expect extra fading.`,
    );
  }

  const status = !losClear || !marginOk ? 'fail' : fresnelClear ? 'good' : 'marginal';

  return {
    status,
    distanceM,
    fsplDb: fspl,
    diffractionLossDb,
    rxPowerDbm,
    marginDb,
    losClear,
    minClearanceM: Number.isFinite(minClr) ? minClr : 0,
    worstAtM: worstAt,
    fresnelClear,
    worstFresnelFraction: Number.isFinite(minFrac) ? minFrac : 99,
    blockedByCurvature,
    reasons,
  };
}
