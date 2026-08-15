import type { PageState } from './store';
import { useStore } from './store';

/**
 * Bounded undo over page state (markers, erasures, areas, scales, tags).
 * View state (zoom, tool, current page) is deliberately not undoable.
 * Snapshots are cheap: patchPage copies only the touched page, so history
 * entries share structure with the live state.
 */

const MAX_HISTORY = 50;
const history: Record<number, PageState>[] = [];
let restoring = false;

export function undoDepth(): number {
  return history.length;
}

/** Start recording page-state changes. Returns the unsubscribe function. */
export function startUndoTracking(): () => void {
  history.length = 0;
  return useStore.subscribe((state, prev) => {
    if (restoring || state.pages === prev.pages) return;
    // A document switch resets history rather than recording it.
    if (state.fileName !== prev.fileName) {
      history.length = 0;
      return;
    }
    history.push(prev.pages);
    if (history.length > MAX_HISTORY) history.shift();
  });
}

/** Revert the most recent page-state change. No-op on empty history. */
export function undo(): void {
  const prev = history.pop();
  if (!prev) return;
  restoring = true;
  try {
    useStore.getState().replacePages(prev);
  } finally {
    restoring = false;
  }
}
