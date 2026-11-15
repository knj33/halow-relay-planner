import type { BodyId } from './types';

/**
 * Every figure here is an editable placeholder so that architectures can be compared on the same
 * footing. None is a quote, a market price or a mission estimate.
 */
export interface CostModel {
  /** Relay or endpoint HaLow node: hardware, installation labour, mass. */
  relayHardwareUsd: number;
  relayInstallUsd: number;
  relayMassKg: number;
  /** Base station with satellite backhaul terminal. */
  baseHardwareUsd: number;
  baseInstallUsd: number;
  baseMassKg: number;
  /** Handheld / asset-mounted HaLow client radio. */
  clientRadioUsd: number;
  clientMassKg: number;
  /** Conventional tall mast used by the "few tall towers" comparison. */
  towerHeightM: number;
  towerHardwareUsd: number;
  towerInstallUsd: number;
  towerMassKg: number;
  /** Individual satellite terminal used by the "terminal for every user" comparison. */
  satTerminalUsd: number;
  satTerminalMassKg: number;
  /** Transport cost per kilogram to the deployment site (0 on Earth by default). */
  deliveryUsdPerKg: number;
  /** Mobile users or assets that need service inside the region, in addition to A and B. */
  userSites: number;
  budgetUsd: number;
  coverageTargetPct: number;
  clientHeightM: number;
}

/**
 * Mars 2020's whole cost per kilogram landed: about US$2.7 billion (build, launch, landing and the prime
 * mission) for the 1,025 kg Perseverance rover. It already pays for designing, building and testing a
 * flight system, so using it as the delivery rate on top of hardware prices errs high.
 */
export const MARS_LANDED_USD_PER_KG = Math.round(2.7e9 / 1025 / 1000) * 1000;

export interface CostSource {
  id: number;
  title: string;
  publisher: string;
  url: string;
  /** What the planner takes from it. */
  used: string;
}

/** References behind the Mars cost figures, numbered as cited on the Costs page. */
export const COST_SOURCES: CostSource[] = [
  {
    id: 1,
    title: 'Mars 2020 Perseverance launch press kit: quick facts',
    publisher: 'NASA Jet Propulsion Laboratory, 2020',
    url: 'https://www.jpl.nasa.gov/news/press_kits/mars_2020/launch/quick_facts/',
    used: 'About US$2.4 billion to build and launch, about US$300 million to land and operate the prime mission; rover mass about 1,025 kg.',
  },
  {
    id: 2,
    title: 'Mars 2020 mission spending tracker',
    publisher: 'The Planetary Society',
    url: 'https://www.planetary.org/mission-spending/mars-2020-spending',
    used: 'Cross-check of the about US$2.7 billion total.',
  },
  {
    id: 3,
    title: 'NASA awards launch services contract for Mars 2020 rover mission',
    publisher: 'NASA / JPL news release, August 2016',
    url: 'https://www.jpl.nasa.gov/news/nasa-awards-launch-services-contract-for-mars-2020-rover-mission/',
    used: 'Launch alone (Atlas V 541 and related services) was US$243 million, a small part of the per-kilogram total.',
  },
  {
    id: 4,
    title: 'Ingenuity Mars Helicopter landing press kit: quick facts',
    publisher: 'NASA Jet Propulsion Laboratory, 2021',
    url: 'https://www.jpl.nasa.gov/news/press_kits/ingenuity/landing/quick_facts/',
    used: 'About US$85 million to build, carry and operate a 1.8 kg technology demonstrator: the upper bound for a small, one-off Mars device.',
  },
  {
    id: 5,
    title: 'C/TT-510 Electra-Lite transceiver',
    publisher: 'SatCatalog (L3Harris Technologies specification)',
    url: 'https://www.satcatalog.com/component/c-tt-510-electra-lite-transceiver/',
    used: 'The lander version of the Electra UHF relay radio used to reach Mars orbiters, 3.0 kg dry mass: the mass of a surface-to-orbiter terminal.',
  },
  {
    id: 6,
    title: 'AMD XCVE2302 Versal AI Edge (commercial grade) price listing',
    publisher: 'Octopart',
    url: 'https://octopart.com/part/amd/XCVE2302-2HSISFVA784',
    used: 'Listed at about US$6,000 (November 2026) for the commercial version of the base station SoC. The space-grade XQR part is sold by quote only, so this is a floor.',
  },
];

export type CostBasisKind = 'sourced' | 'derived' | 'estimate';

export interface CostBasis {
  kind: CostBasisKind;
  note: string;
  /** COST_SOURCES ids. */
  refs: number[];
}

