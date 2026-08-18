import { describe, it, expect, beforeAll } from 'vitest';
import { api, authed, login, ADMIN, SCOPED_RECRUITER, serverUp } from './helpers.js';

/**
 * Generic file attachment store: upload returns metadata + a download URL;
 * download streams identical bytes; unsupported types are rejected; auth is
 * required. Backs offer documents, offer letters, and BGV reports.
 */
describe('File attachments (/api/files)', () => {
  let up = false;
  let token = '';
  const pdf = Buffer.from('%PDF-1.4 agnohire attachment test payload');

  beforeAll(async () => {
    up = await serverUp();
    if (up) token = await login();
  });

  it('requires authentication to upload', async () => {
    if (!up) return;
    const res = await api()
      .post('/api/files')
      .attach('file', pdf, { filename: 'x.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(401);
  });

  it('uploads and downloads byte-identical content', async () => {
    if (!up) return;
    const up1 = await authed(token)
      .post('/api/files')
      .attach('file', pdf, { filename: 'doc.pdf', contentType: 'application/pdf' });
    expect(up1.status).toBe(201);
    const meta = up1.body?.data?.attachment;
    expect(meta?.url).toMatch(/^\/api\/files\/.+\/download$/);
    expect(meta?.fileSize).toBe(pdf.length);

    const dl = await authed(token).get(meta.url).buffer().parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(dl.status).toBe(200);
    expect(Buffer.compare(dl.body as Buffer, pdf)).toBe(0);
  });

  it('rejects unsupported file types (400)', async () => {
    if (!up) return;
    const res = await authed(token)
      .post('/api/files')
      .attach('file', Buffer.from('binary'), {
        filename: 'x.bin',
        contentType: 'application/octet-stream',
      });
    expect(res.status).toBe(400);
  });

  it('a different-sector user cannot download an unreferenced attachment (404)', async () => {
    if (!up) return;
    let recruiterToken: string;
    try {
      recruiterToken = await login(SCOPED_RECRUITER);
    } catch {
      return; // fixture absent
    }
    // Admin uploads a file that is not referenced by any of the recruiter's records.
    const adminToken = await login(ADMIN);
    const upRes = await authed(adminToken)
      .post('/api/files')
      .attach('file', pdf, { filename: 'private.pdf', contentType: 'application/pdf' });
    const url = upRes.body?.data?.attachment?.url as string;
    expect(url).toBeTruthy();

    // Uploader/admin can read it; the other-sector recruiter cannot (404, not 403).
    expect((await authed(adminToken).get(url)).status).toBe(200);
    expect((await authed(recruiterToken).get(url)).status).toBe(404);
  });
});
