import { describe, it, expect, beforeAll } from 'vitest';
import {
  authed,
  login,
  ADMIN,
  serverUp,
  createOrgAndWorkspace,
  createRoleScopedUser,
} from './helpers.js';

/**
 * Organization-level isolation, one tier above the existing tenant boundary.
 * ADMIN's default token is scoped to the tenant's default Organization
 * ("Org A"); this suite creates a second Organization ("Org B") in the SAME
 * tenant and asserts a narrow-role member of Org A alone can never see or
 * read Org B, while admin-tier roles (who act on every org in their own
 * tenant by role, not by membership row — see workspaceMembershipService)
 * still can.
 */
describe('Organization isolation', () => {
  let up = false;
  let adminToken = '';
  let orgBId = '';
  let recruiterToken = '';

  const run = Date.now().toString(36);
  const RECRUITER = { email: `org-iso.recruiter.${run}@agnohire.local`, password: 'Recruiter@12345Z' };

  beforeAll(async () => {
    up = await serverUp();
    if (!up) return;
    adminToken = await login(ADMIN);
    const created = await createOrgAndWorkspace(adminToken, `OrgIsoB-${run}`);
    orgBId = created.organizationId;
    // Created while adminToken is still scoped to the tenant's default
    // Organization — ensureWorkspaceMembership grants membership there only.
    await createRoleScopedUser(adminToken, 'RECRUITER', RECRUITER);
    recruiterToken = await login(RECRUITER);
  });

  it('control: admin-tier sees every organization in its own tenant', async () => {
    if (!up) return;
    const res = await authed(adminToken).get('/api/organizations');
    expect(res.status).toBe(200);
    const ids = res.body.data.organizations.map((o: { id: string }) => o.id);
    expect(ids).toContain(orgBId);
  });

  it('control: admin-tier can read Org B directly', async () => {
    if (!up) return;
    const res = await authed(adminToken).get(`/api/organizations/${orgBId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.organization.id).toBe(orgBId);
  });

  // RECRUITER holds neither org.view nor any other org.* permission by
  // default (see shared/src/constants/permissions.ts) — every read below is
  // now blocked by the CRUD-granular permission gate itself, before the
  // service layer's own membership-based 404 logic ever runs. This is a
  // strictly TIGHTER boundary than the old membership-only check: even a
  // recruiter who happened to be a member of Org B could not read it without
  // also being granted org.view.
  it('a member of Org A only cannot list organizations at all without org.view', async () => {
    if (!up) return;
    const res = await authed(recruiterToken).get('/api/organizations');
    expect(res.status).toBe(403);
  });

  it('a member of Org A only cannot read Org B directly by id without org.view', async () => {
    if (!up) return;
    const res = await authed(recruiterToken).get(`/api/organizations/${orgBId}`);
    expect(res.status).toBe(403);
  });

  it('a member of Org A only cannot list Org B members without org.view', async () => {
    if (!up) return;
    const res = await authed(recruiterToken).get(`/api/organizations/${orgBId}/members`);
    expect(res.status).toBe(403);
  });

  it('a member of Org A only cannot mutate Org B by id (403/404, never 200)', async () => {
    if (!up) return;
    const res = await authed(recruiterToken).patch(`/api/organizations/${orgBId}`).send({ name: 'Hijacked' });
    expect([403, 404]).toContain(res.status);
  });
});
