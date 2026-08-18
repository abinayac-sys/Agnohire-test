import { createRequire } from 'node:module';
import mammoth from 'mammoth';
import { createCanvas } from '@napi-rs/canvas';
import { createWorker, type Worker } from 'tesseract.js';
import { logger } from '../config/logger.js';
import { BadRequestError } from './errors.js';

/**
 * Resume text extraction with OCR. Text-based PDFs and DOCX use fast native
 * parsing; image resumes and scanned/image-only PDFs are read with Tesseract
 * OCR (PDF pages are rasterized via pdf.js + a native canvas first). This is
 * what lets the AI parser — and therefore the interview pipeline — work on any
 * resume the candidate uploads.
 */

const require = createRequire(import.meta.url);
// Import the inner lib directly to skip pdf-parse's index.js debug block.
const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (b: Buffer) => Promise<{ text: string }>;

const PDF_MIME = 'application/pdf';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const OCR_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/bmp',
  'image/tiff',
]);

// Below this many characters a PDF's text layer is treated as missing (scanned).
const MIN_PDF_TEXT = 40;
// Cap OCR work so a huge scanned PDF can't stall the queue.
const MAX_OCR_PAGES = 8;

// ── Tesseract worker (lazy singleton; recognize calls are serialized) ─────────
let workerPromise: Promise<Worker> | null = null;
async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('eng').catch((e) => {
      workerPromise = null; // allow a later retry if init failed
      throw e;
    });
  }
  return workerPromise;
}

let ocrChain: Promise<unknown> = Promise.resolve();
/** OCR a single image buffer (PNG/JPEG/…). Serialized to one worker. */
async function ocrImage(image: Buffer): Promise<string> {
  const worker = await getWorker();
  const run = ocrChain.then(async () => {
    const { data } = await worker.recognize(image);
    return data.text;
  });
  ocrChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Rasterize each PDF page to a PNG and OCR it. Used for scanned/image PDFs. */
async function ocrPdf(buffer: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const params = { data: new Uint8Array(buffer), useSystemFonts: true };
  const loadingTask = pdfjs.getDocument(params as Parameters<typeof pdfjs.getDocument>[0]);
  const doc = await loadingTask.promise;

  const pages = Math.min(doc.numPages, MAX_OCR_PAGES);
  let text = '';
  try {
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      // pdf.js' typings expect DOM canvas shapes; the native canvas is compatible
      // at runtime — cast the params through unknown.
      const renderParams = { canvasContext: ctx, viewport, canvas } as unknown as Parameters<
        typeof page.render
      >[0];
      await page.render(renderParams).promise;
      text += (await ocrImage(canvas.toBuffer('image/png'))) + '\n';
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }
  return text;
}

/**
 * Extract readable text from a resume buffer, using OCR when needed.
 * Throws BadRequestError for unsupported types.
 */
export async function extractResumeTextWithOcr(buffer: Buffer, mimeType: string): Promise<string> {
  if (OCR_IMAGE_MIME.has(mimeType)) {
    logger.info('Resume OCR: image', { mimeType });
    return ocrImage(buffer);
  }

  if (mimeType === PDF_MIME) {
    let text = '';
    try {
      text = (await pdfParse(buffer)).text;
    } catch {
      /* corrupt text layer — fall through to OCR */
    }
    if (text.trim().length >= MIN_PDF_TEXT) return text;
    logger.info('Resume OCR: PDF has no usable text layer — rasterizing & OCRing');
    const ocrText = await ocrPdf(buffer);
    return ocrText.trim() ? ocrText : text;
  }

  if (mimeType === DOCX_MIME) {
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  }

  if (mimeType === 'text/plain') return buffer.toString('utf-8');

  throw new BadRequestError('Unsupported file type for text extraction.');
}
