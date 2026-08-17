import { describe, expect, it } from 'vitest';
import { buildExportRows, buildMultiSheetRows } from './exportRows';
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

describe('buildMultiSheetRows', () => {
  it('unions tag columns across sheets and adds a Sheet column', () => {
    const rows = buildMultiSheetRows(
      [
        { label: 'E2.1', results: [result('Office', 100, { A: 2 })], tags: ['A'] },
        { label: 'E2.2', results: [result('Lab', 200, { B: 3 })], tags: ['B'] },
      ],
      { fileName: 'plan.pdf', exportedAt: new Date(2026, 7, 14) },
    );
    const header = rows[5];
    expect(header).toEqual(['Sheet', 'Area', 'Square Feet', 'A', 'B', 'Total Fixtures']);
    expect(rows[6]).toEqual(['E2.1', 'Office', 100, 2, 0, 2]);
    expect(rows[7]).toEqual(['E2.2', 'Lab', 200, 0, 3, 3]);
    expect(rows[8]).toEqual(['TOTAL', '', 300, 2, 3, 5]);
  });

  it('leaves square footage blank for sheets without a scale', () => {
    const rows = buildMultiSheetRows(
      [{ label: 'E2.1', results: [result('Office', NaN, { A: 1 })], tags: ['A'] }],
      { fileName: 'plan.pdf', exportedAt: new Date(2026, 7, 14) },
    );
    expect(rows[6][2]).toBe('');
  });
});

describe('wattage columns', () => {
  it('adds Connected W and W/sf when schedule watts are provided', () => {
    const rows = buildExportRows(
      [result('Office', 100, { '7': 3, '10R': 2 })],
      ['7', '10R'],
      meta,
      { '7': 33, '10R': 32 },
    );
    expect(rows[6]).toEqual([
      'Area', 'Square Feet', '7', '10R', 'Total Fixtures', 'Connected W', 'W/sf',
    ]);
    // 3*33 + 2*32 = 163 W over 100 sf
    expect(rows[7]).toEqual(['Office', 100, 3, 2, 5, 163, 1.63]);
  });

  it('omits the columns without watts (existing format unchanged)', () => {
    const rows = buildExportRows([result('Office', 100, { A: 1 })], ['A'], meta);
    expect(rows[6]).toEqual(['Area', 'Square Feet', 'A', 'Total Fixtures']);
  });

  it('multi-sheet export carries the same columns and totals them', () => {
    const rows = buildMultiSheetRows(
      [
        { label: 'E1', results: [result('A1', 100, { '7': 1 })], tags: ['7'] },
        { label: 'E2', results: [result('B1', 100, { '7': 2 })], tags: ['7'] },
      ],
      { fileName: 'p.pdf', exportedAt: new Date(2026, 7, 14) },
      { '7': 33 },
    );
    expect(rows.at(-1)).toEqual(['TOTAL', '', 200, 3, 3, 99, 0.5]);
  });
});
