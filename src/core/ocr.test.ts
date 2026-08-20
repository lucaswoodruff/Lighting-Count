import { describe, expect, it } from 'vitest';
import { binarize, expandBox, pickTagNear, voteTag } from './ocr';

describe('binarize', () => {
  it('keeps near-black ink and erases gray linework', () => {
    const img = { data: new Float32Array([0, 90, 160, 255]), width: 4, height: 1 };
    const b = binarize(img, 120);
    expect([...b.data]).toEqual([0, 0, 255, 255]);
  });
});

describe('pickTagNear', () => {
  const center = { x: 100, y: 100 };

  it('prefers the canonical letters+digits form over a closer pure-letter read', () => {
    // Real F1E case: "NL" (night light note) sits closer to the symbol.
    const words = [
      { text: 'NL', cx: 90, cy: 110 },
      { text: 'F1E', cx: 140, cy: 90 },
    ];
    expect(pickTagNear(words, center)).toBe('F1E');
  });

  it('breaks a same-rank tie by distance', () => {
    const words = [
      { text: 'HP14', cx: 300, cy: 60 }, // mounting note far away
      { text: 'F5', cx: 120, cy: 95 },
    ];
    expect(pickTagNear(words, center)).toBe('F5');
  });

  it('ignores non-tag words entirely', () => {
    const words = [
      { text: 'LIGHTING', cx: 100, cy: 100 },
      { text: '12', cx: 101, cy: 101 },
      { text: 'B2', cx: 300, cy: 300 },
    ];
    expect(pickTagNear(words, center)).toBe('B2');
  });

  it('falls back to a pure-letter tag when nothing canonical was read', () => {
    expect(pickTagNear([{ text: 'EM', cx: 120, cy: 100 }], center)).toBe('EM');
  });

  it('returns null when nothing usable was read', () => {
    expect(pickTagNear([], center)).toBeNull();
    expect(pickTagNear([{ text: 'THE', cx: 0, cy: 0 }], center)).toBeNull();
  });
});

describe('voteTag', () => {
  it('majority-votes across crops', () => {
    expect(voteTag(['F1', 'F1', 'FT'])).toBe('F1');
  });

  it('ignores nulls and keeps first-seen on ties', () => {
    expect(voteTag([null, 'F1', null, 'F2'])).toBe('F1');
  });

  it('returns null when every crop failed', () => {
    expect(voteTag([null, null])).toBeNull();
  });
});

describe('expandBox', () => {
  it('grows the box in all directions', () => {
    const r = expandBox({ x: 100, y: 100 }, { x: 120, y: 110 }, 1000, 1000);
    expect(r.x).toBeLessThan(100);
    expect(r.y).toBeLessThan(100);
    expect(r.x + r.w).toBeGreaterThan(120);
    expect(r.y + r.h).toBeGreaterThan(110);
  });

  it('clamps to the page', () => {
    const r = expandBox({ x: 2, y: 2 }, { x: 20, y: 12 }, 100, 50);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.x + r.w).toBeLessThanOrEqual(100);
    expect(r.y + r.h).toBeLessThanOrEqual(50);
  });

  it('handles boxes drawn in any corner order', () => {
    const r1 = expandBox({ x: 120, y: 110 }, { x: 100, y: 100 }, 1000, 1000);
    const r2 = expandBox({ x: 100, y: 100 }, { x: 120, y: 110 }, 1000, 1000);
    expect(r1).toEqual(r2);
  });
});
