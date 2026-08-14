import * as XLSX from 'xlsx';
import { buildExportRows, type ExportMeta } from './exportRows';
import type { AreaResult } from '../types';

/** Build the workbook and trigger a browser download. */
export function downloadXlsx(results: AreaResult[], tags: string[], meta: ExportMeta): void {
  const rows = buildExportRows(results, tags, meta);
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
