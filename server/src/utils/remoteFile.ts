import { ALLOWED_RESUME_TYPES } from './storage.js';

/**
 * Fetches a candidate's resume from a public URL (typically a Google Drive
 * share link) during bulk import. Kept deliberately defensive: normalizes Drive
 * links to direct downloads, guards against obviously-internal hosts (basic
 * SSRF), enforces a size ceiling, and sniffs the real file type so an HTML
 * "sign in / can't download" page is rejected rather than stored as a resume.
 */

export interface FetchedResume {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
  size: number;
}

/**
 * Turn a Google Drive / Docs share URL into a direct-download URL. Other URLs
 * pass through unchanged.
 */
export function toDirectDownloadUrl(raw: string): string {
  const url = raw.trim();
  // https://drive.google.com/file/d/<ID>/view?... → uc?export=download&id=<ID>
  const fileMatch = /drive\.google\.com\/file\/d\/([^/]+)/i.exec(url);
  if (fileMatch) return `https://drive.google.com/uc?export=download&id=${fileMatch[1]}`;
  // https://drive.google.com/open?id=<ID> or ...?id=<ID>
  const idMatch = /drive\.google\.com\/(?:open|uc)\?(?:[^#]*&)?id=([^&]+)/i.exec(url);
  if (idMatch) return `https://drive.google.com/uc?export=download&id=${idMatch[1]}`;
  // Google Docs → export as PDF
  const docMatch = /docs\.google\.com\/document\/d\/([^/]+)/i.exec(url);
  if (docMatch) return `https://docs.google.com/document/d/${docMatch[1]}/export?format=pdf`;
  return url;
}

/** Reject non-http(s) and obviously-internal hosts (best-effort SSRF guard). */
function assertSafeUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('not a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('URL must start with http(s)');
  }
  const host = parsed.hostname.toLowerCase();
  const blocked =
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (blocked) throw new Error('refusing to fetch an internal address');
}

/** Sniff a resume mime type from magic bytes; null if not a known type. */
function sniffMime(buf: Buffer): string | null {
  if (buf.length >= 4 && buf.toString('ascii', 0, 4) === '%PDF') return 'application/pdf';
  // DOCX (and other OOXML) is a zip archive: "PK\x03\x04"
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'image/png';
  }
  return null;
}

const EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
};

function fileNameFrom(res: Response, url: string, fallback: string, ext: string): string {
  const cd = res.headers.get('content-disposition') ?? '';
  const star = /filename\*=(?:UTF-8'')?["']?([^"';]+)/i.exec(cd);
  const plain = /filename=["']?([^"';]+)/i.exec(cd);
  const fromHeader = decodeURIComponent((star?.[1] ?? plain?.[1] ?? '').trim());
  if (fromHeader) return fromHeader;
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop();
    if (last && /\.[a-z0-9]{2,4}$/i.test(last)) return last;
  } catch {
    /* ignore */
  }
  return `${fallback.replace(/[^\w.-]+/g, '_').slice(0, 40) || 'resume'}.${ext}`;
}

/**
 * Download a resume from a public URL. Throws with a human-readable reason on
 * any problem (so callers can record it in a per-row error report).
 */
export async function fetchRemoteResume(
  rawUrl: string,
  opts: { maxBytes: number; fallbackName?: string; timeoutMs?: number },
): Promise<FetchedResume> {
  const url = toDirectDownloadUrl(rawUrl);
  assertSafeUrl(url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  let res: Response;
  try {
    res = await fetch(url, { redirect: 'follow', signal: controller.signal });
  } catch (err) {
    throw new Error(
      (err as Error).name === 'AbortError' ? 'download timed out' : 'could not reach the URL',
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);

  const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (contentType === 'text/html') {
    throw new Error('link is not a public file — set sharing to "Anyone with the link"');
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength === 0) throw new Error('downloaded file is empty');
  if (buffer.byteLength > opts.maxBytes) {
    throw new Error(`file exceeds the ${Math.floor(opts.maxBytes / (1024 * 1024))} MB limit`);
  }

  // Prefer a declared, allowed content-type; otherwise sniff the bytes.
  let mimeType = ALLOWED_RESUME_TYPES[contentType] ? contentType : (sniffMime(buffer) ?? '');
  if (!mimeType && contentType === 'text/plain') mimeType = 'text/plain';
  if (!ALLOWED_RESUME_TYPES[mimeType]) {
    throw new Error('unsupported file type (expected PDF, DOCX, TXT, or an image)');
  }

  const fileName = fileNameFrom(res, rawUrl, opts.fallbackName ?? 'resume', EXT[mimeType] ?? 'bin');
  return { buffer, mimeType, fileName, size: buffer.byteLength };
}
