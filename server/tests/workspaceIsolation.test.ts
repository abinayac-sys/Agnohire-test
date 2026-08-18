import { describe, it, expect, beforeAll } from 'vitest';
import {
  authed,
  login,
  ADMIN,
  serverUp,
  createOrgAndWorkspace,
  switchToWorkspace,
  createRoleScopedUser,
} from './helpers.js';

/**
 * Workspace-level isolation, the bottom tier of the Tenant -> Organization ->
 * Workspace hierarchy. Two angles, both against a second Workspace ("WS B")
 * created in the same tenant as ADMIN's default ("WS A"):
 *
 *  1. Container-level (Workspace CRUD/membership) — gated by membership rows,
 *     same shape as organizationIsolation.test.ts.
 *  2. Row-level (Sector, a FILTER_MODELS table — see config/database.ts) —
 *     ambient-scope RLS filtering applies regardless of role, so this also
 *     proves an ADMIN token scoped to WS A cannot see a Sector created under
 *     WS B without actually switching into it first.
 */
describe('Workspace isolation', () => {
  let up = false;
  let adminDefaultToken = ''; // scoped to the tenant's default (WS A)
  let adminWsBToken = ''; // same admin, switched into WS B
  let wsBId = '';
  let recruiterToken = '';
  let sectorInWsBId = '';

  const run = Date.now().toString(36);
  const RECRUITER = { email: `ws-iso.recruiter.${run}@agnohire.local`, password: 'Recruiter@12345Y' };

  beforeAll(async () => {
    up = await serverUp();
    if (!up) return;
    adminDefaultToken = await login(ADMIN);
    const created = await createOrgAndWorkspace(adminDefaultToken, `WsIsoB-${run}`);
    wsBId = created.workspaceId;
    adminWsBToken = await switchToWorkspace(adminDefaultToken, wsBId);

    const sectorRes = await authed(adminWsBToken)
      .post('/api/admin/sectors')
      .send({ name: `WsIso Sector ${run}`, type: 'Engineering' });
    expect(sectorRes.status, JSON.stringify(sectorRes.body)).toBe(201);
    sectorInWsBId = sectorRes.body.data.sector.id;

    // Granted membership in WS A (adminDefaultToken's current ambient scope).
    await createRoleScopedUser(adminDefaultToken, 'RECRUITER', RECRUITER);
    recruiterToken = await login(RECRUITER);
  });

  it('sets up a sector under Workspace B with the expected id', () => {
    if (!up) return;
    expect(sectorInWsBId).toBeTruthy();
  });

  it('a token scoped to Workspace A never sees a Sector created under Workspace B (RLS row filter)', async () => {
    if (!up) return;
    const res = await authed(adminDefaultToken).get('/api/admin/sectors');
    expect(res.status).toBe(200);
    const ids = res.body.data.sectors.map((s: { id: string }) => s.id);
    expect(ids).not.toContain(sectorInWsBId);
  });

  it('the same admin, switched into Workspace B, does see that sector', async () => {
    if (!up) return;
    const res = await authed(adminWsBToken).get('/api/admin/sectors');
    expect(res.status).toBe(200);
    const ids = res.body.data.sectors.map((s: { id: string }) => s.id);
    expect(ids).toContain(sectorInWsBId);
  });

  it('control: admin-tier sees Workspace B in the container list/read', async () => {
    if (!up) return;
    const list = await authed(adminDefaultToken).get('/api/workspaces');
    expect(list.status).toBe(200);
    expect(list.body.data.workspaces.map((w: { id: string }) => w.id)).toContain(wsBId);

    const read = await authed(adminDefaultToken).get(`/api/workspaces/${wsBId}`);
    expect(read.status).toBe(200);
  });

  // RECRUITER holds neither workspace.view nor any other workspace.*
  // permission by default — every read below is blocked by the
  // CRUD-granular permission gate itself, before the membership-based 404
  // logic ever runs (a strictly tighter boundary than membership alone).
  it('a member of Workspace A only cannot list workspaces at all without workspace.view', async () => {
    if (!up) return;
    const res = await authed(recruiterToken).get('/api/workspaces');
    expect(res.status).toBe(403);
  });

  it('a member of Workspace A only cannot read Workspace B directly by id without workspace.view', async () => {
    if (!up) return;
    const res = await authed(recruiterToken).get(`/api/workspaces/${wsBId}`);
    expect(res.status).toBe(403);
  });

  it('a member of Workspace A only cannot list Workspace B members without workspace.view', async () => {
    if (!up) return;
    const res = await authed(recruiterToken).get(`/api/workspaces/${wsBId}/members`);
    expect(res.status).toBe(403);
  });
});
