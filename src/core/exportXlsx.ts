import * as XLSX from 'xlsx';
import {
  buildExportRows,
  buildMultiSheetRows,
  type ExportMeta,
  type MultiSheetMeta,
  type SheetResults,
} from './exportRows';
import type { AreaResult } from '../types';

/** Build the workbook and trigger a browser download. */
export function downloadXlsx(
  results: AreaResult[],
  tags: string[],
  meta: ExportMeta,
  wattsByType?: Record<string, number>,
): void {
  const rows = buildExportRows(results, tags, meta, wattsByType);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 26 },
    { wch: 12 },
    ...tags.map(() => ({ wch: 8 })),
    { wch: 14 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Takeoff');
  const base = meta.fileName.replace(/\.pdf$/i, '');
  XLSX.writeFile(wb, `${base} - lighting takeoff.xlsx`);
}

/** Whole-set workbook: one table across all sheets that have areas. */
export function downloadMultiSheetXlsx(
  sheets: SheetResults[],
  meta: MultiSheetMeta,
  wattsByType?: Record<string, number>,
): void {
  const rows = buildMultiSheetRows(sheets, meta, wattsByType);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const tagCount = rows[5].length - 4; // Sheet, Area, SF, ...tags, Total
  ws['!cols'] = [
    { wch: 10 },
    { wch: 26 },
    { wch: 12 },
    ...Array.from({ length: tagCount }, () => ({ wch: 8 })),
    { wch: 14 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Takeoff');
  const base = meta.fileName.replace(/\.pdf$/i, '');
  XLSX.writeFile(wb, `${base} - lighting takeoff.xlsx`);
}
