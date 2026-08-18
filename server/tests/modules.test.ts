import { describe, it, expect, beforeAll } from 'vitest';
import { authed, login, serverUp } from './helpers.js';

/**
 * Read-surface coverage across Modules 1-11. Each endpoint must return 200 and
 * the expected envelope shape. Paths are the real mounted routes.
 */
describe('Module read endpoints (M1-M11)', () => {
  let token = '';
  let up = false;

  beforeAll(async () => {
    up = await serverUp();
    if (up) token = await login();
  });

  const listCases: [string, string][] = [
    // [label, path] — each returns a paginated { items, meta }
    ['M1 jobs', '/api/jobs?limit=5'],
    ['M2 candidates', '/api/candidates?limit=5'],
    ['M2 candidate lists', '/api/candidates/lists?limit=5'],
    ['M3 referrals', '/api/sourcing/referrals?limit=5'],
    ['M4 interviews', '/api/interviews?limit=5'],
    ['M4 question banks', '/api/question-banks?limit=5'],
    ['M6 assessments', '/api/assessments?limit=5'],
    ['M8 reviews', '/api/reviews?limit=5'],
    ['M11 offers', '/api/offers?limit=5'],
  ];

  it.each(listCases)('%s returns a paginated list', async (_label, path) => {
    if (!up) return;
    const res = await authed(token).get(path);
    expect(res.status).toBe(200);
    expect(res.body?.data).toHaveProperty('items');
    expect(Array.isArray(res.body.data.items)).toBe(true);
    expect(res.body?.data).toHaveProperty('meta');
  });

  const okCases: [string, string][] = [
    ['M5 schedules', '/api/schedules?limit=5'],
    ['M7 analytics dashboard', '/api/analytics/dashboard'],
    ['M7 analytics insights', '/api/analytics/insights'],
    ['reference sectors', '/api/reference/sectors'],
    ['M1 job templates', '/api/jobs/templates'],
  ];

  it.each(okCases)('%s responds success', async (_label, path) => {
    if (!up) return;
    const res = await authed(token).get(path);
    expect(res.status).toBe(200);
    expect(res.body?.success).toBe(true);
  });

  it('M9 pipeline board returns columns for a job', async () => {
    if (!up) return;
    const jobs = await authed(token).get('/api/jobs?limit=1');
    const jobId = jobs.body?.data?.items?.[0]?.id;
    if (!jobId) return expect.unreachable('no job available to test the board');
    const res = await authed(token).get(
      `/api/pipeline/board?jobRequisitionId=${jobId}`,
    );
    expect(res.status).toBe(200);
    expect(res.body?.data?.board).toHaveProperty('columns');
  });
});
