import { describe, it, expect, beforeAll } from 'vitest';
import { api, authed, login, ADMIN, serverUp } from './helpers.js';

/**
 * A freshly registered tenant goes through the exact same default-backfill
 * path the historical migration used for every pre-existing tenant
 * (workspaceProvisioningService.ensureDefaultOrganizationAndWorkspace): one
 * Organization + one Workspace, both slug 'default'. This suite proves the
 * org/workspace rollout is invisible to a tenant that never opts into it —
 * existing response shapes are unchanged, no new field is required on any
 * request, and the switcher's collapse condition (exactly 1x1) holds.
 */
describe('Backward compatibility (fresh tenant, default backfill path)', () => {
  let up = false;
  let ownerToken = '';
  let tenantId = '';

  const run = Date.now().toString(36);
  const OWNER = { email: `bwc.owner.${run}@backcompat.test`, password: 'Tenant@12345Q' };

  beforeAll(async () => {
    up = await serverUp();
    if (!up) return;

    const reg = await api()
      .post('/api/auth/register')
      .send({
        companyName: `BackCompat ${run}`,
        fullName: `Owner of BackCompat ${run}`,
        email: OWNER.email,
        password: OWNER.password,
        phone: '+15550100999',
        planCode: 'FREE',
        billingInterval: 'monthly',
      })
      .set('Content-Type', 'application/json');
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
    tenantId = reg.body.data.tenantId;

    const platformToken = await login(ADMIN);
    const approve = await authed(platformToken)
      .post(`/api/platform/tenants/${tenantId}/approve`)
      .send({ notes: 'backwardCompat suite' });
    expect(approve.status, JSON.stringify(approve.body)).toBe(200);

    ownerToken = await login(OWNER);
  });

  it('provisions exactly one Organization and one Workspace, both "default"', async () => {
    if (!up) return;
    const res = await authed(ownerToken).get('/api/organizations');
    expect(res.status).toBe(200);
    expect(res.body.data.organizations).toHaveLength(1);
    expect(res.body.data.organizations[0].slug).toBe('default');

    const ws = await authed(ownerToken).get('/api/workspaces');
    expect(ws.status).toBe(200);
    expect(ws.body.data.workspaces).toHaveLength(1);
    expect(ws.body.data.workspaces[0].slug).toBe('default');
  });

  it('the membership tree collapses to 1x1 — the exact condition the frontend switcher hides on', async () => {
    if (!up) return;
    const res = await authed(ownerToken).get('/api/auth/memberships');
    expect(res.status).toBe(200);
    expect(res.body.data.organizations).toHaveLength(1);
    expect(res.body.data.organizations[0].workspaces).toHaveLength(1);
  });

  it('/api/auth/me keeps every pre-existing AuthUser field, and the new fields are populated (not undefined)', async () => {
    if (!up) return;
    const res = await authed(ownerToken).get('/api/auth/me');
    expect(res.status).toBe(200);
    const user = res.body.data.user;
    // Pre-existing contract — must still be present, unrenamed, unremoved.
    for (const key of ['id', 'fullName', 'email', 'role', 'roleDisplayName', 'sectorId', 'permissions', 'tenantSlug', 'tenantTimezone']) {
      expect(user).toHaveProperty(key);
    }
    // Additive fields from this rollout — populated for a real tenant user,
    // never silently left off the response shape.
    expect(typeof user.organizationId).toBe('string');
    expect(typeof user.workspaceId).toBe('string');
    expect(user.workspaceRole).toBe('WORKSPACE_ADMIN'); // TENANT_OWNER defaults admin-tier
  });

  it('existing list endpoints work with zero org/workspace awareness from the caller', async () => {
    if (!up) return;
    for (const path of ['/api/jobs?page=1&pageSize=20', '/api/candidates?page=1&pageSize=20', '/api/admin/users?page=1&pageSize=20']) {
      const res = await authed(ownerToken).get(path);
      expect(res.status, `${path} -> ${res.status} ${JSON.stringify(res.body)}`).toBe(200);
    }
  });
});
