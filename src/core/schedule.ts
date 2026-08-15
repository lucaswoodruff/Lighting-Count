import type { PageTextItem } from '../types';

/**
 * Fixture-schedule parsing. The schedule the engineer drew is the
 * authoritative source for fixture types (including numeric ones like `7` or
 * `10R` that tag detection cannot find without matching every dimension on
 * the sheet), the engineer's own per-type count, and input watts — which turn
 * a fixture count into connected load and W/sf.
 *
 * Parsing is column-driven rather than row-banded: header cells locate the
 * TYPE / QTY / WATTS columns, type cells are collected along the TYPE column,
 * and each row's other cells are matched by nearest row position with an
 * adaptive pitch. That survives the tables real drawings actually have —
 * rotated 90°, rows a few points apart, first data row overlapping the
 * header band. Deliberately conservative: a page that doesn't parse cleanly
 * yields nothing rather than junk.
 */

export interface ScheduleEntry {
  type: string;
  /** Engineer's own count column, when present. */
  scheduleCount?: number;
  /** Input watts / VA per fixture, when present. */
  watts?: number;
}

const TYPE_HEADER = /^(TYPE|MARK|SYMBOL|DESIGNATION|TAG)$/i;
const QTY_HEADER = /^(COUNT|QUANTITY|QTY\.?)$/i;
const WATTS_HEADER = /^(WATTS?|WATTAGE|VA|INPUT\s*VA|LOAD)$/i;
const OTHER_HEADERS =
  /^(QTY\.?|QUANTITY|COUNT|DESCRIPTION|MANUFACTURER|MODEL|VOLTAGE|WATTS?|WATTAGE|VA|INPUT\s*VA|LOAD|MOUNTING|LAMP|SOURCE)$/i;
const TYPE_CELL = /^[A-Z0-9][A-Z0-9-]{0,7}$/i;
const NOT_TYPES = /^(NTS|TYP|LED|AFF|UNO|GC|OW|NO|YES|ALL|SEE)$/i;

const COL_TOLERANCE = 15; // cross-axis distance for "same column"
const HEADER_ROW_TOLERANCE = 15; // headers of one table share a row axis

export function looksLikeSchedulePage(items: PageTextItem[]): boolean {
  const joined = items.map((i) => i.str).join(' ').toUpperCase();
  return /(?:LIGHT(?:ING)?\s+)?(?:FIXTURE|LUMINAIRE)S?\s+SCHEDULE/.test(joined);
}

interface Cell {
  str: string;
  /** Position along the reading direction (down the table). */
  row: number;
  /** Position across the table (which column). */
  col: number;
}

/**
 * Parse the fixture schedule on a page. Empty when no clean parse exists.
 * Drawings often rotate the whole table 90°, so both orientations are tried
 * and the better parse wins.
 */
export function parseSchedule(items: PageTextItem[]): ScheduleEntry[] {
  const upright = parseCells(
    items.map((i) => ({ str: i.str.trim(), row: i.center.y, col: i.center.x })),
  );
  const rotated = parseCells(
    items.map((i) => ({ str: i.str.trim(), row: i.center.x, col: i.center.y })),
  );
  return rotated.length > upright.length ? rotated : upright;
}

function parseCells(cells: Cell[]): ScheduleEntry[] {
  // Candidate TYPE headers: must have at least one other schedule header
  // sharing its row axis (a real table header, not the word in a note).
  const typeHeaders = cells.filter(
    (h) =>
      TYPE_HEADER.test(h.str) &&
      cells.some(
        (o) => o !== h && OTHER_HEADERS.test(o.str) && Math.abs(o.row - h.row) <= HEADER_ROW_TOLERANCE,
      ),
  );

  let best: ScheduleEntry[] = [];
  for (const typeHdr of typeHeaders) {
    const entries = parseTable(cells, typeHdr);
    if (entries.length > best.length) best = entries;
  }
  return best.length >= 2 ? best : [];
}

function parseTable(cells: Cell[], typeHdr: Cell): ScheduleEntry[] {
  const headerRow = (re: RegExp) =>
    cells.filter((c) => re.test(c.str) && Math.abs(c.row - typeHdr.row) <= HEADER_ROW_TOLERANCE);

  // Type cells run down the TYPE column, from the header band onward (the
  // first data row can overlap the header band on tight tables).
  const typeCells = cells
    .filter(
      (c) =>
        Math.abs(c.col - typeHdr.col) <= COL_TOLERANCE &&
        c.row >= typeHdr.row - 3 &&
        !TYPE_HEADER.test(c.str) &&
        TYPE_CELL.test(c.str) &&
        !NOT_TYPES.test(c.str),
    )
    .sort((a, b) => a.row - b.row);
  if (typeCells.length < 2) return [];

  // Adaptive row pitch: how far apart this table's rows actually are.
  const diffs = typeCells.slice(1).map((c, i) => c.row - typeCells[i].row).filter((d) => d > 0.5);
  diffs.sort((a, b) => a - b);
  const pitch = diffs[Math.floor(diffs.length / 2)] ?? 10;
  const maxRowDist = Math.max(1.5, pitch * 0.6);

  // A value column can have several plausible headers (LAMP QTY vs COUNT);
  // pick the header whose column actually yields the most parsed values.
  const columnValues = (headers: Cell[], parse: (s: string) => number | undefined) => {
    let bestVals: Map<Cell, number> | null = null;
    for (const hdr of headers) {
      const inCol = cells.filter(
        (c) => c !== hdr && Math.abs(c.col - hdr.col) <= COL_TOLERANCE && c.row >= typeHdr.row - 3,
      );
      const vals = new Map<Cell, number>();
      for (const t of typeCells) {
        let nearest: Cell | null = null;
        for (const c of inCol) {
          if (Math.abs(c.row - t.row) > maxRowDist) continue;
          if (!nearest || Math.abs(c.row - t.row) < Math.abs(nearest.row - t.row)) nearest = c;
        }
        const v = nearest ? parse(nearest.str) : undefined;
        if (v !== undefined) vals.set(t, v);
      }
      if (!bestVals || vals.size > bestVals.size) bestVals = vals;
    }
    return bestVals ?? new Map<Cell, number>();
  };

  const counts = columnValues(headerRow(QTY_HEADER), (s) => {
    const m = s.match(/^\s*(\d{1,4})\s*$/);
    return m ? parseInt(m[1], 10) : undefined;
  });
  const watts = columnValues(headerRow(WATTS_HEADER), (s) => {
    const m = s.match(/^\s*(\d+(?:\.\d+)?)\s*(?:VA|W)?\s*$/i);
    return m ? parseFloat(m[1]) : undefined;
  });

  const entries: ScheduleEntry[] = [];
  const seen = new Set<string>();
  for (const t of typeCells) {
    const type = t.str.toUpperCase();
    if (seen.has(type)) continue;
    seen.add(type);
    const entry: ScheduleEntry = { type };
    if (counts.has(t)) entry.scheduleCount = counts.get(t);
    if (watts.has(t)) entry.watts = watts.get(t);
    entries.push(entry);
  }
  return entries;
}
