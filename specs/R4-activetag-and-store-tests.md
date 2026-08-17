# R4 — activeTag leak fix + store test suite

## Problem
`setPage` clears pending calibration/match state but leaves `activeTag`. After a
sheet change, Add Fixture clicks store markers whose tag is not in the new
sheet's `enabledTags`; `effectiveMarkers` filters them out, so clicks are
accepted and silently discarded. Reproduced live 2026-08-14 (QA T1).

Separately, `src/state/store.ts` is the largest logic file with zero test
coverage, and holds the derived-ID invariant (`auto:<tag>:<index>`): anything
that reorders a candidate's points silently remaps the user's erasures.

## Decision
Defense in depth, two independent fixes:
1. `setPage` clears `activeTag` (stale cross-sheet selection is never carried).
2. `addManualMarker` enables the marker's tag on the page if not already
   enabled (a stored marker is always visible/counted, whatever path added it).

## Acceptance
- Switching sheets resets the Add Fixture type selector.
- A manual marker is never invisible: adding one for a not-yet-enabled tag
  enables that tag.
- New `src/state/store.test.ts` covers: effectiveMarkers filtering + erasure by
  derived ID, index-stability of erasures across mergeMatchedPoints re-runs,
  manual-marker visibility, computeResults counts and NaN-without-scale,
  setPage clearing activeTag, removeTag cleanup.
- Full suite green; no behavioral change other than the two fixes.
