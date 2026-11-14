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
    // Same shape as the lunar placeholders, with a higher delivery cost per kilogram to the surface.
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
      satTerminalMassKg: 15,
      deliveryUsdPerKg: 2_500_000,
      userSites: 4,
      budgetUsd: 300_000_000,
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
