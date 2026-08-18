import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Per-unit overage pricing (Plan.pricePerOrganization/Workspace/User/Candidate)
 * now has ONE job: pricing the self-service "buy add-on capacity" purchase
 * (see addonAndMinimum.test.ts). Creation is ALWAYS hard-blocked once at the
 * effective limit (plan maxX + purchased add-on capacity) — a configured
 * price no longer bypasses that block; there is no automatic
 * metered-overage path anymore (see entitlementService.assertWithinLimit).
 * getOverageCharges still reports and prices any PRE-EXISTING over-limit
 * data (e.g. grandfathered from before this policy, or created by a
 * privileged bypass) live off the current count — it just can no longer be
 * produced by a normal tenant create anymore, so this file creates that
 * state directly via the raw fixture client rather than through the service
 * layer. Same dedicated-fixture style as orgWorkspaceQuota.test.ts/
 * billingStateMachine.test.ts: a real DB, no HTTP, an isolated tenant so the
 * shared dev 'default' tenant (unlimited LEGACY_ENTERPRISE plan) is never
 * touched.
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let billingService: any;

const run = Date.now().toString(36);
let tenantId: string;
let planId: string;
let roleId: string;
let defaultOrgId: string;
let defaultWorkspaceId: string;
let extraCandidateId: string;

const fakeReq = { user: { sub: null, role: 'ADMIN', sectorId: null }, headers: {} } as never;

beforeAll(async () => {
  ({ prisma } = await import('./helpers.js'));
  ({ runWithTenant } = await import('../src/config/tenantContext.js'));
  organizationService = await import('../src/services/organizationService.js');
  workspaceService = await import('../src/services/workspaceService.js');
  entitlementService = await import('../src/services/entitlementService.js');
  billingService = await import('../src/services/billing/billingService.js');

  const plan = await prisma.plan.create({
    data: {
      code: `OVERAGE_${run}`,
      name: 'Overage Billing Test Plan',
      isActive: true,
      maxOrganizations: 1,
      maxWorkspaces: 1,
      maxUsers: 1,
      maxCandidates: 1,
      pricePerOrganization: 100,
      pricePerWorkspace: 50,
      pricePerUser: 200,
      pricePerCandidate: 10,
    },
  });
  planId = plan.id;
  const tenant = await prisma.tenant.create({
    data: { name: `Overage ${run}`, slug: `overage-${run}`, status: 'ACTIVE', planId },
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
  await prisma.user.create({
    data: { tenantId, roleId, fullName: 'Baseline User', email: `overage.baseline.${run}@agnohire.local`, isActive: true },
  });
  await prisma.candidate.create({
    data: { tenantId, fullName: 'Baseline Candidate', email: `overage.candidate.baseline.${run}@agnohire.local` },
  });
});

afterAll(async () => {
  await prisma.candidate.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { tenantId } });
  await prisma.workspace.deleteMany({ where: { tenantId } });
  await prisma.organization.deleteMany({ where: { tenantId } });
  await prisma.subscription.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await prisma.plan.delete({ where: { id: planId } }).catch(() => {});
  await prisma.$disconnect();
});

describe('Creation is always hard-blocked at the effective limit, priced or not', () => {
  it('at exactly the included quota, no overage is charged', async () => {
    const overage = await entitlementService.getOverageCharges(tenantId);
    expect(overage.charges).toEqual([]);
    expect(overage.total).toBe(0);
  });

  it('creating a second Organization/Workspace is BLOCKED (402) even though a per-unit price is configured', async () => {
    await expect(
      runWithTenant(tenantId, () => organizationService.createOrganization({ name: 'Second Org' }, fakeReq)),
    ).rejects.toMatchObject({ statusCode: 402 });
    await expect(
      runWithTenant(tenantId, () => workspaceService.createWorkspace({ organizationId: defaultOrgId, name: 'Second Workspace' }, fakeReq)),
    ).rejects.toMatchObject({ statusCode: 402 });
  });

  it('assertWithinLimit throws for a priced metric too, once at the effective limit', async () => {
    await expect(entitlementService.assertWithinLimit(tenantId, 'USERS', 1)).rejects.toMatchObject({ statusCode: 402 });
    await expect(entitlementService.assertWithinLimit(tenantId, 'CANDIDATES', 1)).rejects.toMatchObject({ statusCode: 402 });
  });

  it('buying add-on capacity raises the effective limit and unblocks creation', async () => {
    const receipt = await billingService.purchaseAddonCapacity(tenantId, 'ORGANIZATIONS', 1);
    expect(receipt).toMatchObject({ metric: 'ORGANIZATIONS', unitPrice: 100, amount: 100, newEffectiveLimit: 2 });

    const org = await runWithTenant(tenantId, () => organizationService.createOrganization({ name: 'Second Org' }, fakeReq));
    expect(org.id).toBeTruthy();
    // Back at the (now raised) limit — a third is blocked again.
    await expect(
      runWithTenant(tenantId, () => organizationService.createOrganization({ name: 'Third Org' }, fakeReq)),
    ).rejects.toMatchObject({ statusCode: 402 });
  });
});

