import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Recurring add-on/overage billing: the recurring monthly charge for
 * purchased add-on capacity (Tenant.extraX × current pricePerX), deferred
 * decreases (effective next renewal only), the autoPay consent toggle, and
 * attaching that charge to Razorpay via a stub PaymentProvider (real Bull/
 * webhook dispatch is exercised separately by billingStateMachine.test.ts's
 * style — this file targets the new billingService functions directly, real
 * DB, no HTTP, same dedicated-fixture style as the other billing tests).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prisma: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let billingService: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let entitlementService: any;

const run = Date.now().toString(36);
let tenantId: string;
let planId: string;
let roleId: string;
let adminA: { id: string; email: string };
let adminB: { id: string; email: string };

const RZP_SUB_ID = `sub_addon_${run}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createAddonCalls: any[] = [];
const stubProvider = {
  async createSubscription() {
    throw new Error('not used in this suite');
  },
  async cancelSubscription() {
    /* no-op */
  },
  async fetchSubscription() {
    throw new Error('not used in this suite');
  },
  async createAddon(opts: { razorpaySubscriptionId: string; name: string; amount: number; currency: string }) {
    createAddonCalls.push(opts);
    return { id: `addon_${createAddonCalls.length}_${run}` };
  },
  verifyCheckoutSignature() {
    return true;
  },
  verifyWebhookSignature() {
    return true;
  },
};

beforeAll(async () => {
  ({ prisma } = await import('./helpers.js'));
  billingService = await import('../src/services/billing/billingService.js');
  entitlementService = await import('../src/services/entitlementService.js');
  billingService.setPaymentProvider(stubProvider);

  const plan = await prisma.plan.create({
    data: {
      code: `RECUR_${run}`,
      name: 'Recurring Addon Test Plan',
      isActive: true,
      maxWorkspaces: 1,
      pricePerWorkspace: 50,
    },
  });
  planId = plan.id;
  const tenant = await prisma.tenant.create({
    data: { name: `Recur ${run}`, slug: `recur-${run}`, status: 'ACTIVE', planId, extraWorkspaces: 2 },
  });
  tenantId = tenant.id;
  await prisma.subscription.create({
    data: {
      tenantId,
      planId,
      status: 'ACTIVE',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000),
      // No razorpaySubscriptionId yet — the "reject autoPay without a mandate" test relies on this.
    },
  });

  const role = await prisma.role.findFirst({ where: { name: 'ADMIN' } });
  roleId = role.id;
  const a = await prisma.user.create({
    data: { tenantId, roleId, fullName: 'Admin A', email: `recur.admina.${run}@agnohire.local`, isActive: true },
  });
  const b = await prisma.user.create({
    data: { tenantId, roleId, fullName: 'Admin B', email: `recur.adminb.${run}@agnohire.local`, isActive: true },
  });
  adminA = { id: a.id, email: a.email };
  adminB = { id: b.id, email: b.email };
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { entityId: tenantId } }).catch(() => {});
  await prisma.emailLog.deleteMany({ where: { OR: [{ toEmail: adminA?.email }, { toEmail: adminB?.email }] } }).catch(() => {});
  await prisma.recurringAddonCharge.deleteMany({ where: { tenantId } });
  await prisma.tenantAddonPendingChange.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { tenantId } });
  await prisma.subscription.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await prisma.plan.delete({ where: { id: planId } }).catch(() => {});
  await prisma.$disconnect();
});

describe('Recurring add-on charge computation', () => {
  it('is Tenant.extraX × current pricePerX, summed across metrics', async () => {
    const charge = await billingService.getRecurringAddonCharge(tenantId);
    expect(charge.breakdown).toEqual([{ metric: 'WORKSPACES', extraUnits: 2, unitPrice: 50, amount: 100 }]);
    expect(charge.total).toBe(100);
    expect(charge.currency).toBe('INR');
  });

  it('getUsage exposes the same extra count for the client decrease UI', async () => {
    const usage = await entitlementService.getUsage(tenantId);
    const ws = usage.usage.find((u: { metric: string }) => u.metric === 'WORKSPACES');
    expect(ws.extra).toBe(2);
  });
});

describe('Deferred add-on decrease (effective next renewal only)', () => {
  it('rejects requesting to remove more than currently owned', async () => {
    await expect(billingService.scheduleAddonDecrease(tenantId, 'WORKSPACES', 3)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('scheduling a decrease does NOT change extraX or the recurring charge immediately', async () => {
    const change = await billingService.scheduleAddonDecrease(tenantId, 'WORKSPACES', 1);
    expect(change).toMatchObject({ metric: 'WORKSPACES', delta: -1 });
    expect(change.effectiveAt).toBeTruthy();

    const charge = await billingService.getRecurringAddonCharge(tenantId);
    expect(charge.total).toBe(100); // unchanged — still 2 units until rollover

    const pending = await billingService.getPendingAddonChanges(tenantId);
    expect(pending).toHaveLength(1);
  });

  it('a second decrease request is capped by what remains AFTER the first pending one', async () => {
    // 2 owned, 1 already pending → only 1 more available.
    await expect(billingService.scheduleAddonDecrease(tenantId, 'WORKSPACES', 2)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rolloverPeriod (the actual renewal point) applies the pending decrease, dropping extraX by exactly 1', async () => {
    await entitlementService.rolloverPeriod(tenantId, new Date(), new Date(Date.now() + 30 * 86_400_000));
    const charge = await billingService.getRecurringAddonCharge(tenantId);
    expect(charge.total).toBe(50); // 2 - 1 = 1 unit remaining
    const pending = await billingService.getPendingAddonChanges(tenantId);
    expect(pending).toHaveLength(0); // applied, no longer pending
  });

  it('a pending change can be cancelled before it applies', async () => {
    const change = await billingService.scheduleAddonDecrease(tenantId, 'WORKSPACES', 1);
    await billingService.cancelPendingAddonChange(tenantId, change.id);
    const pending = await billingService.getPendingAddonChanges(tenantId);
    expect(pending).toHaveLength(0);
    await entitlementService.rolloverPeriod(tenantId, new Date(), new Date(Date.now() + 30 * 86_400_000));
    const charge = await billingService.getRecurringAddonCharge(tenantId);
    expect(charge.total).toBe(50); // unchanged — the cancelled decrease never applied
  });
});

describe('Auto-pay consent toggle', () => {
  it('rejects enabling auto-pay without an active Razorpay mandate', async () => {
    await expect(billingService.setAutoPay(tenantId, true)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('succeeds once a mandate exists, and records a consent timestamp', async () => {
    await prisma.subscription.update({ where: { tenantId }, data: { razorpaySubscriptionId: RZP_SUB_ID } });
    const result = await billingService.setAutoPay(tenantId, true);
    expect(result.autoPayEnabled).toBe(true);
    expect(result.autoPayConsentedAt).toBeTruthy();
  });

  it('disabling never clears the historical consent timestamp', async () => {
    const before = (await billingService.getSubscriptionSummary(tenantId)).autoPayConsentedAt;
    const result = await billingService.setAutoPay(tenantId, false);
    expect(result.autoPayEnabled).toBe(false);
    const after = (await billingService.getSubscriptionSummary(tenantId)).autoPayConsentedAt;
    expect(after).toBe(before);
  });
});

describe('Attaching the recurring charge to Razorpay (stub provider)', () => {
  it('does nothing when the amount is zero', async () => {
    // Currently 1 extra workspace × 50 = 50, not zero — force it to zero for this check.
    await prisma.tenant.update({ where: { id: tenantId }, data: { extraWorkspaces: 0 } });
    await billingService.attachRecurringAddonCharge(tenantId);
    expect(createAddonCalls).toHaveLength(0);
    const rows = await prisma.recurringAddonCharge.findMany({ where: { tenantId } });
    expect(rows).toHaveLength(0);
    await prisma.tenant.update({ where: { id: tenantId }, data: { extraWorkspaces: 1 } }); // restore
  });

  it('calls the provider and records an ATTACHED charge exactly once per periodEnd (idempotent)', async () => {
    await billingService.attachRecurringAddonCharge(tenantId);
    await billingService.attachRecurringAddonCharge(tenantId); // duplicate call, e.g. a retry

    expect(createAddonCalls).toHaveLength(1);
    expect(createAddonCalls[0]).toMatchObject({ razorpaySubscriptionId: RZP_SUB_ID, amount: 50, currency: 'INR' });

    const rows = await prisma.recurringAddonCharge.findMany({ where: { tenantId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('ATTACHED');
  });

  it('records FAILED (not thrown) when the provider rejects, without crashing the caller', async () => {
    const newPeriodEnd = new Date(Date.now() + 60 * 86_400_000);
    await prisma.subscription.update({ where: { tenantId }, data: { currentPeriodEnd: newPeriodEnd } });
    const failing = { ...stubProvider, createAddon: async () => { throw new Error('Razorpay outage'); } };
    billingService.setPaymentProvider(failing);

    await expect(billingService.attachRecurringAddonCharge(tenantId)).resolves.toBeUndefined();

    const row = await prisma.recurringAddonCharge.findUnique({
      where: { tenantId_periodEnd: { tenantId, periodEnd: newPeriodEnd } },
    });
    expect(row.status).toBe('FAILED');
    expect(row.errorMessage).toContain('Razorpay outage');

    billingService.setPaymentProvider(stubProvider); // restore for subsequent tests
  });
});

describe('sendRenewalReminder — notifies every admin, auto-collects only when opted in', () => {
  it('notifies ALL admin-tier users under the tenant, not just the owner', async () => {
    await prisma.notification.deleteMany({ where: { entityId: tenantId } });
    await billingService.sendRenewalReminder(tenantId);

    const notifs = await prisma.notification.findMany({ where: { entityId: tenantId, type: 'BILLING' } });
    const recipientIds = notifs.map((n: { recipientId: string }) => n.recipientId);
    expect(recipientIds).toEqual(expect.arrayContaining([adminA.id, adminB.id]));
  });

  it('auto-pay is currently ON for this tenant, so it also attaches to Razorpay for the current period', async () => {
    const periodEnd = (await prisma.subscription.findUnique({ where: { tenantId } })).currentPeriodEnd;
    const before = createAddonCalls.length;
    await billingService.sendRenewalReminder(tenantId);
    // Idempotent per periodEnd — a charge already exists for this cycle from
    // the earlier "Attaching..." block, so no NEW provider call here.
    expect(createAddonCalls.length).toBe(before);
    const row = await prisma.recurringAddonCharge.findUnique({ where: { tenantId_periodEnd: { tenantId, periodEnd } } });
    expect(row).toBeTruthy();
  });

  it('turning auto-pay off still notifies, but stops attaching new charges for a FRESH period', async () => {
    await billingService.setAutoPay(tenantId, false);
    const freshPeriodEnd = new Date(Date.now() + 90 * 86_400_000);
    await prisma.subscription.update({ where: { tenantId }, data: { currentPeriodEnd: freshPeriodEnd } });

    await billingService.sendRenewalReminder(tenantId);

    const row = await prisma.recurringAddonCharge.findUnique({
      where: { tenantId_periodEnd: { tenantId, periodEnd: freshPeriodEnd } },
    });
    expect(row).toBeNull(); // never attached — autoPay was off
  });
});
