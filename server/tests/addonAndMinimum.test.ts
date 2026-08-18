import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Two related self-service billing mechanisms, both real-DB/no-HTTP (same
 * style as orgWorkspaceQuota.test.ts/overageBilling.test.ts):
 *
 *  1. Add-on purchases (Tenant.extraX / billingService.purchaseAddonCapacity)
 *     — a tenant-specific top-up of the included quota, raising ONLY this
 *     tenant's effective limit, using the plan's existing per-unit price.
 *  2. Deletion floor (Plan.minX / entitlementService.assertAboveMinimum) —
 *     blocks deleting an organization/workspace/user/candidate below a
 *     plan-configured minimum, independent of the maxX ceiling above.
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
let candidateService: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let entitlementService: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let billingService: any;

const run = Date.now().toString(36);
let tenantId: string;
let planId: string;
let roleId: string;
let defaultOrgId: string;
let defaultWorkspaceId: string;
let secondWorkspaceId: string;

const fakeReq = { user: { sub: null, role: 'ADMIN', sectorId: null }, headers: {} } as never;

beforeAll(async () => {
  ({ prisma } = await import('./helpers.js'));
  ({ runWithTenant } = await import('../src/config/tenantContext.js'));
  organizationService = await import('../src/services/organizationService.js');
  workspaceService = await import('../src/services/workspaceService.js');
  candidateService = await import('../src/services/candidateService.js');
  entitlementService = await import('../src/services/entitlementService.js');
  billingService = await import('../src/services/billing/billingService.js');

  // maxWorkspaces=1 with NO pricePerWorkspace (hard-block path, for the addon
  // test) alongside minWorkspaces=2 and minCandidates=1 (floor path).
  const plan = await prisma.plan.create({
    data: {
      code: `ADDONMIN_${run}`,
      name: 'Addon + Minimum Test Plan',
      isActive: true,
      maxWorkspaces: 1,
      pricePerWorkspace: 75,
      minWorkspaces: 2,
      minCandidates: 1,
      // maxUsers deliberately unset (unlimited) — this suite doesn't need a
      // user-quota fixture; assertAboveMinimum for USERS/CANDIDATES is
      // exercised directly against entitlementService below instead.
    },
  });
  planId = plan.id;
  const tenant = await prisma.tenant.create({
    data: { name: `AddonMin ${run}`, slug: `addonmin-${run}`, status: 'ACTIVE', planId },
  });
  tenantId = tenant.id;
  await prisma.subscription.create({
    data: { tenantId, planId, status: 'ACTIVE', currentPeriodStart: new Date() },
  });

  const { ensureDefaultOrganizationAndWorkspace } = await import('../src/services/workspaceProvisioningService.js');
  const seeded = await ensureDefaultOrganizationAndWorkspace(tenantId);
  defaultOrgId = seeded.organizationId;
  defaultWorkspaceId = seeded.workspaceId;

  const role = await prisma.role.findFirst({ where: { name: 'RECRUITER' } });
  roleId = role.id;
  await prisma.candidate.create({
    data: { tenantId, fullName: 'Floor Candidate', email: `addonmin.candidate.${run}@agnohire.local` },
  });
});

afterAll(async () => {
  // Guard against a failed/partial beforeAll leaving tenantId/planId unset —
  // `where: { tenantId: undefined }` drops the filter entirely in Prisma,
  // which would turn every deleteMany below into an unscoped delete across
  // the whole dev database.
  if (!tenantId) return;
  await prisma.candidate.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { tenantId } });
  await prisma.workspace.deleteMany({ where: { tenantId } });
  await prisma.organization.deleteMany({ where: { tenantId } });
  await prisma.subscription.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  if (planId) await prisma.plan.delete({ where: { id: planId } }).catch(() => {});
  await prisma.$disconnect();
});

describe('Add-on capacity purchase', () => {
  it('rejects a metric with no per-unit price configured on this plan (400)', async () => {
    await expect(billingService.purchaseAddonCapacity(tenantId, 'ORGANIZATIONS', 1)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('buying 1 extra workspace raises THIS tenant\'s effective limit from 1 to 2, priced at the plan\'s pricePerWorkspace', async () => {
    const before = await entitlementService.getEffectiveLimit(tenantId, 'WORKSPACES');
    expect(before).toBe(1);

    const receipt = await billingService.purchaseAddonCapacity(tenantId, 'WORKSPACES', 1);
    expect(receipt).toMatchObject({ metric: 'WORKSPACES', quantity: 1, unitPrice: 75, amount: 75, newEffectiveLimit: 2 });

    const after = await entitlementService.getEffectiveLimit(tenantId, 'WORKSPACES');
    expect(after).toBe(2);
  });

  it('creating a second workspace succeeds — the addon purchase above already raised the effective limit to 2', async () => {
    const workspace = await runWithTenant(tenantId, () =>
      workspaceService.createWorkspace({ organizationId: defaultOrgId, name: 'Second Workspace' }, fakeReq),
    );
    expect(workspace.id).toBeTruthy();
    secondWorkspaceId = workspace.id;
  });

  it('the addon-purchased unit is NOT double-billed as ongoing overage — it raised the included line instead', async () => {
    // The real difference an addon purchase makes: without it, this 2nd
    // workspace (1 over the plan's raw maxWorkspaces=1) would show up in
    // getOverageCharges every time this runs. Having pre-paid for it via the
    // addon raises the effective limit to 2, so 2 live workspaces is exactly
    // at quota — no ongoing overage line for it.
    const overage = await entitlementService.getOverageCharges(tenantId);
    expect(overage.charges.find((c: { metric: string }) => c.metric === 'WORKSPACES')).toBeUndefined();
  });

  it('the purchase is recorded in listAddonPurchases', async () => {
    const purchases = await billingService.listAddonPurchases(tenantId);
    expect(purchases).toHaveLength(1);
    expect(purchases[0]).toMatchObject({ metric: 'WORKSPACES', quantity: 1, unitPrice: 75, amount: 75 });
  });
});

describe('Deletion floor (Plan.minX)', () => {
  it('deleting down to exactly the floor is fine, but going below it is blocked', async () => {
    // Currently 2 live workspaces (default + the one bought above), floor is 2.
    await expect(
      runWithTenant(tenantId, () => workspaceService.deleteWorkspace(secondWorkspaceId, fakeReq)),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('raising the floor\'s plan setting is what actually governs it — lowering minWorkspaces to 1 unblocks the same delete', async () => {
    await prisma.plan.update({ where: { id: planId }, data: { minWorkspaces: 1 } });
    await runWithTenant(tenantId, () => workspaceService.deleteWorkspace(secondWorkspaceId, fakeReq));
    const workspace = await prisma.workspace.findUnique({ where: { id: secondWorkspaceId } });
    expect(workspace.deletedAt).toBeTruthy();
  });

  it('the last remaining Candidate cannot be deleted once minCandidates=1', async () => {
    const candidate = await prisma.candidate.findFirst({ where: { tenantId, deletedAt: null } });
    await expect(
      runWithTenant(tenantId, () =>
        candidateService.deleteCandidate(candidate.id, { userId: 'x', role: 'ADMIN', permissions: [] }, fakeReq),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('a plan with no minX configured for a metric never blocks deleting it (existing default behavior, unaffected)', async () => {
    // ORGANIZATIONS has no minOrganizations on this plan — assertAboveMinimum
    // is a pure no-op for it, same as before this feature existed.
    await expect(entitlementService.assertAboveMinimum(tenantId, 'ORGANIZATIONS', 1)).resolves.toBeUndefined();
  });
});
