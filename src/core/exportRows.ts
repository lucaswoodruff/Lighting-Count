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
/** Connected load for one area from schedule watts: sum(count x watts). */
function connectedWatts(
  counts: Record<string, number>,
  tags: string[],
  watts: Record<string, number>,
): number | null {
  let total = 0;
  let any = false;
  for (const t of tags) {
    const w = watts[t];
    if (w === undefined) continue;
    total += (counts[t] ?? 0) * w;
    any = true;
  }
  return any ? total : null;
}

export function buildExportRows(
  results: AreaResult[],
  tags: string[],
  meta: ExportMeta,
  wattsByType?: Record<string, number>,
): Cell[][] {
  const rows: Cell[][] = [
    ['Lighting Fixture Takeoff'],
    ['Drawing file', meta.fileName],
    ['Sheet', meta.pageLabel],
    ['Scale', meta.scaleLabel],
    ['Exported', meta.exportedAt.toLocaleString()],
    [],
    [
      'Area',
      'Square Feet',
      ...tags,
      'Total Fixtures',
      ...(wattsByType ? ['Connected W', 'W/sf'] : []),
    ],
  ];

  const wattCols = (r: AreaResult): Cell[] => {
    if (!wattsByType) return [];
    const w = connectedWatts(r.counts, tags, wattsByType);
    if (w === null) return ['', ''];
    const wsf = r.squareFeet > 0 && !Number.isNaN(r.squareFeet) ? round2(w / r.squareFeet) : '';
    return [round1(w), wsf];
  };

  for (const r of results) {
    rows.push([
      r.name,
      round1(r.squareFeet),
      ...tags.map((t) => r.counts[t] ?? 0),
      r.totalFixtures,
      ...wattCols(r),
    ]);
  }

  if (results.length > 1) {
    const totalSf = results.reduce((s, r) => s + r.squareFeet, 0);
    const totalW = wattsByType
      ? results.reduce((s, r) => s + (connectedWatts(r.counts, tags, wattsByType) ?? 0), 0)
      : 0;
    rows.push([
      'TOTAL',
      round1(totalSf),
      ...tags.map((t) => results.reduce((s, r) => s + (r.counts[t] ?? 0), 0)),
      results.reduce((s, r) => s + r.totalFixtures, 0),
      ...(wattsByType
        ? [round1(totalW), totalSf > 0 && !Number.isNaN(totalSf) ? round2(totalW / totalSf) : '']
        : []),
    ]);
  }

  return rows;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
export function buildMultiSheetRows(
  sheets: SheetResults[],
  meta: MultiSheetMeta,
  wattsByType?: Record<string, number>,
): Cell[][] {
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
    [
      'Sheet',
      'Area',
      'Square Feet',
      ...allTags,
      'Total Fixtures',
      ...(wattsByType ? ['Connected W', 'W/sf'] : []),
    ],
  ];

  let sfTotal = 0;
  let wTotal = 0;
  const tagTotals = new Map<string, number>(allTags.map((t) => [t, 0]));
  let fixtureTotal = 0;

  for (const s of sheets) {
    for (const r of s.results) {
      const sf = Number.isNaN(r.squareFeet) ? '' : round1(r.squareFeet);
      if (sf !== '') sfTotal += r.squareFeet;
      const wattCells: Cell[] = [];
      if (wattsByType) {
        const w = connectedWatts(r.counts, allTags, wattsByType);
        if (w === null) wattCells.push('', '');
        else {
          wattCells.push(round1(w));
          wattCells.push(sf !== '' && r.squareFeet > 0 ? round2(w / r.squareFeet) : '');
          wTotal += w;
        }
      }
      rows.push([
        s.label,
        r.name,
        sf,
        ...allTags.map((t) => r.counts[t] ?? 0),
        r.totalFixtures,
        ...wattCells,
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
      round1(sfTotal), // partial sum when some sheets lack scale
      ...allTags.map((t) => tagTotals.get(t)!),
      fixtureTotal,
      ...(wattsByType
        ? [round1(wTotal), sfTotal > 0 ? round2(wTotal / sfTotal) : '']
        : []),
    ]);
  }
  return rows;
}