describe('getOverageCharges — still prices any pre-existing over-limit data live', () => {
  it('reflects the CURRENT live count for every priced metric, correctly priced', async () => {
    // Simulates data that's already over quota (e.g. from before this policy,
    // or a privileged bypass) — created directly, bypassing the now-blocking
    // service layer, since that's the only way this state can arise anymore.
    const extraUser = await prisma.user.create({
      data: { tenantId, roleId, fullName: 'Extra User', email: `overage.extra.${run}@agnohire.local`, isActive: true },
    });
    const extraCandidate = await prisma.candidate.create({
      data: { tenantId, fullName: 'Extra Candidate', email: `overage.candidate.extra.${run}@agnohire.local` },
    });
    extraCandidateId = extraCandidate.id;
    // Workspace bought in the previous block already accounts for
    // ORGANIZATIONS; add one over-limit WORKSPACES row the same way.
    await prisma.workspace.create({ data: { tenantId, organizationId: defaultOrgId, name: 'Extra Workspace' } });

    const overage = await entitlementService.getOverageCharges(tenantId);
    const byMetric = new Map(overage.charges.map((c: { metric: string }) => [c.metric, c]));
    expect(byMetric.get('WORKSPACES')).toMatchObject({ unitsOver: 1, unitPrice: 50, amount: 50 });
    expect(byMetric.get('USERS')).toMatchObject({ unitsOver: 1, unitPrice: 200, amount: 200 });
    expect(byMetric.get('CANDIDATES')).toMatchObject({ unitsOver: 1, unitPrice: 10, amount: 10 });
    // ORGANIZATIONS is NOT over — the add-on purchase above already covers
    // the 2nd one, this is exactly the "not double-billed" guarantee.
    expect(byMetric.has('ORGANIZATIONS')).toBe(false);
    expect(overage.total).toBe(260);
    expect(overage.currency).toBe('INR');

    await prisma.user.delete({ where: { id: extraUser.id } }).catch(() => {});
  });

  it('deleting the extra Candidate immediately drops its overage charge back to zero (elastic, not lifetime)', async () => {
    // Simulate what a live DELETE would produce through the app's soft-delete
    // middleware (the raw fixture client here bypasses it — see
    // orgWorkspaceQuota.test.ts's identical note).
    await prisma.candidate.update({ where: { id: extraCandidateId }, data: { deletedAt: new Date() } });

    const overage = await entitlementService.getOverageCharges(tenantId);
    const byMetric = new Map(overage.charges.map((c: { metric: string }) => [c.metric, c]));
    expect(byMetric.has('CANDIDATES')).toBe(false);
    // USERS' extra was hard-deleted at the end of the previous test, so only
    // WORKSPACES (50) remains over quota here.
    expect(overage.total).toBe(50);
  });

  it('getUsage exposes unitPrice per metric so clients can distinguish priceable metrics from a pure hard block', async () => {
    const usage = await entitlementService.getUsage(tenantId);
    const byMetric = new Map(usage.usage.map((u: { metric: string }) => [u.metric, u]));
    expect((byMetric.get('ORGANIZATIONS') as { unitPrice: number | null }).unitPrice).toBe(100);
    expect((byMetric.get('CANDIDATES') as { unitPrice: number | null }).unitPrice).toBe(10);
    // ACTIVE_JOBS has no overage pricing concept — always a hard block.
    expect((byMetric.get('ACTIVE_JOBS') as { unitPrice: number | null }).unitPrice).toBeNull();
  });
});
