import { describe, it, expect, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import { authed, login, ADMIN, serverUp, createOrgAndWorkspace, prisma } from './helpers.js';

interface DecodedAccessToken {
  sub: string;
  tenantId?: string | null;
  organizationId?: string | null;
  workspaceId?: string | null;
  workspaceRole?: string | null;
}

function decode(token: string): DecodedAccessToken {
  return jwt.decode(token) as DecodedAccessToken;
}

/**
 * POST /api/auth/switch-workspace re-issues a token pair scoped to the
 * target Workspace. This suite decodes the claims directly (jwt.decode — no
 * need for the signing secret, the shape is what's under test) and proves
 * two things the plan calls out explicitly: the new token's claims actually
 * match the target, and switching is a purely additive, per-token operation
 * — the PRE-switch token keeps resolving to its ORIGINAL workspace afterward
 * (no shared mutable scope state that a switch could leak across sessions).
 */
describe('Workspace switch — token claims', () => {
  let up = false;
  let originalToken = '';
  let workspaceBId = '';
  let organizationBId = '';

  const run = Date.now().toString(36);

  beforeAll(async () => {
    up = await serverUp();
    if (!up) return;
    originalToken = await login(ADMIN);
    const created = await createOrgAndWorkspace(originalToken, `SwitchTok-${run}`);
    organizationBId = created.organizationId;
    workspaceBId = created.workspaceId;
  });

  it('the new token claims match the target workspace/organization', async () => {
    if (!up) return;
    const before = decode(originalToken);
    expect(before.workspaceId).toBeTruthy();
    expect(before.workspaceId).not.toBe(workspaceBId);

    const res = await authed(originalToken).post('/api/auth/switch-workspace').send({ workspaceId: workspaceBId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = decode(res.body.data.accessToken);

    expect(after.workspaceId).toBe(workspaceBId);
    expect(after.organizationId).toBe(organizationBId);
    expect(after.workspaceRole).toBe('WORKSPACE_ADMIN');
    // Same user, same tenant — only the org/workspace scope moved.
    expect(after.sub).toBe(before.sub);
    expect(after.tenantId).toBe(before.tenantId);
  });

  it('the response user object reflects the new workspace by name', async () => {
    if (!up) return;
    const res = await authed(originalToken).post('/api/auth/switch-workspace').send({ workspaceId: workspaceBId });
    expect(res.status).toBe(200);
    expect(res.body.data.user.workspaceId).toBe(workspaceBId);
    expect(res.body.data.user.organizationId).toBe(organizationBId);
  });

  it('the pre-switch token is unaffected — using it afterward still resolves to its ORIGINAL workspace', async () => {
    if (!up) return;
    const before = decode(originalToken);
    // Switch happens (as in the prior tests), but this reuses the ORIGINAL
    // token — not the one switch-workspace just returned — to prove there is
    // no shared ambient scope a switch could have mutated out from under it.
    await authed(originalToken).post('/api/auth/switch-workspace').send({ workspaceId: workspaceBId });

    const sectorRes = await authed(originalToken)
      .post('/api/admin/sectors')
      .send({ name: `SwitchTok Sector ${run}`, type: 'Ops' });
    expect(sectorRes.status, JSON.stringify(sectorRes.body)).toBe(201);

    const row = await prisma.sector.findUnique({ where: { id: sectorRes.body.data.sector.id }, select: { workspaceId: true } });
    expect(row?.workspaceId).toBe(before.workspaceId);
    expect(row?.workspaceId).not.toBe(workspaceBId);
  });

  it('switching to a nonexistent/foreign workspace id is rejected, never silently re-scoped', async () => {
    if (!up) return;
    // A random, well-formed but non-existent id in the same shape a foreign
    // tenant's real workspace id would take. The caller here (ADMIN fixture)
    // is SUPERADMIN, whose canAccessWorkspace short-circuits true by role —
    // the actual rejection then comes from the tenant-scoped existence
    // lookup a layer down (404), not the membership check (403). Either is
    // an acceptable rejection; only 200 (a successful cross-scope switch)
    // would be the real bug.
    const res = await authed(originalToken)
      .post('/api/auth/switch-workspace')
      .send({ workspaceId: '11111111-1111-1111-1111-111111111111' });
    expect(res.status).not.toBe(200);
    expect([403, 404]).toContain(res.status);
  });
});
