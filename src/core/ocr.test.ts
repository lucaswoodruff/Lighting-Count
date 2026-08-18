import { describe, expect, it } from 'vitest';
import {
  collectWords,
  looksLikeTag,
  normalizeTagText,
  pickBestTagCandidate,
  scoreTagCandidate,
} from './ocr';

describe('normalizeTagText', () => {
  it('strips characters outside the tag alphabet and uppercases', () => {
    expect(normalizeTagText(' a2\n')).toBe('A2');
    expect(normalizeTagText('F–3 |')).toBe('F3');
    expect(normalizeTagText('F-3')).toBe('F-3');
    expect(normalizeTagText('')).toBe('');
  });
});

describe('looksLikeTag', () => {
  it('accepts typical fixture tags', () => {
    for (const t of ['A2', 'F-3', 'EM1', 'B12', 'X-1', 'L4A', 'S-10', 'W2']) {
      expect(looksLikeTag(t), t).toBe(true);
    }
  });

  it('rejects free text and fragments', () => {
    for (const t of ['', '-', '2', 'TROFFER', 'A-', '1234', 'ABCD1']) {
      expect(looksLikeTag(t), t).toBe(false);
    }
  });
});

describe('pickBestTagCandidate', () => {
  it('prefers a tag-shaped candidate over higher-confidence garbage', () => {
    // Phase 0 spike: confidence alone picks garbage (e.g. "N" at 79 over "L4A").
    const best = pickBestTagCandidate([
      { text: 'N', confidence: 79 },
      { text: 'L4A', confidence: 52 },
    ]);
    expect(best).toMatchObject({ text: 'L4A', isTagShaped: true });
  });

  it('breaks ties between tag-shaped candidates by confidence', () => {
    const best = pickBestTagCandidate([
      { text: 'S-10', confidence: 87 },
      { text: 'S-1', confidence: 60 },
    ]);
    expect(best?.text).toBe('S-10');
  });

  it('falls back to the most confident non-tag text', () => {
    const best = pickBestTagCandidate([
      { text: 'ABCD1', confidence: 40 },
      { text: 'ZZ', confidence: 70 },
    ]);
    expect(best).toMatchObject({ text: 'ZZ', isTagShaped: false });
  });

  it('returns null when every candidate is empty', () => {
    expect(pickBestTagCandidate([])).toBeNull();
    expect(pickBestTagCandidate([{ text: '', confidence: 95 }])).toBeNull();
  });

  it('scores tag-shaped candidates above any confidence value', () => {
    expect(scoreTagCandidate({ text: 'A2', confidence: 0 })).toBeGreaterThan(
      scoreTagCandidate({ text: 'JUNK', confidence: 100 }),
    );
  });
});

describe('collectWords', () => {
  const word = (text: string, x0: number, y0: number, x1: number, y1: number) => ({
    text,
    confidence: 80,
    bbox: { x0, y0, x1, y1 },
  });

  it('flattens the block tree and scales centers back to region space', () => {
    const blocks = [
      {
        paragraphs: [
          { lines: [{ words: [word('TYPE', 0, 0, 30, 12)] }, { words: [word('A2', 0, 30, 30, 42)] }] },
        ],
      },
    ];
    // 3x-upscaled recognition → downscale 1/3 to region coordinates.
    const words = collectWords(blocks, 1 / 3);
    expect(words).toHaveLength(2);
    expect(words[0].text).toBe('TYPE');
    expect(words[0].center.x).toBeCloseTo(5);
    expect(words[0].center.y).toBeCloseTo(2);
    expect(words[1].center.y).toBeCloseTo(12);
  });

  it('skips empty words and tolerates null/missing levels', () => {
    expect(collectWords(null, 1)).toEqual([]);
    expect(collectWords([{}], 1)).toEqual([]);
    expect(
      collectWords([{ paragraphs: [{ lines: [{ words: [word('  ', 0, 0, 5, 5)] }] }] }], 1),
    ).toEqual([]);
  });
});
