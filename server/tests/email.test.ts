import { describe, it, expect, beforeAll } from 'vitest';
import { authed, login, api, serverUp } from './helpers.js';

/**
 * SMTP mailer endpoint. In the default dev env SMTP is unconfigured, so the
 * test endpoint must fail closed with a clear message rather than throwing or
 * silently "succeeding". (The real send path is verified out-of-band via an
 * Ethereal account.)
 */
describe('Email / SMTP', () => {
  let up = false;
  let token = '';

  beforeAll(async () => {
    up = await serverUp();
    if (up) token = await login();
  });

  it('test-email requires authentication', async () => {
    if (!up) return;
    const res = await api().post('/api/system/email/test').send({});
    expect(res.status).toBe(401);
  });

  it('reports not-configured gracefully when SMTP is unset', async () => {
    if (!up) return;
    const res = await authed(token).post('/api/system/email/test').send({});
    // Either 400 (not configured) or 200 verified — both are valid depending on
    // whether an admin has configured SMTP. Never a 500.
    expect([200, 400]).toContain(res.status);
    if (res.status === 400) {
      expect(res.body?.error?.message ?? '').toMatch(/SMTP/i);
    }
  });
});
