import { describe, expect, it } from 'vitest';
import {
  crop,
  dedupeAppend,
  downsample,
  matchTemplate,
  mergeMatchSets,
  rotate90,
  toGray,
  type GrayImage,
} from './match';

/** Blank page with a distinctive 16x12 glyph stamped at given positions. */
function makePage(width: number, height: number, stamps: [number, number][]): GrayImage {
  const data = new Float32Array(width * height).fill(255);
  const img = { data, width, height };
  for (const [sx, sy] of stamps) stampGlyph(img, sx, sy);
  return img;
}

function stampGlyph(img: GrayImage, sx: number, sy: number) {
  // Hollow rectangle with a diagonal — structured enough to be unambiguous.
  for (let x = 0; x < 16; x++) {
    set(img, sx + x, sy, 0);
    set(img, sx + x, sy + 11, 0);
  }
  for (let y = 0; y < 12; y++) {
    set(img, sx, sy + y, 0);
    set(img, sx + 15, sy + y, 0);
  }
  for (let d = 0; d < 12; d++) set(img, sx + d, sy + d, 40);
}

function set(img: GrayImage, x: number, y: number, v: number) {
  img.data[y * img.width + x] = v;
}

describe('toGray', () => {
  it('converts RGBA to luminance', () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
    const g = toGray(rgba, 2, 1);
    expect(g.data[0]).toBeCloseTo(255, 0);
    expect(g.data[1]).toBeCloseTo(0, 0);
  });
});

describe('downsample', () => {
  it('averages blocks', () => {
    const img = { data: new Float32Array([0, 100, 200, 100]), width: 2, height: 2 };
    const d = downsample(img, 2);
    expect(d.width).toBe(1);
    expect(d.data[0]).toBeCloseTo(100, 5);
  });
});

describe('crop', () => {
  it('extracts a region', () => {
    const img = makePage(50, 50, [[10, 10]]);
    const c = crop(img, 10, 10, 16, 12);
    expect(c.width).toBe(16);
    expect(c.data[0]).toBe(40); // corner: diagonal overwrites the border
    expect(c.data[1]).toBe(0); // top edge of the glyph border
  });
});

describe('matchTemplate', () => {
  it('finds all copies of a symbol and no false positives', () => {
    const stamps: [number, number][] = [
      [20, 20],
      [120, 24],
      [60, 150],
      [200, 200],
    ];
    const img = makePage(280, 260, stamps);
    // A different shape that must NOT match: solid block.
    for (let y = 100; y < 112; y++)
      for (let x = 230; x < 246; x++) set(img, x, y, 0);

    const tpl = crop(img, 20, 20, 16, 12);
    const matches = matchTemplate(img, tpl, 0.85);

    expect(matches.length).toBe(4);
    for (const [sx, sy] of stamps) {
      const hit = matches.find(
        (m) => Math.abs(m.center.x - (sx + 8)) <= 2 && Math.abs(m.center.y - (sy + 6)) <= 2,
      );
      expect(hit, `stamp at ${sx},${sy}`).toBeTruthy();
      expect(hit!.score).toBeGreaterThan(0.9);
    }
  });

  it('rejects a template with no contrast', () => {
    const img = makePage(100, 100, [[10, 10]]);
    const blank = crop(img, 60, 60, 16, 12);
    expect(() => matchTemplate(img, blank)).toThrow(/contrast/i);
  });
});

describe('mergeMatchSets', () => {
  it('unions matches from multiple templates without double-counting', () => {
    const setA = {
      matches: [
        { center: { x: 10, y: 10 }, score: 0.95 },
        { center: { x: 50, y: 50 }, score: 0.9 },
      ],
      tplW: 16,
      tplH: 12,
    };
    const setB = {
      matches: [
        { center: { x: 11, y: 10 }, score: 0.85 }, // same fixture as A's first
        { center: { x: 90, y: 20 }, score: 0.88 }, // found only by template B
      ],
      tplW: 16,
      tplH: 12,
    };
    const merged = mergeMatchSets([setA, setB]);
    expect(merged).toHaveLength(3);
    // The duplicate kept the higher score
    const first = merged.find((m) => Math.abs(m.center.x - 10) <= 1)!;
    expect(first.score).toBe(0.95);
  });
});

describe('dedupeAppend', () => {
  it('appends only points not already represented', () => {
    const existing = [
      { x: 10, y: 10 },
      { x: 50, y: 50 },
    ];
    const incoming = [
      { x: 12, y: 10 }, // duplicate of first within radius 5
      { x: 80, y: 80 }, // new
    ];
    const out = dedupeAppend(existing, incoming, 5);
    expect(out).toHaveLength(3);
    expect(out[2]).toEqual({ x: 80, y: 80 });
    // existing points keep their positions (indices stay stable for erasures)
    expect(out[0]).toEqual({ x: 10, y: 10 });
  });
});

describe('rotate90', () => {
  it('swaps dimensions and lands pixels where expected', () => {
    // 2x1 image [a, b] -> 1x2 image [a; b] rotated clockwise
    const img = { data: new Float32Array([10, 20]), width: 2, height: 1 };
    const r = rotate90(img);
    expect(r.width).toBe(1);
    expect(r.height).toBe(2);
    expect([...r.data]).toEqual([10, 20]);
  });

  it('four rotations are the identity', () => {
    const img = makePage(30, 20, [[5, 4]]);
    let r = img;
    for (let i = 0; i < 4; i++) r = rotate90(r);
    expect(r.width).toBe(img.width);
    expect([...r.data]).toEqual([...img.data]);
  });

  it('finds a rotated copy when matching rotated templates', () => {
    // One upright glyph and one 90-degree-rotated glyph on the same page.
    const img = makePage(200, 200, [[20, 20]]);
    const glyph = crop(img, 20, 20, 16, 12);
    const rotated = rotate90(glyph);
    // Stamp the rotated glyph at (120, 120).
    for (let y = 0; y < rotated.height; y++)
      for (let x = 0; x < rotated.width; x++)
        img.data[(120 + y) * img.width + (120 + x)] = rotated.data[y * rotated.width + x];

    const sets = [];
    let tpl = glyph;
    for (let rot = 0; rot < 4; rot++) {
      sets.push({ matches: matchTemplate(img, tpl, 0.85), tplW: tpl.width, tplH: tpl.height });
      tpl = rotate90(tpl);
    }
    const merged = mergeMatchSets(sets);
    expect(merged.length).toBe(2);
  });
});
