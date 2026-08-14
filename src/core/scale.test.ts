import { describe, expect, it } from 'vitest';
import {
  areaSquareFeet,
  impliedFeetPerPaperInch,
  lengthFeet,
  parseFeetInches,
  scaleFromCalibration,
  scaleFromRatio,
} from './scale';

describe('scaleFromRatio', () => {
  it('converts 1/8" = 1\'-0" correctly', () => {
    // At 1/8" = 1', one paper inch = 8 ft, so one PDF point = 8/72 ft.
    const s = scaleFromRatio(1 / 8, 1);
    expect(s.feetPerUnit).toBeCloseTo(8 / 72, 10);
  });

  it('converts engineering scale 1" = 20\'', () => {
    const s = scaleFromRatio(1, 20);
    expect(s.feetPerUnit).toBeCloseTo(20 / 72, 10);
  });

  it('rejects non-positive inputs', () => {
    expect(() => scaleFromRatio(0, 1)).toThrow();
    expect(() => scaleFromRatio(1, -5)).toThrow();
  });
});

describe('scaleFromCalibration', () => {
  it('derives feet per unit from a traced line', () => {
    // 144 pts = 2 paper inches; user says that is 16 real feet.
    const s = scaleFromCalibration({ x: 0, y: 0 }, { x: 144, y: 0 }, 16);
    expect(s.feetPerUnit).toBeCloseTo(16 / 144, 10);
    // Implied plot scale: 8 ft per paper inch, i.e. 1/8" = 1'.
    expect(impliedFeetPerPaperInch(s)).toBeCloseTo(8, 10);
  });

  it('rejects a zero-length line', () => {
    expect(() => scaleFromCalibration({ x: 5, y: 5 }, { x: 5, y: 5 }, 10)).toThrow();
  });
});

describe('measurements', () => {
  it('measures length in feet', () => {
    const s = scaleFromRatio(1 / 8, 1);
    // 72 pts = 1 paper inch = 8 real ft at 1/8" scale
    expect(lengthFeet({ x: 0, y: 0 }, { x: 72, y: 0 }, s)).toBeCloseTo(8, 10);
  });

  it('measures area in square feet', () => {
    const s = scaleFromRatio(1 / 8, 1);
    // A 72x72 pt square is 8ft x 8ft = 64 sf
    const sq = [
      { x: 0, y: 0 },
      { x: 72, y: 0 },
      { x: 72, y: 72 },
      { x: 0, y: 72 },
    ];
    expect(areaSquareFeet(sq, s)).toBeCloseTo(64, 8);
  });

  it('round-trips ratio and calibration to the same answer', () => {
    const ratio = scaleFromRatio(1 / 4, 1);
    // Calibrate over a line that is 36 pts = 0.5 paper inch = 2 real ft at 1/4"
    const cal = scaleFromCalibration({ x: 0, y: 0 }, { x: 36, y: 0 }, 2);
    expect(cal.feetPerUnit).toBeCloseTo(ratio.feetPerUnit, 10);
  });
});

describe('parseFeetInches', () => {
  it('parses decimal feet', () => {
    expect(parseFeetInches('24.5')).toBeCloseTo(24.5, 10);
    expect(parseFeetInches('24')).toBe(24);
  });

  it('parses feet-inches notation', () => {
    expect(parseFeetInches(`24'-6"`)).toBeCloseTo(24.5, 10);
    expect(parseFeetInches(`24' 6"`)).toBeCloseTo(24.5, 10);
    expect(parseFeetInches(`24ft 6in`)).toBeCloseTo(24.5, 10);
    expect(parseFeetInches(`24' 6 1/2"`)).toBeCloseTo(24 + 6.5 / 12, 10);
  });

  it('parses bare inches', () => {
    expect(parseFeetInches('30"')).toBeCloseTo(2.5, 10);
  });

  it('rejects garbage', () => {
    expect(parseFeetInches('')).toBeNull();
    expect(parseFeetInches('abc')).toBeNull();
    expect(parseFeetInches(`24'-14"`)).toBeNull();
  });
});
