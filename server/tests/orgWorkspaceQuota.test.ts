import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Plan-tier quota enforcement for Organization/Workspace creation — the
 * billing-by-count feature. Exercised directly against the service layer
 * (real DB, no HTTP), same style as billingStateMachine.test.ts: this needs a
 * dedicated Plan/Tenant/Subscription fixture with a deliberately tight limit,
 * which would be unsafe to apply to the shared dev 'default' tenant that every
 * other isolation test also relies on (its LEGACY_ENTERPRISE plan is
 * unlimited by design).
 *
 * The very first Organization/Workspace a tenant gets (via
 * ensureDefaultOrganizationAndWorkspace, exactly as real registration/
 * provisioning does) is seeded directly, bypassing the quota check — the same
 * way the tenant's first owner user bypasses the USERS quota. Only requests
 * for a SECOND org/workspace are quota-gated, which is what these tests probe.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prisma: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let runWithTenant: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let organizationService: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let workspaceService: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let entitlementService: any;

const run = Date.now().toString(36);
let tenantId: string;
let planId: string;
let defaultOrgId: string;
let defaultWorkspaceId: string;

// recordAudit (called by both services) never throws on a malformed req — it
// swallows its own errors — so a minimal stand-in is enough here. `sub: null`
// avoids a (harmless but noisy) AuditLog FK violation against a userId that
// doesn't actually exist.
const fakeReq = { user: { sub: null, role: 'ADMIN', sectorId: null }, headers: {} } as never;

beforeAll(async () => {
  ({ prisma } = await import('./helpers.js'));
  ({ runWithTenant } = await import('../src/config/tenantContext.js'));
  organizationService = await import('../src/services/organizationService.js');
  workspaceService = await import('../src/services/workspaceService.js');
  entitlementService = await import('../src/services/entitlementService.js');

  const plan = await prisma.plan.create({
    data: { code: `ORGWS_QUOTA_${run}`, name: 'Org/Workspace Quota Test Plan', maxOrganizations: 1, maxWorkspaces: 1, isActive: true },
  });
  planId = plan.id;
  const tenant = await prisma.tenant.create({
    data: { name: `OrgWs Quota ${run}`, slug: `orgws-quota-${run}`, status: 'ACTIVE', planId },
  });
  tenantId = tenant.id;
  await prisma.subscription.create({
    data: { tenantId, planId, status: 'ACTIVE', currentPeriodStart: new Date() },
  });

  const { ensureDefaultOrganizationAndWorkspace } = await import('../src/services/workspaceProvisioningService.js');
  const seeded = await ensureDefaultOrganizationAndWorkspace(tenantId);
  defaultOrgId = seeded.organizationId;
  defaultWorkspaceId = seeded.workspaceId;
});

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { tenantId } });
  await prisma.organization.deleteMany({ where: { tenantId } });
  await prisma.subscription.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await prisma.plan.delete({ where: { id: planId } }).catch(() => {});
  await prisma.$disconnect();
});

describe('Organization/Workspace plan-tier quota', () => {
  it('the seeded default org/workspace count as usage without ever having called createOrganization/createWorkspace', async () => {
    const usage = await entitlementService.getUsage(tenantId);
    const orgs = usage.usage.find((u: { metric: string }) => u.metric === 'ORGANIZATIONS');
    const workspaces = usage.usage.find((u: { metric: string }) => u.metric === 'WORKSPACES');
    expect(orgs).toMatchObject({ used: 1, limit: 1, remaining: 0 });
    expect(workspaces).toMatchObject({ used: 1, limit: 1, remaining: 0 });
  });

  it('creating a second Organization is blocked with a 402 once maxOrganizations is reached', async () => {
    await expect(
      runWithTenant(tenantId, () => organizationService.createOrganization({ name: 'Second Org' }, fakeReq)),
    ).rejects.toMatchObject({ statusCode: 402, code: 'QUOTA_EXCEEDED' });
  });

  it('creating a second Workspace (even under the same Organization) is blocked with a 402 once maxWorkspaces is reached', async () => {
    await expect(
      runWithTenant(tenantId, () =>
        workspaceService.createWorkspace({ organizationId: defaultOrgId, name: 'Second Workspace' }, fakeReq),
      ),
    ).rejects.toMatchObject({ statusCode: 402, code: 'QUOTA_EXCEEDED' });
  });

  it('raising the plan limit (the configurable Billing & Plans setting) immediately unblocks creation', async () => {
    await prisma.plan.update({ where: { id: planId }, data: { maxOrganizations: 2, maxWorkspaces: 2 } });

    const org = await runWithTenant(tenantId, () =>
      organizationService.createOrganization({ name: 'Second Org' }, fakeReq),
    );
    expect(org.id).toBeTruthy();

    const workspace = await runWithTenant(tenantId, () =>
      workspaceService.createWorkspace({ organizationId: defaultOrgId, name: 'Second Workspace' }, fakeReq),
    );
    expect(workspace.id).toBeTruthy();

    const usage = await entitlementService.getUsage(tenantId);
    const orgs = usage.usage.find((u: { metric: string }) => u.metric === 'ORGANIZATIONS');
    const workspaces = usage.usage.find((u: { metric: string }) => u.metric === 'WORKSPACES');
    expect(orgs).toMatchObject({ used: 2, limit: 2, remaining: 0 });
    expect(workspaces).toMatchObject({ used: 2, limit: 2, remaining: 0 });
  });

  it('deleting an Organization/Workspace DOES free its quota slot (unlike USERS/ACTIVE_JOBS, which stay lifetime ceilings)', async () => {
    // Already at the (now 2/2) limit from the previous test. The fixture
    // client here (helpers.ts) is a plain, un-middlewared PrismaClient — a
    // real `.delete()` would hard-delete the row, not soft-delete it the way
    // a live DELETE /api/workspaces/:id request would (that goes through the
    // app's own soft-delete middleware in config/database.ts). Set
    // `deletedAt` directly to faithfully simulate that.
    await prisma.workspace.update({ where: { id: defaultWorkspaceId }, data: { deletedAt: new Date() } });

    const workspace = await runWithTenant(tenantId, () =>
      workspaceService.createWorkspace({ organizationId: defaultOrgId, name: 'Third Workspace' }, fakeReq),
    );
    expect(workspace.id).toBeTruthy();

    // Back at 2/2 (1 deleted + 2 live) — a 4th is blocked again.
    await expect(
      runWithTenant(tenantId, () =>
        workspaceService.createWorkspace({ organizationId: defaultOrgId, name: 'Fourth Workspace' }, fakeReq),
      ),
    ).rejects.toMatchObject({ statusCode: 402, code: 'QUOTA_EXCEEDED' });
  });
});
