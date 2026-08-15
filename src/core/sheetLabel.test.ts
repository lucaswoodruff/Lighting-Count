import { describe, expect, it } from 'vitest';
import { detectSheetNumber, isSheetNumber } from './sheetLabel';

describe('isSheetNumber', () => {
  it('accepts common sheet-number forms', () => {
    for (const s of ['E2.1', 'E2.1A', 'EL401', 'E0.3', 'A-132.1', 'E111', 'M1.02']) {
      expect(isSheetNumber(s), s).toBe(true);
    }
  });

  it('rejects non-sheet strings', () => {
    for (const s of ['LIGHTING', 'A', '201', '1/8"', '', 'NOTE 3', 'E2.1.1.1000X']) {
      expect(isSheetNumber(s), JSON.stringify(s)).toBe(false);
    }
  });

  it('rejects short undotted strings that are usually fixture tags', () => {
    for (const s of ['A1', 'C2', 'F1']) {
      expect(isSheetNumber(s), s).toBe(false);
    }
    expect(isSheetNumber('E111')).toBe(true); // long undotted is fine
  });
});

describe('detectSheetNumber', () => {
  const W = 1000;
  const H = 700;
  const at = (str: string, x: number, y: number) => ({ str, center: { x, y } });

  it('prefers the titleblock corner over a field cross-reference', () => {
    const items = [
      at('E0.3', 400, 300), // "SEE E0.3" in the middle of the plan
      at('E2.1A', 960, 660), // titleblock, bottom-right
    ];
    expect(detectSheetNumber(items, W, H)).toBe('E2.1A');
  });

  it('ignores fixture-tag lookalikes in the field', () => {
    const items = [
      at('C1', 200, 200),
      at('F2', 500, 350),
      at('EL401', 950, 680),
    ];
    expect(detectSheetNumber(items, W, H)).toBe('EL401');
  });

  it('returns null when the only matches are far from the corner', () => {
    expect(detectSheetNumber([at('E0.3', 100, 100)], W, H)).toBeNull();
  });

  it('returns null for pages with no matching text', () => {
    expect(detectSheetNumber([at('GENERAL NOTES', 950, 680)], W, H)).toBeNull();
    expect(detectSheetNumber([], W, H)).toBeNull();
  });
});
