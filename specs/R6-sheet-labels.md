# R6 — extract sheet numbers for page labels

## Problem
Real sets often lack embedded PDF page labels (BMI 35 sheets, Walmart 9), so
navigation is "Page N" by ordinal. The sheet number (E2.1, EL401, E1.1A) is on
every sheet as text, but so are cross-references to OTHER sheets ("SEE E0.3"),
so pattern matching alone mislabels.

## Design
New pure module `src/core/sheetLabel.ts`:
- `isSheetNumber(s)` — discipline letter(s) + digits, optional dot/dash
  and suffix letter: E2.1, E2.1A, EL401, A-132.1, E0.3. At least one digit;
  total length ≥ 2; ≤ 10 chars.
- `detectSheetNumber(items, pageW, pageH): string | null` — scores every
  matching item and returns the best: proximity to the bottom-right corner
  (titleblocks live there even when their text is rotated) dominates, with a
  bonus for dotted forms (E2.1 beats a stray grid ref) and for repeats near
  the corner. Cross-refs sit in the drawing field, far from the corner, and
  lose.

Wiring: when `getPageLabels` falls back to "Page N", App extracts labels
per page in the background after load and installs them via a new store
action `setPageLabel(page, label)` — dropdown fills in as they resolve.
Label format: `E2.1` alone (fallback `Page N` stays when nothing matches).

## Acceptance
- Unit tests: pattern accepts/rejects; corner proximity beats a field
  cross-ref; dotted bonus; null when nothing matches.
- Real-world check vs probe data: AASF page 5's items contain E1.1A×2 (corner)
  and the label resolves to E1.1A, not the E0.3 cross-ref.
- Suite green; sets WITH real labels are untouched.
