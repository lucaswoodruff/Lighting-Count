# R1 — session persistence + undo

## Problem
Nothing survives a refresh: scale, confirmed types, corrections, areas, and
the loaded PDF are all lost (confirmed in QA). There is also no undo, so a
mis-click erase is unrecoverable.

## Design
### Persistence (IndexedDB)
- `src/state/persist.ts`: minimal IDB wrapper (`saveSession` / `loadSession` /
  `clearSession`) storing one record per document key.
- Key: `${fileName}:${fileSize}` — stable across reopens of the same file,
  distinct across different drawings sharing a name.
- What's saved: `{ pages, tagColors, savedAt }` (everything user-authored).
  The PDF bytes are NOT saved (privacy stance + size); on reopen of the same
  file the takeoff state reattaches.
- Autosave: store subscription, debounced 800 ms.
- Restore: on open, if a session exists, `window.confirm` offers restore;
  declining clears it. Restoring bumps the internal id counter past every
  restored `manual:`/`area:` id so new ids can't collide.

### Undo (Ctrl+Z)
- `src/state/undo.ts`: bounded (50) history of `pages` snapshots captured via
  store subscription; Ctrl+Z pops. Structural sharing keeps snapshots cheap
  (patchPage copies only the touched page). Undo covers page-state mutations
  (markers, erasures, areas, scales, tags) — not view state (zoom/tool/page).
- A `restoring` flag prevents undo itself from pushing history.

## Acceptance
- Reload → reopen same file → confirm → scale/types/areas/markers back.
- Ctrl+Z reverts an erase, an added marker, an area, a scale change; capped.
- Restored sessions never produce duplicate marker/area ids (tested).
- Suite green in node env (IDB wrapper excluded; logic pure-tested).
