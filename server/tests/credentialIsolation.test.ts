import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { authed, login, ADMIN, serverUp, createOrgAndWorkspace, switchToWorkspace, prisma } from './helpers.js';

/**
 * Integration/SystemConfiguration are G1b tables (see the implementation
 * plan §4): organizationId/workspaceId are permanently-nullable denormalized
 * columns, auto-STAMPED on create from the caller's ambient scope but never
 * auto-FILTERED at the Prisma/JS layer (config/database.ts's
 * ORG_WORKSPACE_STAMP_MODELS vs ORG_WORKSPACE_FILTER_MODELS split) — the
 * app code itself adds no `where: { workspaceId }` to these queries.
 *
 * The isolation guarantee for this group therefore lives entirely in
 * Postgres RLS: a RESTRICTIVE `workspace_isolation` policy
 * (20260812130000_rls_organization_workspace_policies_stage1) hides any row
 * with a concrete workspaceId that doesn't match the connection's
 * `app.workspace_id` GUC.
 *
 * That policy is enforced only under the restricted `agnohire_app` DB role —
 * this environment's own DATABASE_URL/DIRECT_URL connect as the superuser
 * (`agnohire`, "host-side tooling only" per .env's own comment), which
 * BYPASSes RLS entirely, same as it would for any owner-role connection. So
 * rather than asserting isolation through the live HTTP server (which would
 * only prove it if the server itself happened to be configured with the
 * restricted role — an operational fact this suite can't control), this
 * suite opens its OWN connection explicitly AS `agnohire_app` and sets the
 * session GUCs by hand, mirroring the manual verification already used
 * during the original RLS rollout. This proves the POLICY, as shipped, is
 * correct — independent of which role any particular deployment's app
 * server connects as.
 */
const APP_ROLE_URL = (() => {
  const base = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '';
  const password = process.env.AGNOHIRE_APP_PASSWORD ?? 'agnohire_app';
  try {
    const url = new URL(base);
    url.username = 'agnohire_app';
    url.password = password;
    return url.toString();
  } catch {
    return '';
  }
})();

const appRolePrisma = APP_ROLE_URL ? new PrismaClient({ datasources: { db: { url: APP_ROLE_URL } } }) : null;

