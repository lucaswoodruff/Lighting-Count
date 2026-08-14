import { describe, expect, it } from 'vitest';
import { distance, pointInPolygon, polygonArea } from './geometry';

const square10 = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe('polygonArea', () => {
  it('computes a square', () => {
    expect(polygonArea(square10)).toBe(100);
  });

  it('is orientation-independent', () => {
    expect(polygonArea([...square10].reverse())).toBe(100);
  });

  it('computes a triangle', () => {
    expect(
      polygonArea([
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 0, y: 3 },
      ]),
    ).toBe(6);
  });

  it('handles a non-convex (L-shaped) room', () => {
    // 10x10 square with a 5x5 bite out of one corner
    const lShape = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(polygonArea(lShape)).toBe(75);
  });

  it('returns 0 for degenerate input', () => {
    expect(polygonArea([])).toBe(0);
    expect(polygonArea([{ x: 1, y: 1 }])).toBe(0);
    expect(polygonArea([{ x: 1, y: 1 }, { x: 2, y: 2 }])).toBe(0);
  });
});

describe('pointInPolygon', () => {
  it('detects inside and outside', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square10)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, square10)).toBe(false);
    expect(pointInPolygon({ x: -1, y: -1 }, square10)).toBe(false);
  });

  it('handles the notch of a non-convex polygon', () => {
    const lShape = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon({ x: 2, y: 8 }, lShape)).toBe(true);
    expect(pointInPolygon({ x: 8, y: 8 }, lShape)).toBe(false); // in the bite
  });

  it('returns false for degenerate polygons', () => {
    expect(pointInPolygon({ x: 0, y: 0 }, [])).toBe(false);
  });
});

describe('distance', () => {
  it('computes euclidean distance', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});
