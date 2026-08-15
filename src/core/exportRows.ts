import type { AreaResult } from '../types';

export interface ExportMeta {
  fileName: string;
  pageLabel: string;
  scaleLabel: string;
  exportedAt: Date;
}

export type Cell = string | number;

/**
 * Shape the takeoff results into worksheet rows (array-of-arrays), kept free
 * of any SheetJS dependency so it stays unit-testable.
 */
export function buildExportRows(
  results: AreaResult[],
  tags: string[],
  meta: ExportMeta,
): Cell[][] {
  const rows: Cell[][] = [
    ['Lighting Fixture Takeoff'],
    ['Drawing file', meta.fileName],
    ['Sheet', meta.pageLabel],
    ['Scale', meta.scaleLabel],
    ['Exported', meta.exportedAt.toLocaleString()],
    [],
    ['Area', 'Square Feet', ...tags, 'Total Fixtures'],
  ];

  for (const r of results) {
    rows.push([
      r.name,
      round1(r.squareFeet),
      ...tags.map((t) => r.counts[t] ?? 0),
      r.totalFixtures,
    ]);
  }

  if (results.length > 1) {
    rows.push([
      'TOTAL',
      round1(results.reduce((s, r) => s + r.squareFeet, 0)),
      ...tags.map((t) => results.reduce((s, r) => s + (r.counts[t] ?? 0), 0)),
      results.reduce((s, r) => s + r.totalFixtures, 0),
    ]);
  }

  return rows;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export interface SheetResults {
  /** Sheet label, e.g. "E2.1". */
  label: string;
  results: AreaResult[];
  /** Enabled tags on that sheet, in confirmation order. */
  tags: string[];
}

export interface MultiSheetMeta {
  fileName: string;
  exportedAt: Date;
}

/**
 * Whole-set export: one table over all sheets that have areas, with a Sheet
 * column and tag columns unioned across sheets (first-seen order). Sheets
 * without a scale contribute blank square footage rather than NaN.
 */
export function buildMultiSheetRows(sheets: SheetResults[], meta: MultiSheetMeta): Cell[][] {
  const allTags: string[] = [];
  for (const s of sheets) {
    for (const t of s.tags) if (!allTags.includes(t)) allTags.push(t);
  }

  const rows: Cell[][] = [
    ['Lighting Fixture Takeoff'],
    ['Drawing file', meta.fileName],
    ['Sheets', sheets.map((s) => s.label).join(', ')],
    ['Exported', meta.exportedAt.toLocaleString()],
    [],
    ['Sheet', 'Area', 'Square Feet', ...allTags, 'Total Fixtures'],
  ];

  let sfTotal = 0;
  let sfKnown = true;
  const tagTotals = new Map<string, number>(allTags.map((t) => [t, 0]));
  let fixtureTotal = 0;

  for (const s of sheets) {
    for (const r of s.results) {
      const sf = Number.isNaN(r.squareFeet) ? '' : round1(r.squareFeet);
      if (sf === '') sfKnown = false;
      else sfTotal += r.squareFeet;
      rows.push([
        s.label,
        r.name,
        sf,
        ...allTags.map((t) => r.counts[t] ?? 0),
        r.totalFixtures,
      ]);
      for (const t of allTags) tagTotals.set(t, tagTotals.get(t)! + (r.counts[t] ?? 0));
      fixtureTotal += r.totalFixtures;
    }
  }

  const areaCount = sheets.reduce((n, s) => n + s.results.length, 0);
  if (areaCount > 1) {
    rows.push([
      'TOTAL',
      '',
      sfKnown ? round1(sfTotal) : round1(sfTotal), // partial sum when some sheets lack scale
      ...allTags.map((t) => tagTotals.get(t)!),
      fixtureTotal,
    ]);
  }
  return rows;
}
