import type { PageState } from './store';
import { useStore } from './store';

/**
 * Session persistence: user-authored takeoff state (markers, areas, scales,
 * confirmed types) autosaved to IndexedDB, keyed by document. The PDF itself
 * is never stored — drawings stay on the user's machine, and re-opening the
 * same file reattaches its saved takeoff.
 */

const DB_NAME = 'lighting-takeoff';
const STORE = 'sessions';

export interface SavedSession {
  pages: Record<number, PageState>;
  tagColors: Record<string, string>;
  savedAt: number;
}

/** Stable per-document key: same file → same session, name collisions split by size. */
export function sessionKey(fileName: string, fileSize: number): string {
  return `${fileName}:${fileSize}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export function saveSession(key: string, session: SavedSession): Promise<unknown> {
  return withStore('readwrite', (s) => s.put(session, key));
}

export function loadSession(key: string): Promise<SavedSession | undefined> {
  return withStore('readonly', (s) => s.get(key) as IDBRequest<SavedSession | undefined>);
}

export function clearSession(key: string): Promise<unknown> {
  return withStore('readwrite', (s) => s.delete(key));
}

let unsubscribe: (() => void) | null = null;
let saveTimer: number | undefined;

/**
 * Start autosaving the current document's takeoff state. Replaces any prior
 * autosave subscription (one document open at a time).
 */
export function startAutosave(key: string): void {
  stopAutosave();
  unsubscribe = useStore.subscribe((state, prev) => {
    if (state.pages === prev.pages && state.tagColors === prev.tagColors) return;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      const s = useStore.getState();
      if (!s.fileName) return;
      saveSession(key, {
        pages: s.pages,
        tagColors: s.tagColors,
        savedAt: Date.now(),
      }).catch(() => {
        /* autosave is best-effort; a failed write never interrupts the takeoff */
      });
    }, 800);
  });
}

export function stopAutosave(): void {
  window.clearTimeout(saveTimer);
  unsubscribe?.();
  unsubscribe = null;
}
