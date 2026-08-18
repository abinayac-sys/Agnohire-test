import { describe, it, expect, beforeAll } from 'vitest';
import { api, authed, login, ADMIN, CANDIDATE, serverUp } from './helpers.js';

/**
 * Module 14 — Admin Console. RBAC + reads across users/roles/permissions/
 * sectors/integrations/email-templates, plus a self-cleaning sector + role
 * permission round-trip and the key guard rails.
 */
describe('Admin Console (Module 14)', () => {
  let up = false;
  let token = '';

  beforeAll(async () => {
    up = await serverUp();
    if (up) token = await login(ADMIN);
  });

  it('admin endpoints require authentication', async () => {
    if (!up) return;
    for (const path of ['/api/admin/users', '/api/admin/roles', '/api/admin/sectors', '/api/admin/integrations']) {
      const res = await api().get(path);
      expect(res.status).toBe(401);
    }
  });

  it('a candidate cannot reach the admin console', async () => {
    if (!up) return;
    let candidateToken: string;
    try { candidateToken = await login(CANDIDATE); } catch { return; }
    const res = await authed(candidateToken).get('/api/admin/users');
    expect(res.status).toBe(403);
  });

  it('lists users (paginated), roles, permissions, and sectors', async () => {
    if (!up) return;
    const users = await authed(token).get('/api/admin/users?limit=5');
    expect(users.status).toBe(200);
    expect(users.body?.data?.meta).toHaveProperty('total');

    const roles = await authed(token).get('/api/admin/roles');
    expect(roles.status).toBe(200);
    expect(Array.isArray(roles.body?.data?.roles)).toBe(true);

    const perms = await authed(token).get('/api/admin/permissions');
    expect(perms.status).toBe(200);
    expect(perms.body?.data?.permissions.length).toBeGreaterThan(0);

    const sectors = await authed(token).get('/api/admin/sectors');
    expect(sectors.status).toBe(200);
    expect(Array.isArray(sectors.body?.data?.sectors)).toBe(true);
  });

  it('rejects duplicate-email user creation (409)', async () => {
    if (!up) return;
    const roles = await authed(token).get('/api/admin/roles');
    const roleId = roles.body?.data?.roles?.find((r: { name: string }) => r.name === 'HR')?.id;
    if (!roleId) return;
    const res = await authed(token).post('/api/admin/users').send({ fullName: 'Dup', email: 'admin@agnohire.local', roleId, password: 'Test@12345' });
    expect(res.status).toBe(409);
  });

  it('the superadmin role is immutable (400) and unknown permissions are rejected (400)', async () => {
    if (!up) return;
    const roles = await authed(token).get('/api/admin/roles');
    const superRole = roles.body?.data?.roles?.find((r: { isSuperadmin: boolean }) => r.isSuperadmin);
    const hr = roles.body?.data?.roles?.find((r: { name: string }) => r.name === 'HR');
    if (superRole) {
      const res = await authed(token).put(`/api/admin/roles/${superRole.id}/permissions`).send({ permissionKeys: ['job.view'] });
      expect(res.status).toBe(400);
    }
    if (hr) {
      const res = await authed(token).put(`/api/admin/roles/${hr.id}/permissions`).send({ permissionKeys: ['bogus.permission'] });
      expect(res.status).toBe(400);
    }
  });

  it('sector + domain CRUD round-trip (self-cleaning); integration secrets are masked', async () => {
    if (!up) return;
    const created = await authed(token).post('/api/admin/sectors').send({ name: `ZZTEST sector ${Date.now()}`, type: 'test' });
    expect(created.status).toBe(201);
    const sectorId = created.body?.data?.sector?.id;

    const dom = await authed(token).post('/api/admin/domains').send({ name: 'ZZTEST domain', sectorId });
    expect(dom.status).toBe(201);

    const intg = await authed(token).post('/api/admin/integrations').send({ name: 'ZZTEST intg', type: 'test', config: { apiKey: 'secret-xyz', channel: 'public' } });
    expect(intg.status).toBe(201);
    expect(intg.body?.data?.integration?.config?.apiKey).toBe('••••••••'); // masked
    expect(intg.body?.data?.integration?.config?.channel).toBe('public'); // non-secret visible

    // cleanup
    await authed(token).delete(`/api/admin/integrations/${intg.body.data.integration.id}`);
    await authed(token).delete(`/api/admin/domains/${dom.body.data.domain.id}`);
    await authed(token).delete(`/api/admin/sectors/${sectorId}`);
  });
});
