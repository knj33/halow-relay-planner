import { describe, expect, it } from 'vitest';
import { fitArea, gridPointsFor, maxAreaM } from '../src/engine/area';

describe('optional native area budgets', () => {
  it('keeps browser limits and enables larger native areas', () => {
    expect(maxAreaM('earth')).toBe(150_000);
    expect(maxAreaM('moon')).toBe(60_000);
    expect(maxAreaM('earth', true)).toBe(300_000);
    expect(maxAreaM('moon', true)).toBe(120_000);
    expect(maxAreaM('mars')).toBe(60_000);
    expect(maxAreaM('mars', true)).toBe(120_000);
    const points = [{ lat: 0, lon: 0 }, { lat: 0, lon: 1.5 }];
    expect(fitArea('earth', points, null)?.ok).toBe(false);
    const fitted = fitArea('earth', points, null, true);
    expect(fitted?.ok).toBe(true);
    if (fitted?.ok) expect(fitted.area.sizeM).toBe(250_000);
  });
  it('bounds memory while giving the native loader finer grids', () => {
    expect(gridPointsFor('earth', 300_000)).toBe(769);
    expect(gridPointsFor('earth', 300_000, true)).toBe(1537);
    expect(gridPointsFor('moon', 120_000)).toBe(257);
    expect(gridPointsFor('moon', 120_000, true)).toBe(769);
  });
});