/** Why each Mars default has the value it has. Fields not listed are scenario choices, not prices. */
export const MARS_COST_BASIS: Partial<Record<keyof CostModel, CostBasis>> = {
  deliveryUsdPerKg: {
    kind: 'derived',
    note: 'US$2.7 billion ÷ 1,025 kg landed (Mars 2020). Includes building and testing a flight system, so it errs high.',
    refs: [1, 2, 3],
  },
  relayHardwareUsd: {
    kind: 'estimate',
    note: 'Team estimate: commercial parts (ESP32-S3, SX1262, charger, GPS) in the low hundreds of dollars, plus qualification and test. Far below a one-off device like Ingenuity.',
    refs: [4],
  },
  relayMassKg: {
    kind: 'estimate',
    note: 'Team estimate: 46 × 110 mm board, Li-ion cell, small solar panel, enclosure and a 3 m mast.',
    refs: [],
  },
  baseHardwareUsd: {
    kind: 'estimate',
    note: 'Team estimate: space-grade Versal SoC (commercial version about US$6,000; the XQR part is quote-only), radiation-hardened power, two HaLow radios and an orbiter relay radio.',
    refs: [5, 6],
  },
  baseMassKg: {
    kind: 'estimate',
    note: 'Team estimate: 240 × 180 mm board, a 3.0 kg Electra-Lite-class orbiter relay radio, power, mast and enclosure.',
    refs: [5],
  },
  clientRadioUsd: { kind: 'estimate', note: 'Team estimate for a suit- or rover-mounted radio.', refs: [] },
  clientMassKg: { kind: 'estimate', note: 'Team estimate.', refs: [] },
  satTerminalUsd: {
    kind: 'estimate',
    note: 'Team estimate for an Electra-Lite-class orbiter relay radio per user. No public price.',
    refs: [5],
  },
  satTerminalMassKg: { kind: 'sourced', note: 'Electra-Lite transceiver, 3.0 kg dry (antenna and power supply not included, so this is a floor).', refs: [5] },
  towerHardwareUsd: { kind: 'estimate', note: 'Team estimate for a 10 m deployable mast with radio.', refs: [] },
  towerMassKg: { kind: 'estimate', note: 'Team estimate.', refs: [] },
};

export function defaultCostModel(body: BodyId): CostModel {
  if (body === 'earth') {
    return {
      relayHardwareUsd: 180,
      relayInstallUsd: 120,
      relayMassKg: 1.5,
      baseHardwareUsd: 4500,
      baseInstallUsd: 1500,
      baseMassKg: 20,
      clientRadioUsd: 60,
      clientMassKg: 0.2,
      towerHeightM: 30,
      towerHardwareUsd: 45_000,
      towerInstallUsd: 35_000,
      towerMassKg: 2500,
      satTerminalUsd: 2500,
      satTerminalMassKg: 5,
      deliveryUsdPerKg: 0,
      userSites: 8,
      budgetUsd: 30_000,
      coverageTargetPct: 60,
      clientHeightM: 1.5,
    };
  }
  if (body === 'mars') {
    // Where each figure comes from: MARS_COST_BASIS and COST_SOURCES below (shown on the Costs page).
    return {
      relayHardwareUsd: 60_000,
      relayInstallUsd: 0,
      relayMassKg: 2,
      baseHardwareUsd: 3_000_000,
      baseInstallUsd: 0,
      baseMassKg: 40,
      clientRadioUsd: 30_000,
      clientMassKg: 0.5,
      towerHeightM: 10,
      towerHardwareUsd: 750_000,
      towerInstallUsd: 0,
      towerMassKg: 120,
      satTerminalUsd: 2_000_000,
      satTerminalMassKg: 3,
      deliveryUsdPerKg: MARS_LANDED_USD_PER_KG,
      userSites: 4,
      // The team's budget for the deployment.
      budgetUsd: 1_000_000_000,
      coverageTargetPct: 60,
      clientHeightM: 1.5,
    };
  }
  return {
    relayHardwareUsd: 40_000,
    relayInstallUsd: 0,
    relayMassKg: 2,
    baseHardwareUsd: 2_000_000,
    baseInstallUsd: 0,
    baseMassKg: 40,
    clientRadioUsd: 20_000,
    clientMassKg: 0.5,
    towerHeightM: 10,
    towerHardwareUsd: 500_000,
    towerInstallUsd: 0,
    towerMassKg: 120,
    satTerminalUsd: 1_500_000,
    satTerminalMassKg: 15,
    deliveryUsdPerKg: 1_000_000,
    userSites: 4,
    budgetUsd: 150_000_000,
    coverageTargetPct: 60,
    clientHeightM: 1.5,
  };
}

export interface CostField {
  key: keyof CostModel;
  label: string;
  unit: string;
  min: number;
  max: number;
  group: 'HaLow nodes' | 'Base station' | 'Traditional alternatives' | 'Scenario';
}

