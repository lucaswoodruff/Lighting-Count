# R2 — fixture schedule parsing, count cross-check, wattage export

## Problem
The fixture schedule the engineer already drew carries the authoritative type
list (including numeric types like `7`, `10R` that no tag regex can find
without drowning in dimensions), a per-type COUNT (free ground truth), and
INPUT VA (count × VA = connected load; with area, W/sf — the T24 metric).
The app ignores it entirely. Verified on the Walmart set: 0 of its 22 real
schedule types pass isTagCandidate().

## Design — fully client-side, no LLM required
`src/core/schedule.ts` (pure, tested):
- `looksLikeSchedulePage(items)`: text contains "FIXTURE SCHEDULE" (or
  LUMINAIRE SCHEDULE).
- `parseSchedule(items)`:
  1. group items into rows by y (tolerance 5 pt), sort by y;
  2. header row = row containing a TYPE-ish header (TYPE/MARK/SYMBOL) plus at
     least one other known header (QTY/COUNT, DESCRIPTION, WATTS/VA/INPUT VA,
     VOLTAGE, MANUFACTURER, MOUNTING);
  3. column bins = midpoints between header x positions; assign each data-row
     item to its bin;
  4. a data row yields `{type, scheduleCount?, watts?}` when its TYPE cell is
     a short token; numbers parsed out of QTY and WATTS/VA cells.
- Conservative: rows without a plausible type cell are skipped; a parse that
  yields < 2 entries is discarded (not a schedule).

Wiring:
- Store: document-level `schedule: ScheduleEntry[]` + `schedulePageLabel`,
  action `setSchedule`.
- App: after open, background-scan pages for a schedule (first hit wins).
- TagSection: when a schedule exists, a "Seed N types from schedule" button
  adds each schedule type as a (confirmable) tag on the current sheet — this
  is the numeric-type escape hatch; the user still confirms/erases as always.
- ResultsSection: cross-check note per enabled tag with a scheduleCount:
  "schedule says N — you counted M" (only shown when they differ).
- Export: when schedule watts exist, single- and multi-sheet exports gain
  "Connected W" and "W/sf" per area row (count × watts summed over tags).

## Failure handling
A misparsed schedule produces wrong seeds/counts — absorbed by the existing
candidates-not-answers UX (seeded tags arrive unchecked-equivalent: they're
enabled but have zero auto points until matched/added; cross-check is a note,
never an auto-correction; watts columns are omitted when absent).

## Acceptance
- parseSchedule unit tests on synthetic Walmart-shaped rows (numeric types,
  QTY + INPUT VA columns, junk rows skipped, <2 entries discarded).
- Export tests for the wattage columns.
- Suite green.
