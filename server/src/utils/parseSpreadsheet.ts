import * as XLSX from 'xlsx';
import { parse as parseCsv } from 'csv-parse/sync';
import { BadRequestError } from './errors.js';
import type { CsvRow } from '../services/bulkUploadService.js';

/**
 * Parses an uploaded bulk-import file — CSV or Excel (.xlsx/.xls) — into the
 * same header-keyed row shape either way, so every downstream consumer
 * (fuzzy header matching, preview, smart upload) stays format-agnostic.
 *
 * Format is detected by filename extension rather than MIME type: browsers
 * and OSes are inconsistent about what MIME type they attach to spreadsheet
 * uploads (Excel files are commonly mislabeled `application/vnd.ms-excel`,
 * the same type some browsers also use for CSV), so the extension is the
 * only reliable signal.
 */
export function parseSpreadsheet(buffer: Buffer, filename: string): CsvRow[] {
  const isExcel = /\.(xlsx|xls)$/i.test(filename);

  if (isExcel) {
    try {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new Error('Workbook has no sheets');
      const sheet = workbook.Sheets[sheetName];
      // defval: '' so a blank cell still yields a key (matching csv-parse's
      // behavior for an empty CSV field) instead of being omitted entirely,
      // which would otherwise make rows inconsistent shapes.
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false }) as Record<string, unknown>[];
      return rows.map((row) => {
        const out: CsvRow = {};
        for (const [k, v] of Object.entries(row)) out[k] = v == null ? '' : String(v).trim();
        return out;
      });
    } catch (err) {
      throw new BadRequestError(`Could not parse Excel file: ${(err as Error).message}`);
    }
  }

  try {
    return parseCsv(buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: true,
      relax_quotes: true,
    }) as CsvRow[];
  } catch (err) {
    throw new BadRequestError(`Could not parse CSV: ${(err as Error).message}`);
  }
}
