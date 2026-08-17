# R7 — matching in a Web Worker + 90° rotations

## Problems
1. `matchTemplate` runs on the main thread: on a dense sheet with a small
   template the tab freezes with no progress and no cancel.
2. Rotated symbol copies are not matched (documented limitation); users run
   once per orientation.

## Design
- `rotate90(img)` added to `src/core/match.ts` (pure, tested). Each example
  template is matched at 0/90/180/270 and the results merged with the existing
  `mergeMatchSets` (same-symbol NMS), so rotated CAD placements are found in
  one run. Templates whose rotation equals another (near-square symmetric)
  just produce duplicate hits that NMS collapses.
- `src/workers/matchWorker.ts`: module worker (Vite `new Worker(new URL(...))`)
  receiving `{image, templates, threshold}`, posting
  `{type:'progress', done, total}` after each template×rotation and
  `{type:'done', matches, minTplDim}` at the end. Gray rasters are cloned to
  the worker (transfer would detach the LRU-cached buffer).
- App: match effect spawns the worker, updates matchStatus with progress
  ("Searching… 3/8"), and terminates the worker on cleanup — switching pages,
  starting a new match, or unmounting cancels the run. UI stays responsive.

## Acceptance
- rotate90 unit-tested (dimensions swap, pixels land where expected, 4× = id).
- matchTemplate finds a 90°-rotated copy when run over rotated templates and
  merged (test in match.test.ts).
- Build green (worker bundles), suite green. Main thread no longer runs NCC.
