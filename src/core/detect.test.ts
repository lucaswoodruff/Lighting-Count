import { describe, expect, it } from 'vitest';
import { findTagCandidates, isTagCandidate } from './detect';

describe('isTagCandidate', () => {
  it('accepts typical fixture tags', () => {
    for (const tag of ['A', 'B2', 'F1', 'EM', 'X1', 'A-2', 'F2E', 'LP1', 'W']) {
      expect(isTagCandidate(tag), tag).toBe(true);
    }
  });

  it('rejects room numbers, sentences, and long strings', () => {
    for (const s of ['201', '1', 'LIGHTING', 'The', 'a1', '1/8" = 1\'-0"', 'EM-102-B', '', '   ']) {
      expect(isTagCandidate(s), JSON.stringify(s)).toBe(false);
    }
  });

  it('tolerates surrounding whitespace', () => {
    expect(isTagCandidate(' B2 ')).toBe(true);
  });
});

describe('findTagCandidates', () => {
  it('groups occurrences by tag and sorts by count desc', () => {
    const items = [
      { str: 'A', center: { x: 1, y: 1 } },
      { str: 'B2', center: { x: 2, y: 2 } },
      { str: 'A', center: { x: 3, y: 3 } },
      { str: 'A', center: { x: 4, y: 4 } },
      { str: 'ROOM 201', center: { x: 5, y: 5 } },
      { str: 'B2 ', center: { x: 6, y: 6 } },
    ];
    const result = findTagCandidates(items);
    expect(result.map((r) => r.tag)).toEqual(['A', 'B2']);
    expect(result[0].points).toHaveLength(3);
    expect(result[1].points).toHaveLength(2);
  });

  it('breaks count ties alphabetically', () => {
    const items = [
      { str: 'C', center: { x: 1, y: 1 } },
      { str: 'A', center: { x: 2, y: 2 } },
    ];
    expect(findTagCandidates(items).map((r) => r.tag)).toEqual(['A', 'C']);
  });

  it('returns empty for no candidates', () => {
    expect(findTagCandidates([])).toEqual([]);
  });
});
