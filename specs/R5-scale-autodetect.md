# R5 — auto-detect plotted scale from sheet text

## Problem
Scale notation is printed on the sheet as real text (verified on real sets:
`3/16" = 1'-0"` in Baekjeong, `SCALE:` blocks generally) but users must pick it
from a dropdown by hand, per sheet.

## Design
New pure module `src/core/scaleDetect.ts`:
- `parseScaleNotation(raw): {paperInches, realFeet, label} | null` — parses
  arch (`1/8" = 1'-0"`, `3/16"=1'`, `1 1/2" = 1'-0"`) and eng (`1" = 20'`,
  `1"=20'-0"`) notations. Rejects `NTS`, ratios like `1:100` (metric, out of
  scope), and dimension strings.
- `detectScales(items: PageTextItem[]): DetectedScale[]` — scans a page's text
  for notations, groups identical ones with occurrence counts, most frequent
  first. Also spots `SCALE: <notation>` adjacency where the notation is a
  separate item (common in titleblocks) by scanning every item independently —
  adjacency is not required, the notation alone is enough.

UI: in ScaleSection, when the page has no scale and detection found notations,
show "On this sheet: <notation> ×N [Use]" one-liners (top 3). Clicking applies
scaleFromRatio. App.tsx already extracts text items per page for tag detection;
reuse that extraction (store detected scales in PageState.candidatesMeta? No —
keep it simple: detect in the same effect and stash in a new store field
`detectedScales` per page).

## Failure mode
A wrong pick is self-evident (absurd square footage) and reversible via the
dropdown. Detail-view scales (`1/2" = 1'-0"` on a detail sheet) may outnumber
the plan scale — that's why the user confirms rather than auto-applying.

## Acceptance
- Unit tests for parseScaleNotation (arch, eng, spacing variants, rejects) and
  detectScales grouping.
- Suite green; no scale is ever applied without a click.
