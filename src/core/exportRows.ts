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