export const COST_FIELDS: CostField[] = [
  { key: 'relayHardwareUsd', label: 'Relay node hardware', unit: 'USD', min: 0, max: 1e9, group: 'HaLow nodes' },
  { key: 'relayInstallUsd', label: 'Relay install labour', unit: 'USD', min: 0, max: 1e9, group: 'HaLow nodes' },
  { key: 'relayMassKg', label: 'Relay node mass', unit: 'kg', min: 0, max: 1e5, group: 'HaLow nodes' },
  { key: 'clientRadioUsd', label: 'Client radio', unit: 'USD', min: 0, max: 1e9, group: 'HaLow nodes' },
  { key: 'clientMassKg', label: 'Client radio mass', unit: 'kg', min: 0, max: 1e5, group: 'HaLow nodes' },
  { key: 'baseHardwareUsd', label: 'Base station hardware', unit: 'USD', min: 0, max: 1e10, group: 'Base station' },
  { key: 'baseInstallUsd', label: 'Base station install', unit: 'USD', min: 0, max: 1e10, group: 'Base station' },
  { key: 'baseMassKg', label: 'Base station mass', unit: 'kg', min: 0, max: 1e5, group: 'Base station' },
  { key: 'towerHeightM', label: 'Tall mast height', unit: 'm', min: 1, max: 200, group: 'Traditional alternatives' },
  { key: 'towerHardwareUsd', label: 'Tall mast hardware', unit: 'USD', min: 0, max: 1e10, group: 'Traditional alternatives' },
  { key: 'towerInstallUsd', label: 'Tall mast install', unit: 'USD', min: 0, max: 1e10, group: 'Traditional alternatives' },
  { key: 'towerMassKg', label: 'Tall mast mass', unit: 'kg', min: 0, max: 1e6, group: 'Traditional alternatives' },
  { key: 'satTerminalUsd', label: 'Satellite terminal', unit: 'USD', min: 0, max: 1e10, group: 'Traditional alternatives' },
  { key: 'satTerminalMassKg', label: 'Satellite terminal mass', unit: 'kg', min: 0, max: 1e5, group: 'Traditional alternatives' },
  { key: 'deliveryUsdPerKg', label: 'Delivery to site', unit: 'USD/kg', min: 0, max: 1e9, group: 'Scenario' },
  { key: 'userSites', label: 'Users / assets to serve', unit: '', min: 0, max: 10_000, group: 'Scenario' },
  { key: 'clientHeightM', label: 'Client antenna height', unit: 'm', min: 0.1, max: 50, group: 'Scenario' },
  { key: 'budgetUsd', label: 'Budget', unit: 'USD', min: 0, max: 1e12, group: 'Scenario' },
  { key: 'coverageTargetPct', label: 'Coverage target', unit: '%', min: 0, max: 100, group: 'Scenario' },
];

/**
 * Inputs used only by the architecture comparison (tall masts, a terminal per user, the coverage
 * target). The comparison is not shown in the app any more, so these are hidden from the Costs page;
 * they stay in the model, the export and the engine's analysis.
 */
export const COMPARISON_ONLY: ReadonlySet<keyof CostModel> = new Set<keyof CostModel>([
  'towerHeightM',
  'towerHardwareUsd',
  'towerInstallUsd',
  'towerMassKg',
  'satTerminalUsd',
  'satTerminalMassKg',
  'coverageTargetPct',
]);

export function isCostValid(c: CostModel): boolean {
  return COST_FIELDS.every((f) => {
    const v = c[f.key];
    return Number.isFinite(v) && v >= f.min && v <= f.max;
  });
}

export interface CostLine {
  label: string;
  count: number;
  unitUsd: number;
  totalUsd: number;
}

const unit = (hardware: number, install: number, massKg: number, c: CostModel) => hardware + install + massKg * c.deliveryUsdPerKg;

export function relayUnitUsd(c: CostModel): number {
  return unit(c.relayHardwareUsd, c.relayInstallUsd, c.relayMassKg, c);
}
export function baseUnitUsd(c: CostModel): number {
  return unit(c.baseHardwareUsd, c.baseInstallUsd, c.baseMassKg, c);
}
export function clientUnitUsd(c: CostModel): number {
  return unit(c.clientRadioUsd, 0, c.clientMassKg, c);
}
export function towerUnitUsd(c: CostModel): number {
  return unit(c.towerHardwareUsd, c.towerInstallUsd, c.towerMassKg, c);
}
export function satTerminalUnitUsd(c: CostModel): number {
  return unit(c.satTerminalUsd, 0, c.satTerminalMassKg, c);
}

export function costLines(items: { label: string; count: number; unitUsd: number }[]): { lines: CostLine[]; totalUsd: number } {
  const lines = items.filter((i) => i.count > 0).map((i) => ({ ...i, totalUsd: i.count * i.unitUsd }));
  return { lines, totalUsd: lines.reduce((s, l) => s + l.totalUsd, 0) };
}
