import type { PageTextItem } from '../types';

/**
 * Best-effort sheet-number detection for PDFs without embedded page labels.
 *
 * Every sheet prints its number (E2.1, EL401, E1.1A) — but sheets also
 * reference OTHER sheets in notes ("SEE E0.3"), so the pattern alone is not
 * enough. The titleblock lives at the bottom-right corner of the sheet (its
 * text is often rotated, but its position is not), so proximity to that
 * corner picks the sheet's own number over cross-references in the field.
 */

const SHEET_RE = /^[A-Z]{1,3}-?\d{1,4}(?:\.\d{1,2})?[A-Z]?$/;

export function isSheetNumber(raw: string): boolean {
  const s = raw.trim();
  if (s.length < 2 || s.length > 10) return false;
  if (!/\d/.test(s)) return false;
  // Undotted short strings (A1, C2) are fixture tags and grid refs far more
  // often than sheet numbers; real undotted sheets (E111, EL401) run longer.
  if (!s.includes('.') && s.replace('-', '').length < 4) return false;
  return SHEET_RE.test(s);
}

/**
 * The most plausible sheet number on a page, or null. `pageW`/`pageH` are the
 * page dimensions in the same space as the item centers.
 */
export function detectSheetNumber(
  items: PageTextItem[],
  pageW: number,
  pageH: number,
): string | null {
  const diag = Math.hypot(pageW, pageH);
  if (diag === 0) return null;

  let best: { s: string; score: number } | null = null;
  for (const item of items) {
    const s = item.str.trim();
    if (!isSheetNumber(s)) continue;
    // 1 at the bottom-right corner, 0 at the opposite corner.
    const d = Math.hypot(pageW - item.center.x, pageH - item.center.y) / diag;
    let score = 1 - d;
    // Dotted forms (E2.1) are sheet numbers far more often than undotted
    // strings, which collide with grid refs and fixture tags.
    if (s.includes('.')) score += 0.15;
    if (!best || score > best.score) best = { s, score };
  }
  // Below this the "match" is somewhere in the field — likely a cross-ref
  // or a tag, not the titleblock. Prefer no label over a wrong one.
  return best && best.score >= 0.75 ? best.s : null;
}
