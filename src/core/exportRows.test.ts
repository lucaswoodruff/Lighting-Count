import { describe, expect, it } from 'vitest';
import { buildExportRows } from './exportRows';
import type { AreaResult } from '../types';

const meta = {
  fileName: 'plan.pdf',
  pageLabel: 'E2.1',
  scaleLabel: '1/8" = 1\'-0"',
  exportedAt: new Date(2026, 7, 13, 12, 0, 0),
};

function result(name: string, sf: number, counts: Record<string, number>): AreaResult {
  return {
    areaId: name,
    name,
    squareFeet: sf,
    counts,
    totalFixtures: Object.values(counts).reduce((a, b) => a + b, 0),
  };
}

describe('buildExportRows', () => {
  it('produces header, one row per area, and a totals row', () => {
    const rows = buildExportRows(
      [result('Office 201', 450.26, { A: 6, B2: 2 }), result('Corridor', 120, { A: 3 })],
      ['A', 'B2'],
      meta,
    );
    const header = rows[6];
    expect(header).toEqual(['Area', 'Square Feet', 'A', 'B2', 'Total Fixtures']);
    expect(rows[7]).toEqual(['Office 201', 450.3, 6, 2, 8]);
    expect(rows[8]).toEqual(['Corridor', 120, 3, 0, 3]);
    expect(rows[9]).toEqual(['TOTAL', 570.3, 9, 2, 11]);
  });

  it('omits the totals row for a single area', () => {
    const rows = buildExportRows([result('Office', 100, { A: 1 })], ['A'], meta);
    expect(rows.at(-1)).toEqual(['Office', 100, 1, 1]);
  });

  it('includes metadata block', () => {
    const rows = buildExportRows([], ['A'], meta);
    expect(rows[1]).toEqual(['Drawing file', 'plan.pdf']);
    expect(rows[2]).toEqual(['Sheet', 'E2.1']);
    expect(rows[3]).toEqual(['Scale', '1/8" = 1\'-0"']);
  });
});
