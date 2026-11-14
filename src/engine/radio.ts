import type { RadioProfile } from './types';

/**
 * Illustrative example only. These numbers are plausible for a sub-GHz 802.11ah (Wi-Fi HaLow)
 * module at a low data rate, but they are not taken from a specific datasheet, regulatory limit
 * or qualified lunar hardware. Replace them with measured values for real planning.
 */
export const EXAMPLE_HALOW_PROFILE: RadioProfile = {
  name: 'Example HaLow profile (illustrative)',
  frequencyMHz: 915,
  txPowerDbm: 21,
  txAntennaGainDbi: 3,
  rxAntennaGainDbi: 3,
  antennaHeightM: 3,
  rxSensitivityDbm: -98,
  txCableLossDb: 1,
  rxCableLossDb: 1,
  requiredMarginDb: 10,
};

export interface FieldSpec {
  key: keyof Omit<RadioProfile, 'name'>;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
}

export const RADIO_FIELDS: FieldSpec[] = [
  { key: 'frequencyMHz', label: 'Frequency', unit: 'MHz', min: 100, max: 6000, step: 1 },
  { key: 'txPowerDbm', label: 'Transmit power', unit: 'dBm', min: -20, max: 50, step: 0.5 },
  { key: 'txAntennaGainDbi', label: 'TX antenna gain', unit: 'dBi', min: -10, max: 40, step: 0.5 },
  { key: 'rxAntennaGainDbi', label: 'RX antenna gain', unit: 'dBi', min: -10, max: 40, step: 0.5 },
  { key: 'antennaHeightM', label: 'Antenna height', unit: 'm', min: 0.1, max: 200, step: 0.5 },
  { key: 'rxSensitivityDbm', label: 'Receiver sensitivity', unit: 'dBm', min: -140, max: -30, step: 1 },
  { key: 'txCableLossDb', label: 'TX cable loss', unit: 'dB', min: 0, max: 30, step: 0.5 },
  { key: 'rxCableLossDb', label: 'RX cable loss', unit: 'dB', min: 0, max: 30, step: 0.5 },
  { key: 'requiredMarginDb', label: 'Required link margin', unit: 'dB', min: 0, max: 60, step: 1 },
];

export type RadioErrors = Partial<Record<FieldSpec['key'], string>>;

export function validateRadio(radio: RadioProfile): RadioErrors {
  const errors: RadioErrors = {};
  for (const f of RADIO_FIELDS) {
    const v = radio[f.key];
    if (typeof v !== 'number' || !Number.isFinite(v)) errors[f.key] = 'Enter a number';
    else if (v < f.min || v > f.max) errors[f.key] = `Must be ${f.min} to ${f.max} ${f.unit}`;
  }
  return errors;
}

export function isRadioValid(radio: RadioProfile): boolean {
  return Object.keys(validateRadio(radio)).length === 0;
}
