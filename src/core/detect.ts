import type { PageTextItem, Pt } from '../types';

/**
 * Fixture type tags on lighting plans are short uppercase codes placed next
 * to each fixture symbol: A, B2, F1, EM, X1, A-2, F2E ...
 *
 * The same pattern also matches things that are NOT fixture tags (grid
 * bubbles, panel names, keynotes), which is why detection only produces
 * *candidates* — the user confirms which strings are real fixture types.
 */
const TAG_RE = /^[A-Z]{1,3}-?\d{0,3}[A-Z]?$/;
const MAX_TAG_LEN = 6;

export function isTagCandidate(raw: string): boolean {
  const s = raw.trim();
  if (s.length === 0 || s.length > MAX_TAG_LEN) return false;
  if (!/[A-Z]/.test(s)) return false; // must contain a letter (rules out room numbers)
  return TAG_RE.test(s);
}

export interface TagCandidate {
  tag: string;
  points: Pt[];
}

/**
 * Group candidate tag strings found on a sheet, most frequent first.
 * Each occurrence's position becomes a prospective fixture marker.
 */
export function findTagCandidates(items: PageTextItem[]): TagCandidate[] {
  const byTag = new Map<string, Pt[]>();
  for (const item of items) {
    const s = item.str.trim();
    if (!isTagCandidate(s)) continue;
    const pts = byTag.get(s);
    if (pts) pts.push(item.center);
    else byTag.set(s, [item.center]);
  }
  return [...byTag.entries()]
    .map(([tag, points]) => ({ tag, points }))
    .sort((a, b) => b.points.length - a.points.length || a.tag.localeCompare(b.tag));
}
