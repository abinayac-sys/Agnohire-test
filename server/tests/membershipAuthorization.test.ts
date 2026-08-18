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
 * A user with no membership row for a given Workspace/Organization must be
 * rejected everywhere that matters, even when they know (or guess) a real
 * id — switch-workspace, direct mutation by id, and the membership tree
 * itself never mention what they're not a member of.
 */
describe('Membership authorization', () => {
  let up = false;
  let adminToken = '';
  let orgBId = '';
  let workspaceBId = '';
  let recruiterToken = '';

  const run = Date.now().toString(36);
  const RECRUITER = { email: `mem-auth.recruiter.${run}@agnohire.local`, password: 'Recruiter@12345X' };

  beforeAll(async () => {
    up = await serverUp();
    if (!up) return;
    adminToken = await login(ADMIN);
    const created = await createOrgAndWorkspace(adminToken, `MemAuth-${run}`);
    orgBId = created.organizationId;
    workspaceBId = created.workspaceId;
    await createRoleScopedUser(adminToken, 'RECRUITER', RECRUITER);
    recruiterToken = await login(RECRUITER);
  });

  it('switch-workspace to a workspace the caller is not a member of is rejected', async () => {
    if (!up) return;
    const res = await authed(recruiterToken).post('/api/auth/switch-workspace').send({ workspaceId: workspaceBId });
    expect(res.status).toBe(403);
  });

  it('switch-workspace to a nonexistent workspace id is rejected the same way (never leaks existence)', async () => {
    if (!up) return;
    const res = await authed(recruiterToken)
      .post('/api/auth/switch-workspace')
      .send({ workspaceId: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(403);
  });

  it('cannot mutate a workspace by id without membership, even knowing the real id', async () => {
    if (!up) return;
    const patch = await authed(recruiterToken).patch(`/api/workspaces/${workspaceBId}`).send({ name: 'Hijacked' });
    expect([403, 404]).toContain(patch.status);

    const addMember = await authed(recruiterToken)
      .post(`/api/workspaces/${workspaceBId}/members`)
      .send({ userId: 'anything', role: 'WORKSPACE_ADMIN' });
    expect([403, 404]).toContain(addMember.status);

    const del = await authed(recruiterToken).delete(`/api/workspaces/${workspaceBId}`);
    expect([403, 404]).toContain(del.status);
  });

  it('cannot mutate an organization by id without membership, even knowing the real id', async () => {
    if (!up) return;
    const patch = await authed(recruiterToken).patch(`/api/organizations/${orgBId}`).send({ name: 'Hijacked' });
    expect([403, 404]).toContain(patch.status);
  });

  it('the membership tree never mentions an org/workspace the caller is not a member of', async () => {
    if (!up) return;
    const res = await authed(recruiterToken).get('/api/auth/memberships');
    expect(res.status).toBe(200);
    const orgIds = res.body.data.organizations.map((o: { id: string }) => o.id);
    expect(orgIds).not.toContain(orgBId);
    const wsIds = res.body.data.organizations.flatMap((o: { workspaces: Array<{ id: string }> }) => o.workspaces.map((w) => w.id));
    expect(wsIds).not.toContain(workspaceBId);
  });

  it('control: admin-tier membership tree includes both, and switch-workspace succeeds', async () => {
    if (!up) return;
    const tree = await authed(adminToken).get('/api/auth/memberships');
    expect(tree.status).toBe(200);
    const orgIds = tree.body.data.organizations.map((o: { id: string }) => o.id);
    expect(orgIds).toContain(orgBId);

    const switched = await authed(adminToken).post('/api/auth/switch-workspace').send({ workspaceId: workspaceBId });
    expect(switched.status).toBe(200);
  });
});
