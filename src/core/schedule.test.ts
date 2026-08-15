import { describe, expect, it } from 'vitest';
import { looksLikeSchedulePage, parseSchedule } from './schedule';
import type { PageTextItem } from '../types';

const at = (str: string, x: number, y: number): PageTextItem => ({ str, center: { x, y } });

/** Walmart-shaped schedule: numeric types, QTY and INPUT VA columns. */
function walmartish(): PageTextItem[] {
  return [
    at('LIGHT FIXTURE SCHEDULE', 300, 40),
    // header row
    at('TYPE', 50, 100),
    at('DESCRIPTION', 200, 100),
    at('VOLTAGE', 400, 100),
    at('INPUT VA', 500, 100),
    at('MOUNTING', 600, 100),
    at('QTY', 700, 100),
    // data rows
    at('7', 50, 130),
    at("1'x4' VOLUMETRIC TROFFER", 200, 130),
    at('120/277', 400, 130),
    at('33 VA', 500, 130),
    at('RECESSED', 600, 130),
    at('19', 700, 130),

    at('10R', 50, 160),
    at("2'x4' TROFFER RETROFIT", 200, 160),
    at('120/277', 400, 160),
    at('32 VA', 500, 160),
    at('RECESSED', 600, 160),
    at('16', 700, 160),

    at('58V', 50, 190),
    at('SUSPENDED STRUCTURE', 200, 190),
    at('120/277', 400, 190),
    at('400 VA', 500, 190),
    at('SUSPENDED', 600, 190),
    at('6', 700, 190),

    // junk below the table that must not parse as rows
    at('GENERAL NOTES', 300, 300),
    at('1.', 50, 330),
    at('ALL FIXTURES SHALL BE LED.', 200, 330),
  ];
}

describe('looksLikeSchedulePage', () => {
  it('detects schedule pages', () => {
    expect(looksLikeSchedulePage(walmartish())).toBe(true);
    expect(looksLikeSchedulePage([at('LIGHTING PLAN', 10, 10)])).toBe(false);
  });
});

describe('parseSchedule', () => {
  it('parses numeric types with counts and watts', () => {
    const entries = parseSchedule(walmartish());
    expect(entries).toEqual([
      { type: '7', scheduleCount: 19, watts: 33 },
      { type: '10R', scheduleCount: 16, watts: 32 },
      { type: '58V', scheduleCount: 6, watts: 400 },
    ]);
  });

  it('returns nothing without a recognizable header row', () => {
    expect(parseSchedule([at('A', 50, 100), at('19', 700, 100)])).toEqual([]);
  });

  it('discards a parse with fewer than two entries', () => {
    const items = [
      at('TYPE', 50, 100),
      at('QTY', 700, 100),
      at('7', 50, 130),
      at('19', 700, 130),
      // only one data row
    ];
    expect(parseSchedule(items)).toEqual([]);
  });

  it('skips rows whose type cell is not a clean token and dedupes repeats', () => {
    const items = [
      at('TYPE', 50, 100),
      at('DESCRIPTION', 200, 100),
      at('QTY', 700, 100),
      at('A', 50, 130), at('DOWNLIGHT', 200, 130), at('4', 700, 130),
      at('SEE NOTE 3', 50, 160), at('junk', 200, 160),
      at('A', 50, 190), at('REPEATED', 200, 190), at('9', 700, 190),
      at('B', 50, 220), at('SCONCE', 200, 220), at('2', 700, 220),
    ];
    const entries = parseSchedule(items);
    expect(entries.map((e) => e.type)).toEqual(['A', 'B']);
    expect(entries[0].scheduleCount).toBe(4); // first A wins
  });
});

describe('parseSchedule on a rotated table', () => {
  it('parses when the table runs 90 degrees to the page', () => {
    // Same schedule, axes swapped: columns along y, rows advancing in x.
    const rotated = walmartish().map((i) => ({
      str: i.str,
      center: { x: i.center.y, y: i.center.x },
    }));
    const entries = parseSchedule(rotated);
    expect(entries).toEqual([
      { type: '7', scheduleCount: 19, watts: 33 },
      { type: '10R', scheduleCount: 16, watts: 32 },
      { type: '58V', scheduleCount: 6, watts: 400 },
    ]);
  });
});