/** Reads Integration rows under RLS, with the given scope GUCs set on the same connection/transaction. */
async function readIntegrationAsScoped(
  integrationId: string,
  scope: { tenantId: string; workspaceId: string },
): Promise<{ id: string; configJson: string | null } | null> {
  if (!appRolePrisma) throw new Error('AGNOHIRE_APP_PASSWORD not resolvable — cannot verify RLS directly');
  return appRolePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${scope.tenantId}, true),
                                 set_config('app.workspace_id', ${scope.workspaceId}, true),
                                 set_config('app.bypass', 'off', true)`;
    return tx.integration.findUnique({ where: { id: integrationId }, select: { id: true, configJson: true } });
  });
}
describe('Credential isolation (Integration, workspace-scoped)', () => {
  let up = false;
  let adminDefaultToken = ''; // scoped to Workspace A (tenant default)
  let adminWsBToken = ''; // same admin, switched into Workspace B
  let tenantId = '';
  let workspaceAId = '';
  let workspaceBId = '';
  let organizationBId = '';
  let sectorBId = '';
  let integrationId = '';

  const run = Date.now().toString(36);
  const SECRET_MARKER = `cred-iso-secret-${run}`;

  beforeAll(async () => {
    up = await serverUp();
    if (!up) return;
    adminDefaultToken = await login(ADMIN);
    const before = await authed(adminDefaultToken).get('/api/auth/me');
    workspaceAId = before.body.data.user.workspaceId;
    const jwt = await import('jsonwebtoken');
    tenantId = (jwt.default.decode(adminDefaultToken) as { tenantId: string }).tenantId;

    const created = await createOrgAndWorkspace(adminDefaultToken, `CredIso-${run}`);
    organizationBId = created.organizationId;
    workspaceBId = created.workspaceId;
    adminWsBToken = await switchToWorkspace(adminDefaultToken, workspaceBId);

    const sectorRes = await authed(adminWsBToken)
      .post('/api/admin/sectors')
      .send({ name: `CredIso Sector ${run}`, type: 'Ops' });
    expect(sectorRes.status, JSON.stringify(sectorRes.body)).toBe(201);
    sectorBId = sectorRes.body.data.sector.id;

    const integrationRes = await authed(adminWsBToken)
      .post('/api/admin/integrations')
      .send({
        name: `CredIso Integration ${run}`,
        type: 'WEBHOOK',
        isEnabled: true,
        sectorId: sectorBId,
        config: { apiKey: SECRET_MARKER },
      });
    expect(integrationRes.status, JSON.stringify(integrationRes.body)).toBe(201);
    integrationId = integrationRes.body.data.integration.id;
  });

  it('the created Integration is correctly stamped with Workspace B (not Workspace A)', async () => {
    if (!up) return;
    const row = await prisma.integration.findUnique({
      where: { id: integrationId },
      select: { organizationId: true, workspaceId: true },
    });
    expect(row?.organizationId).toBe(organizationBId);
    expect(row?.workspaceId).toBe(workspaceBId);
    expect(row?.workspaceId).not.toBe(workspaceAId);
  });

  it('RLS hides the Workspace B integration from a connection scoped to Workspace A', async () => {
    if (!up) return;
    const row = await readIntegrationAsScoped(integrationId, { tenantId, workspaceId: workspaceAId });
    expect(row).toBeNull();
  });

  it('RLS reveals the Workspace B integration to a connection scoped to Workspace B itself', async () => {
    if (!up) return;
    const row = await readIntegrationAsScoped(integrationId, { tenantId, workspaceId: workspaceBId });
    expect(row?.id).toBe(integrationId);
  });

  it('through the app (masked) and RLS (hidden) alike, the raw secret is never observable from Workspace A', async () => {
    if (!up) return;
    const res = await authed(adminWsBToken).get('/api/admin/integrations');
    const found = res.body.data.integrations.find((i: { id: string }) => i.id === integrationId);
    expect(found).toBeTruthy(); // sanity: the app itself does show it, masked, to whoever created it
    expect(JSON.stringify(found.config)).not.toContain(SECRET_MARKER);

    const rlsRow = await readIntegrationAsScoped(integrationId, { tenantId, workspaceId: workspaceAId });
    expect(rlsRow).toBeNull();
  });

  afterAll(async () => {
    await appRolePrisma?.$disconnect();
  });
});

/**
 * Independent of any single test's fixtures: for EVERY existing
 * Integration/SystemConfiguration row that already has a sectorId, its
 * denormalized organizationId/workspaceId (if set) must agree with that
 * Sector's own organizationId/workspaceId. This is a whole-table invariant
 * on the retrofit's backfill/stamping logic, not a specific scenario — it
 * would catch a regression (e.g. a future write path that stamps from the
 * wrong ambient scope) even in data this suite didn't create.
 */
describe('Credential retrofit — org/workspace stamping invariant', () => {
  it('every sector-linked Integration/SystemConfiguration row agrees with its Sector\'s own org/workspace', async () => {
    if (!(await serverUp())) return;
    const sectors = await prisma.sector.findMany({ select: { id: true, organizationId: true, workspaceId: true } });
    const sectorById = new Map(sectors.map((s) => [s.id, s]));

    for (const model of ['integration', 'systemConfiguration'] as const) {
      const rows = await (prisma[model] as { findMany: (args: unknown) => Promise<Array<{ id: string; sectorId: string | null; organizationId: string | null; workspaceId: string | null }>> }).findMany({
        where: { sectorId: { not: null } },
        select: { id: true, sectorId: true, organizationId: true, workspaceId: true },
      });
      for (const row of rows) {
        const sector = row.sectorId ? sectorById.get(row.sectorId) : undefined;
        if (!sector) continue; // orphaned sectorId — unrelated to this invariant
        if (row.organizationId) expect(row.organizationId, `${model} ${row.id}`).toBe(sector.organizationId);
        if (row.workspaceId) expect(row.workspaceId, `${model} ${row.id}`).toBe(sector.workspaceId);
      }
    }
  });
});
