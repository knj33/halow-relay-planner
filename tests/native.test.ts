import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadTerrainFromEngine, parseGridResponse } from '../src/native/engine';

/** Build the little-endian HRG1 framing the native engine returns. */
function hrg1(cols: number, rows: number, values: number[], overrides: { magic?: string; version?: number; widthM?: number; heightM?: number } = {}): ArrayBuffer {
  const buf = new ArrayBuffer(32 + cols * rows * 4);
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  const magic = overrides.magic ?? 'HRG1';
  for (let i = 0; i < 4; i++) bytes[i] = magic.charCodeAt(i);
  view.setUint32(4, overrides.version ?? 1, true);
  view.setUint32(8, cols, true);
  view.setUint32(12, rows, true);
  view.setFloat32(16, overrides.widthM ?? 20_000, true);
  view.setFloat32(20, overrides.heightM ?? 20_000, true);
  view.setFloat32(24, Math.min(...values), true);
  view.setFloat32(28, Math.max(...values), true);
  values.forEach((v, i) => view.setFloat32(32 + i * 4, v, true));
  return buf;
}

describe('parseGridResponse', () => {
  it('reads the header and row-major float32 elevations', () => {
    const grid = parseGridResponse(hrg1(3, 2, [100, 110, 120, 200, 210, 220]));

    expect(grid.cols).toBe(3);
    expect(grid.rows).toBe(2);
    expect(grid.widthM).toBe(20_000);
    expect(grid.heightM).toBe(20_000);
    expect(grid.minElevM).toBe(100);
    expect(grid.maxElevM).toBe(220);
    expect(Array.from(grid.data)).toEqual([100, 110, 120, 200, 210, 220]);
  });

  it('rejects a truncated header', () => {
    expect(() => parseGridResponse(new ArrayBuffer(16))).toThrow(/truncated/i);
  });

  it('rejects an unknown magic or version', () => {
    expect(() => parseGridResponse(hrg1(2, 2, [0, 0, 0, 0], { magic: 'NOPE' }))).toThrow(/format/i);
    expect(() => parseGridResponse(hrg1(2, 2, [0, 0, 0, 0], { version: 2 }))).toThrow(/format/i);
  });

  it('rejects a payload shorter than cols × rows', () => {
    const buf = hrg1(4, 4, new Array(16).fill(0));
    expect(() => parseGridResponse(buf.slice(0, 40))).toThrow(/size/i);
  });

  it('rejects impossible grid dimensions', () => {
    expect(() => parseGridResponse(hrg1(1, 1, [0]))).toThrow(/size/i);
    expect(() => parseGridResponse(hrg1(0, 0, []))).toThrow(/size/i);
  });
});

it('rejects non-finite elevations and invalid physical dimensions', () => {
  expect(() => parseGridResponse(hrg1(2, 2, [0, NaN, 0, 0]))).toThrow(/elevation/i);
  expect(() => parseGridResponse(hrg1(2, 2, [0, 0, 0, 0], { widthM: -1 }))).toThrow(/elevation/i);
});

afterEach(() => vi.unstubAllGlobals());

it('rejects an older helper that silently changes the requested grid', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(hrg1(2, 2, [0, 0, 0, 0]), { status: 200 })));
  await expect(loadTerrainFromEngine('earth', { centre: { lat: 0, lon: 0 }, sizeM: 20_000 }, 65)).rejects.toThrow(/different planning area or grid size/i);
});
