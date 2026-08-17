# R3 — apply-scale-to-all + whole-set export

## Problems
1. Scale is per-sheet; a 35-sheet set plotted at one scale needs 35 entries.
2. Export builds from the current sheet only; multi-sheet jobs are merged by
   hand.

## Design
Scale: an "All sheets" button next to the current-scale display copies the
current sheet's scale to every page that doesn't have a DIFFERENT explicit
scale... simpler and more predictable: copies to every page of the document
(existing per-page scales are overwritten only after confirm()). Store action
`applyScaleToAllPages()` writes the current page's scale into every page
1..numPages (creating page states as needed).

Export: `buildWorkbookRows` grows a multi-sheet variant:
- exportRows.ts gains `buildMultiSheetRows(sheets: {label, results, tags}[], meta)`
  → one table with a leading "Sheet" column; tag columns are the union across
  sheets in first-seen order; per-sheet subtotal rows omitted, one grand TOTAL.
- SidePanel export button exports ALL sheets that have ≥1 area (current-sheet
  behavior when only the current sheet has areas — no behavior change for
  single-sheet jobs). Button label reflects it ("Export 3 sheets to Excel").
- Sheets without a scale export with blank SF (NaN → '' cell), never block the
  others.

## Acceptance
- applyScaleToAllPages covers visited and unvisited pages.
- Multi-sheet rows: union tag columns, Sheet column, grand total; unit-tested.
- Single-sheet export unchanged (existing tests keep passing).
