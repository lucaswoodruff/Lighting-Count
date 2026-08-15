import { describe, expect, it } from 'vitest';
import { detectScales, parseScaleNotation } from './scaleDetect';

describe('parseScaleNotation', () => {
  it('parses architectural notations', () => {
    expect(parseScaleNotation('1/8" = 1\'-0"')).toMatchObject({
      paperInches: 1 / 8,
      realFeet: 1,
    });
    expect(parseScaleNotation('3/16"=1\'-0"')).toMatchObject({
      paperInches: 3 / 16,
      realFeet: 1,
    });
    expect(parseScaleNotation("1/4\" = 1'")).toMatchObject({
      paperInches: 1 / 4,
      realFeet: 1,
    });
    expect(parseScaleNotation('1 1/2" = 1\'-0"')).toMatchObject({
      paperInches: 1.5,
      realFeet: 1,
    });
  });

  it('parses engineering notations', () => {
    expect(parseScaleNotation("1\" = 20'")).toMatchObject({ paperInches: 1, realFeet: 20 });
    expect(parseScaleNotation('1"=40\'-0"')).toMatchObject({ paperInches: 1, realFeet: 40 });
  });

  it('parses a notation embedded in a SCALE: label', () => {
    expect(parseScaleNotation('SCALE: 1/8" = 1\'-0"')).toMatchObject({
      paperInches: 1 / 8,
      realFeet: 1,
    });
  });

  it('rejects non-scales', () => {
    for (const s of ['NTS', 'SCALE: NTS', '1:100', "24'-6\"", 'E2.1', '', "0\" = 1'"]) {
      expect(parseScaleNotation(s), s).toBeNull();
    }
  });

  it('rejects absurd plot ratios', () => {
    expect(parseScaleNotation('1/16" = 1000\'')).toBeNull();
  });
});

describe('detectScales', () => {
  const at = (str: string) => ({ str, center: { x: 0, y: 0 } });

  it('groups identical notations and sorts by frequency', () => {
    const items = [
      at('SCALE: 1/8" = 1\'-0"'),
      at('1/8" = 1\'-0"'),
      at('1/2" = 1\'-0"'), // a detail view's scale
      at('GENERAL NOTES'),
    ];
    const found = detectScales(items);
    expect(found).toHaveLength(2);
    expect(found[0].occurrences).toBe(2);
    expect(found[0].paperInches).toBeCloseTo(1 / 8, 10);
    expect(found[1].occurrences).toBe(1);
  });

  it('returns empty when nothing matches', () => {
    expect(detectScales([at('LIGHTING PLAN'), at('NTS')])).toEqual([]);
  });
});
