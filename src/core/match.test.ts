import { describe, expect, it } from 'vitest';
import { crop, downsample, matchTemplate, toGray, type GrayImage } from './match';

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
