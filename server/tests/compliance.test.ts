import { describe, it, expect, beforeAll } from 'vitest';
import { api, authed, login, ADMIN, CANDIDATE, serverUp } from './helpers.js';

/**
 * Module 13 — Security & GDPR Compliance. Audit-log viewer (RBAC + list +
 * facets + export) and GDPR requests/consent (RBAC + create/process lifecycle).
 */
describe('Compliance (Module 13)', () => {
  let up = false;
  let token = '';

  beforeAll(async () => {
    up = await serverUp();
    if (up) token = await login(ADMIN);
  });

  // ─── AUDIT VIEWER ──────────────────────────────────────────────────────────

  it('audit + gdpr endpoints require authentication', async () => {
    if (!up) return;
    for (const path of ['/api/audit', '/api/audit/facets', '/api/gdpr/summary', '/api/gdpr/requests']) {
      const res = await api().get(path);
      expect(res.status).toBe(401);
    }
  });

  it('lists audit logs (AUDIT_LOG_VIEW) with pagination meta', async () => {
    if (!up) return;
    const res = await authed(token).get('/api/audit?limit=5');
    expect(res.status).toBe(200);
    expect(res.body?.data).toHaveProperty('items');
    expect(res.body?.data?.meta).toHaveProperty('total');
  });

  it('returns audit facets (distinct actions + entities)', async () => {
    if (!up) return;
    const res = await authed(token).get('/api/audit/facets');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body?.data?.actions)).toBe(true);
    expect(Array.isArray(res.body?.data?.entities)).toBe(true);
  });

  it('exports audit logs as CSV', async () => {
    if (!up) return;
    const res = await authed(token).get('/api/audit/export?limit=10');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text.split('\r\n')[0]).toContain('Timestamp');
  });

  it('a candidate cannot read audit logs', async () => {
    if (!up) return;
    let candidateToken: string;
    try {
      candidateToken = await login(CANDIDATE);
    } catch {
      return;
    }
    const res = await authed(candidateToken).get('/api/audit');
    expect(res.status).toBe(403);
  });

  // ─── GDPR ──────────────────────────────────────────────────────────────────

  it('returns a compliance summary', async () => {
    if (!up) return;
    const res = await authed(token).get('/api/gdpr/summary');
    expect(res.status).toBe(200);
    for (const k of ['pendingRequests', 'completedRequests', 'totalCandidates', 'consentedCandidates', 'erasedCandidates']) {
      expect(typeof res.body?.data?.[k]).toBe('number');
    }
  });

  it('lists consent records and GDPR requests', async () => {
    if (!up) return;
    const consent = await authed(token).get('/api/gdpr/consent?limit=5');
    expect(consent.status).toBe(200);
    expect(consent.body?.data).toHaveProperty('items');
    const requests = await authed(token).get('/api/gdpr/requests?limit=5');
    expect(requests.status).toBe(200);
    expect(requests.body?.data).toHaveProperty('items');
  });

  it('runs an ACCESS request lifecycle (create → fulfil → export bundle); self-cleans', async () => {
    if (!up) return;
    // Pick any candidate from the consent list to exercise against.
    const consent = await authed(token).get('/api/gdpr/consent?limit=1');
    const candidateId = consent.body?.data?.items?.[0]?.candidateId;
    if (!candidateId) return;

    const create = await authed(token).post('/api/gdpr/requests').send({ candidateId, type: 'ACCESS' });
    expect(create.status).toBe(201);
    expect(create.body?.data?.request?.status).toBe('PENDING');
    const reqId = create.body?.data?.request?.id;

    const fulfil = await authed(token).post(`/api/gdpr/requests/${reqId}/process`).send({ action: 'fulfil' });
    expect(fulfil.status).toBe(200);
    expect(fulfil.body?.data?.request?.status).toBe('COMPLETED');
    expect(fulfil.body?.data?.bundle).toBeTruthy();
    expect(fulfil.body?.data?.bundle?.candidate).toBeTruthy();

    // Re-processing a completed request is rejected.
    const again = await authed(token).post(`/api/gdpr/requests/${reqId}/process`).send({ action: 'fulfil' });
    expect(again.status).toBe(400);
  });

  it('a candidate cannot manage GDPR', async () => {
    if (!up) return;
    let candidateToken: string;
    try {
      candidateToken = await login(CANDIDATE);
    } catch {
      return;
    }
    const res = await authed(candidateToken).get('/api/gdpr/summary');
    expect(res.status).toBe(403);
  });
});
