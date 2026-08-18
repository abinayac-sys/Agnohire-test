import { describe, it, expect, beforeAll } from 'vitest';
import { api, authed, login, ADMIN, serverUp } from './helpers.js';

describe('Auth & access control', () => {
  let up = false;
  beforeAll(async () => {
    up = await serverUp();
  });

  it('health endpoint responds ok', async () => {
    if (!up) return expect.unreachable('server not running — start `npm run dev`');
    const res = await api().get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body?.data?.status).toBe('ok');
  });

  it('dev-login returns an access token for the admin', async () => {
    if (!up) return;
    const token = await login(ADMIN);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(20);
  });

  it('rejects bad credentials', async () => {
    if (!up) return;
    const res = await api()
      .post('/api/auth/dev-login')
      .send({ email: ADMIN.email, password: 'wrong-password' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it.each([
    ['/api/candidates', 'candidates'],
    ['/api/offers', 'offers'],
    ['/api/jobs', 'jobs'],
  ])('blocks %s without a token (401)', async (path) => {
    if (!up) return;
    const res = await api().get(path);
    expect(res.status).toBe(401);
  });

  it('blocks a garbage token (401)', async () => {
    if (!up) return;
    const res = await api()
      .get('/api/jobs')
      .set('Authorization', 'Bearer xxx.yyy.zzz');
    expect(res.status).toBe(401);
  });

  it('allows an authenticated read', async () => {
    if (!up) return;
    const token = await login(ADMIN);
    const res = await authed(token).get('/api/jobs?limit=1');
    expect(res.status).toBe(200);
    expect(res.body?.data).toHaveProperty('items');
  });
});
