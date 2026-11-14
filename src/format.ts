export const fmtKm = (m: number, digits = 2) => `${(m / 1000).toFixed(digits)} km`;
export const fmtDb = (v: number) => `${v.toFixed(1)} dB`;
export const fmtDbm = (v: number) => `${v.toFixed(1)} dBm`;

export function fmtUsd(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `$${(v / 1e3).toFixed(1)}k`;
  return `$${Math.round(v).toLocaleString('en-US')}`;
}
