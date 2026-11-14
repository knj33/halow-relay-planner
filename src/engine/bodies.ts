import type { Body, BodyId, Env } from './types';
import { BODY_IDS } from './types';

export const BODIES: Record<BodyId, Body> = {
  earth: {
    id: 'earth',
    name: 'Earth',
    radiusM: 6_371_000,
    defaultKFactor: 4 / 3,
    kFactorEditable: true,
    kFactorNote: 'Earth standard atmosphere ≈ 1.33',
    regionSizeM: 20_000,
  },
  moon: {
    id: 'moon',
    name: 'Moon',
    radiusM: 1_737_400,
    defaultKFactor: 1,
    kFactorEditable: false,
    kFactorNote: 'Fixed at 1: no atmosphere',
    regionSizeM: 12_000,
  },
  mars: {
    id: 'mars',
    name: 'Mars',
    // IAU mean radius. The elevation data is referenced to the MOLA areoid on a 3396.19 km sphere.
    radiusM: 3_389_500,
    defaultKFactor: 1,
    kFactorEditable: false,
    kFactorNote: 'Fixed at 1: the thin CO₂ atmosphere bends radio negligibly',
    regionSizeM: 15_000,
  },
};

export function isBodyId(v: unknown): v is BodyId {
  return typeof v === 'string' && (BODY_IDS as readonly string[]).includes(v);
}

/**
 * Build the curvature environment. The Moon and Mars ignore any requested k-factor: there is no
 * atmosphere on the Moon, and the Martian atmosphere (~0.6% of Earth's surface pressure) gives a
 * refractivity two orders of magnitude below Earth's, so k ≈ 1.
 */
export function makeEnv(body: BodyId, kFactor?: number): Env {
  const b = BODIES[body];
  const k = b.kFactorEditable && kFactor !== undefined && Number.isFinite(kFactor) && kFactor > 0 ? kFactor : b.defaultKFactor;
  return { radiusM: b.radiusM, kFactor: k };
}
