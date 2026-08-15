import type { PageTextItem } from '../types';

/**
 * Detect plotted-scale notations printed on the sheet, so the user can apply
 * the drawing's own stated scale with one click instead of retyping it.
 *
 * Only imperial notations are recognized:
 *   architectural  1/8" = 1'-0"   3/16"=1'   1 1/2" = 1'-0"
 *   engineering    1" = 20'       1"=20'-0"
 * `NTS` and metric ratios (1:100) are deliberately not parsed.
 */

export interface ParsedScale {
  paperInches: number;
  realFeet: number;
  /** Normalized display form, e.g. `1/8" = 1'-0"`. */
  label: string;
}

/** `1 1/2` | `3/16` | `0.125` → inches, or null. */
function parseInches(s: string): number | null {
  const m = s.trim().match(/^(\d+(?:\.\d+)?)?\s*(?:(\d+)\s*\/\s*(\d+))?$/);
  if (!m || (!m[1] && !m[2])) return null;
  const whole = m[1] ? parseFloat(m[1]) : 0;
  const frac = m[2] && m[3] && parseInt(m[3]) !== 0 ? parseInt(m[2]) / parseInt(m[3]) : 0;
  const v = whole + frac;
  return v > 0 ? v : null;
}

const NOTATION_RE =
  /(\d+(?:\.\d+)?(?:\s+\d+\s*\/\s*\d+)?|\d+\s*\/\s*\d+)\s*(?:"|″|''|IN\b)\s*=\s*(\d+(?:\.\d+)?)\s*(?:'|′|FT\b)(?:\s*-?\s*0+\s*(?:"|″|''))?/i;

/** Parse one scale notation out of a string, or null. */
export function parseScaleNotation(raw: string): ParsedScale | null {
  const m = raw.match(NOTATION_RE);
  if (!m) return null;
  const paperInches = parseInches(m[1]);
  const realFeet = parseFloat(m[2]);
  if (paperInches === null || !(realFeet > 0)) return null;
  // Dimension strings ("2' - 6\" = ...") don't match because the inches side
  // must come first; still, reject absurd plot ratios as a backstop.
  const feetPerInch = realFeet / paperInches;
  if (feetPerInch < 0.5 || feetPerInch > 500) return null;
  const label =
    realFeet === 1 ? `${m[1].replace(/\s+/g, ' ').trim()}" = 1'-0"` : `${m[1].trim()}" = ${realFeet}'`;
  return { paperInches, realFeet, label };
}

export interface DetectedScale extends ParsedScale {
  /** How many times this notation appears on the sheet. */
  occurrences: number;
}

/**
 * All scale notations on a sheet, grouped, most frequent first. Detail views
 * carry their own scales, so frequency is a hint, not an answer — the user
 * confirms which notation is the plan scale.
 */
export function detectScales(items: PageTextItem[]): DetectedScale[] {
  const byLabel = new Map<string, DetectedScale>();
  for (const item of items) {
    const parsed = parseScaleNotation(item.str);
    if (!parsed) continue;
    const cur = byLabel.get(parsed.label);
    if (cur) cur.occurrences++;
    else byLabel.set(parsed.label, { ...parsed, occurrences: 1 });
  }
  return [...byLabel.values()].sort(
    (a, b) => b.occurrences - a.occurrences || a.label.localeCompare(b.label),
  );
}
