import { beforeEach, describe, expect, it } from 'vitest';
import {
  computeResults,
  effectiveMarkers,
  emptyPageState,
  useStore,
} from './store';

/** Reset the store to a one-page document before each test. */
function fresh() {
  useStore.getState().setDocument('test.pdf', 3, ['E1', 'E2', 'E3']);
}

function page(n = useStore.getState().currentPage) {
  return useStore.getState().pages[n] ?? emptyPageState;
}

beforeEach(fresh);

describe('effectiveMarkers', () => {
  it('surfaces only enabled tags, with stable derived ids', () => {
    const st = useStore.getState();
    st.setCandidates(1, [
      { tag: 'A', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
      { tag: 'B', points: [{ x: 3, y: 3 }] },
    ]);
    st.toggleTag('A');
    const markers = effectiveMarkers(page());
    expect(markers.map((m) => m.id)).toEqual(['auto:A:0', 'auto:A:1']);
    expect(markers.every((m) => m.tag === 'A')).toBe(true);
  });

  it('erasing an auto marker hides exactly that occurrence', () => {
    const st = useStore.getState();
    st.setCandidates(1, [{ tag: 'A', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }]);
    st.toggleTag('A');
    st.eraseMarker('auto:A:0');
    const markers = effectiveMarkers(page());
    expect(markers.map((m) => m.id)).toEqual(['auto:A:1']);
  });

  it('erasures survive a mergeMatchedPoints re-run (index stability)', () => {
    const st = useStore.getState();
    st.mergeMatchedPoints(1, 'F1', [{ x: 10, y: 10 }, { x: 50, y: 50 }], 5);
    st.eraseMarker('auto:F1:0');
    // Re-run finds the same two plus one new point; existing indices must not move.
    useStore.getState().mergeMatchedPoints(
      1,
      'F1',
      [{ x: 10, y: 10 }, { x: 50, y: 50 }, { x: 90, y: 90 }],
      5,
    );
    const markers = effectiveMarkers(page());
    expect(markers.map((m) => m.id).sort()).toEqual(['auto:F1:1', 'auto:F1:2']);
    // The erased point (10,10) stays erased.
    expect(markers.some((m) => m.pt.x === 10)).toBe(false);
  });

  it('manual markers appear only when their tag is enabled', () => {
    const st = useStore.getState();
    st.addManualMarker('Z', { x: 5, y: 5 });
    // addManualMarker enables the tag itself (R4 fix)…
    expect(effectiveMarkers(page())).toHaveLength(1);
    // …and disabling the tag hides, not deletes, the marker.
    useStore.getState().toggleTag('Z');
    expect(effectiveMarkers(page())).toHaveLength(0);
    expect(page().manualMarkers).toHaveLength(1);
  });
});

describe('setPage', () => {
  it('clears activeTag so a stale type is never carried across sheets', () => {
    const st = useStore.getState();
    st.setActiveTag('C1');
    expect(useStore.getState().activeTag).toBe('C1');
    useStore.getState().setPage(2);
    expect(useStore.getState().activeTag).toBeNull();
  });

  it('keeps per-page state isolated', () => {
    const st = useStore.getState();
    st.setScale({ feetPerUnit: 0.1, label: 'test', source: 'ratio' });
    st.setPage(2);
    expect(page(2).scale).toBeNull();
    expect(page(1).scale?.label).toBe('test');
  });
});

describe('removeTag', () => {
  it('drops points, markers, and erasures for the tag', () => {
    const st = useStore.getState();
    st.setCandidates(1, [{ tag: 'A', points: [{ x: 1, y: 1 }] }]);
    st.toggleTag('A');
    st.addManualMarker('A', { x: 2, y: 2 });
    st.eraseMarker('auto:A:0');
    useStore.getState().removeTag('A');
    const p = page();
    expect(p.candidates).toHaveLength(0);
    expect(p.manualMarkers).toHaveLength(0);
    expect(p.deletedAutoIds).toHaveLength(0);
    expect(effectiveMarkers(p)).toHaveLength(0);
  });
});

describe('computeResults', () => {
  const square = (x: number, y: number, s: number) => [
    { x, y },
    { x: x + s, y },
    { x: x + s, y: y + s },
    { x, y: y + s },
  ];

  it('counts enabled markers per area and totals them', () => {
    const st = useStore.getState();
    st.setCandidates(1, [
      { tag: 'A', points: [{ x: 5, y: 5 }, { x: 50, y: 50 }] },
      { tag: 'B', points: [{ x: 6, y: 6 }] },
    ]);
    st.toggleTag('A');
    useStore.getState().toggleTag('B');
    useStore.getState().addArea(square(0, 0, 10));
    useStore.getState().setScale({ feetPerUnit: 1, label: '1', source: 'ratio' });
    const [r] = computeResults(page());
    expect(r.counts).toEqual({ A: 1, B: 1 });
    expect(r.totalFixtures).toBe(2);
    expect(r.squareFeet).toBe(100);
  });

  it('reports NaN square footage without a scale', () => {
    const st = useStore.getState();
    st.addArea(square(0, 0, 10));
    const [r] = computeResults(page());
    expect(Number.isNaN(r.squareFeet)).toBe(true);
  });

  it('double-counts a marker in overlapping areas (documented behavior)', () => {
    const st = useStore.getState();
    st.setCandidates(1, [{ tag: 'A', points: [{ x: 5, y: 5 }] }]);
    st.toggleTag('A');
    useStore.getState().addArea(square(0, 0, 10));
    useStore.getState().addArea(square(0, 0, 8));
    const results = computeResults(page());
    expect(results[0].counts.A + results[1].counts.A).toBe(2);
  });
});

describe('applyScaleToAllPages', () => {
  it('copies the current scale to every page, visited or not', () => {
    const st = useStore.getState();
    st.setScale({ feetPerUnit: 0.2, label: 'x', source: 'ratio' });
    useStore.getState().applyScaleToAllPages();
    const s = useStore.getState();
    for (let p = 1; p <= s.numPages; p++) {
      expect(s.pages[p]?.scale?.label).toBe('x');
    }
  });

  it('does nothing when the current sheet has no scale', () => {
    useStore.getState().applyScaleToAllPages();
    expect(useStore.getState().pages[2]?.scale ?? null).toBeNull();
  });
});
