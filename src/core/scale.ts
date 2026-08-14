import type { Pt, ScaleSetting } from '../types';
import { distance, polygonArea } from './geometry';

const POINTS_PER_INCH = 72;

/**
 * Scale from a stated plot ratio: `paperInches` on paper = `realFeet` in the
 * world (e.g. 1/8" = 1'-0" is paperInches = 0.125, realFeet = 1). Only valid
 * when the PDF was plotted at its stated sheet size.
 */
export function scaleFromRatio(
  paperInches: number,
  realFeet: number,
  label?: string,
): ScaleSetting {
  if (paperInches <= 0 || realFeet <= 0) {
    throw new Error('Scale ratio values must be positive');
  }
  return {
    feetPerUnit: realFeet / paperInches / POINTS_PER_INCH,
    label: label ?? `${paperInches}" = ${realFeet}'`,
    source: 'ratio',
  };
}

/**
 * Scale from a calibration line: the user traced `a`→`b` over a feature whose
 * true length is `realFeet`.
 */
export function scaleFromCalibration(a: Pt, b: Pt, realFeet: number): ScaleSetting {
  const len = distance(a, b);
  if (len <= 0) throw new Error('Calibration line has zero length');
  if (realFeet <= 0) throw new Error('Calibration length must be positive');
  return {
    feetPerUnit: realFeet / len,
    label: `calibrated: ${realFeet} ft over ${(len / POINTS_PER_INCH).toFixed(2)}" of sheet`,
    source: 'calibration',
  };
}

export function lengthFeet(a: Pt, b: Pt, scale: ScaleSetting): number {
  return distance(a, b) * scale.feetPerUnit;
}

export function areaSquareFeet(pts: Pt[], scale: ScaleSetting): number {
  return polygonArea(pts) * scale.feetPerUnit ** 2;
}

/**
 * The plot ratio implied by a scale, expressed as real feet per paper inch —
 * used to show "your calibration works out to ≈ 1/8″ = 1′" as a sanity check.
 */
export function impliedFeetPerPaperInch(scale: ScaleSetting): number {
  return scale.feetPerUnit * POINTS_PER_INCH;
}

/**
 * Parse a user-entered real-world length. Accepts decimal feet ("24.5"),
 * feet-inches ("24'-6\"", "24' 6\"", "24ft 6in"), or bare inches ("30\"").
 * Returns feet, or null if unparseable.
 */
export function parseFeetInches(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/feet|ft\.?/g, "'").replace(/inches|in\.?/g, '"');
  if (s.length === 0) return null;

  // bare inches: 30"
  const inchOnly = s.match(/^(\d+(?:\.\d+)?)\s*"$/);
  if (inchOnly) return parseFloat(inchOnly[1]) / 12;

  // feet with optional inches: 24  |  24'  |  24'-6"  |  24' 6 1/2"
  const m = s.match(/^(\d+(?:\.\d+)?)\s*'?\s*(?:-?\s*(\d+(?:\.\d+)?)\s*(?:(\d+)\/(\d+))?\s*"?)?$/);
  if (!m) return null;
  const feet = parseFloat(m[1]);
  let inches = m[2] ? parseFloat(m[2]) : 0;
  if (m[3] && m[4] && parseInt(m[4]) !== 0) inches += parseInt(m[3]) / parseInt(m[4]);
  if (inches >= 12 && m[2] && s.includes("'")) return null; // "24'-14"" is a typo
  return feet + inches / 12;
}

export interface NamedRatio {
  label: string;
  paperInches: number;
  realFeet: number;
}

/** Common architectural and engineering scales for the dropdown. */
export const COMMON_SCALES: NamedRatio[] = [
  { label: '1/16" = 1\'-0"', paperInches: 1 / 16, realFeet: 1 },
  { label: '3/32" = 1\'-0"', paperInches: 3 / 32, realFeet: 1 },
  { label: '1/8" = 1\'-0"', paperInches: 1 / 8, realFeet: 1 },
  { label: '3/16" = 1\'-0"', paperInches: 3 / 16, realFeet: 1 },
  { label: '1/4" = 1\'-0"', paperInches: 1 / 4, realFeet: 1 },
  { label: '3/8" = 1\'-0"', paperInches: 3 / 8, realFeet: 1 },
  { label: '1/2" = 1\'-0"', paperInches: 1 / 2, realFeet: 1 },
  { label: '3/4" = 1\'-0"', paperInches: 3 / 4, realFeet: 1 },
  { label: '1" = 1\'-0"', paperInches: 1, realFeet: 1 },
  { label: '1" = 10\'', paperInches: 1, realFeet: 10 },
  { label: '1" = 20\'', paperInches: 1, realFeet: 20 },
  { label: '1" = 30\'', paperInches: 1, realFeet: 30 },
  { label: '1" = 40\'', paperInches: 1, realFeet: 40 },
  { label: '1" = 50\'', paperInches: 1, realFeet: 50 },
];
