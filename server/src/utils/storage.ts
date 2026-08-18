import { createRequire } from 'node:module';
import multer from 'multer';
import mammoth from 'mammoth';
import { extractResumeTextWithOcr } from './ocr.js';
import { BadRequestError } from './errors.js';

// Import the inner lib directly to skip pdf-parse's index.js debug block, which
// reads a bundled test PDF at import time and throws under ESM.
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (
  buffer: Buffer,
) => Promise<{ text: string }>;

/** MIME types accepted for resume uploads (images are read via OCR). */
export const ALLOWED_RESUME_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
};

/**
 * Hard safety ceiling for multer (15 MB). The actual configurable limit
 * (screening.resume_max_size_mb) is enforced in the service against file.size,
 * keeping the user-facing limit in the DB per the zero-hardcoded-config rule.
 */
const MULTER_CEILING_BYTES = 15 * 1024 * 1024;

/**
 * In-memory multer storage — the file buffer is persisted to Postgres
 * (Resume.fileData) rather than to local disk, so it works against a cloud DB.
 */
export const resumeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MULTER_CEILING_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_RESUME_TYPES[file.mimetype]) {
      cb(new BadRequestError('Unsupported file type. Upload a PDF, DOCX, TXT, or an image (JPG/PNG).'));
      return;
    }
    cb(null, true);
  },
});

/** MIME types accepted for bulk candidate CSV/Excel uploads. */
const ALLOWED_CSV_TYPES = new Set([
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel', // some browsers label .csv this way; also the legacy .xls type
  'text/plain',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
]);

/** In-memory multer storage for bulk-import CSV/Excel files. */
export const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MULTER_CEILING_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const isAllowedName = /\.(csv|xlsx|xls)$/i.test(file.originalname);
    if (!ALLOWED_CSV_TYPES.has(file.mimetype) && !isAllowedName) {
      cb(new BadRequestError('Please upload a .csv, .xlsx, or .xls file.'));
      return;
    }
    cb(null, true);
  },
});

/** MIME types accepted for generic document attachments (offer docs, letters, BGV reports). */
export const ALLOWED_ATTACHMENT_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/msword', // doc
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.ms-excel', // xls
  'text/plain',
  'text/csv',
  'image/png',
  'image/jpeg',
  'image/webp',
]);

/**
 * In-memory multer storage for generic document attachments. The buffer is
 * persisted to Postgres (Attachment.fileData), same approach as resumes.
 */
export const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MULTER_CEILING_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_ATTACHMENT_TYPES.has(file.mimetype)) {
      cb(new BadRequestError('Unsupported file type. Upload a PDF, Office doc, image, or text file.'));
      return;
    }
    cb(null, true);
  },
});

/** Extracts plain text from a resume buffer based on its MIME type. */
export async function extractResumeText(
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  switch (mimeType) {
    case 'application/pdf': {
      const data = await pdfParse(buffer);
      return data.text;
    }
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
      const { value } = await mammoth.extractRawText({ buffer });
      return value;
    }
    case 'text/plain':
      return buffer.toString('utf-8');
    default:
      throw new BadRequestError('Unsupported file type for text extraction.');
  }
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/** Parse the first HTML <table> (as produced by mammoth) into a grid of cells. */
function parseHtmlTable(html: string): string[][] {
  const tableMatch = /<table[\s\S]*?<\/table>/i.exec(html);
  if (!tableMatch) return [];
  const rows: string[][] = [];
  const trRe = /<tr[\s\S]*?<\/tr>/gi;
  let tr: RegExpExecArray | null;
  while ((tr = trRe.exec(tableMatch[0]))) {
    const cells: string[] = [];
    const tdRe = /<t[dh][\s\S]*?<\/t[dh]>/gi;
    let td: RegExpExecArray | null;
    while ((td = tdRe.exec(tr[0]))) {
      cells.push(decodeEntities(td[0].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim());
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

/** Split delimited plain text (CSV/TSV/space-aligned) into a grid, finding the
 *  delimiter from the header line that contains the question columns. */
function textToRows(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];
  const splitters: ((l: string) => string[])[] = [
    (l) => l.split('\t'),
    (l) => l.split(';'),
    (l) => l.split(','),
    (l) => l.split(/\s{2,}/),
  ];
  for (const split of splitters) {
    // A header is any of the first few lines whose cells include text + type.
    const headerIdx = lines.slice(0, 6).findIndex((l) => {
      const cells = split(l).map((c) => c.trim().toLowerCase());
      return cells.includes('text') && cells.includes('type');
    });
    if (headerIdx >= 0) {
      return lines.slice(headerIdx).map((l) => split(l).map((c) => c.trim()));
    }
  }
  return [];
}

/**
 * Extract a question grid from an uploaded document. DOCX uses its first table;
 * PDF/TXT use delimited text. Returns the grid (may be empty if the document is
 * free-form prose) plus the raw text for an AI fallback.
 */
export async function extractDocumentRows(
  buffer: Buffer,
  mimeType: string,
): Promise<{ rows: string[][]; rawText: string }> {
  if (mimeType === DOCX_MIME) {
    const [{ value: html }, { value: raw }] = await Promise.all([
      mammoth.convertToHtml({ buffer }),
      mammoth.extractRawText({ buffer }),
    ]);
    const rows = parseHtmlTable(html);
    return { rows: rows.length ? rows : textToRows(raw), rawText: raw };
  }
  if (mimeType === 'text/csv' || mimeType.includes('spreadsheetml') || mimeType.includes('excel')) {
    const { parseSpreadsheet } = await import('./parseSpreadsheet.js');
    const records = parseSpreadsheet(buffer, mimeType.includes('spreadsheetml') || mimeType.includes('excel') ? 'file.xlsx' : 'file.csv');
    // Convert array of objects to 2D array string[][]
    if (records.length > 0) {
      const header = Object.keys(records[0]);
      const rows = [header, ...records.map(r => header.map(k => String(r[k] || '')))];
      return { rows, rawText: rows.map(r => r.join(', ')).join('\n') };
    }
    return { rows: [], rawText: '' };
  }
  const rawText = await extractResumeTextWithOcr(buffer, mimeType);
  return { rows: textToRows(rawText), rawText };
}
