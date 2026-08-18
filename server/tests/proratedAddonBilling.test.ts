import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Immediate mid-cycle prorated charge for an add-on capacity increase
 * (auto-pay tenants only) — billingService.issueProratedInvoice, exercised
 * via purchaseAddonCapacity directly (real DB, no HTTP, stub PaymentProvider,
 * same dedicated-fixture style as recurringAddonBilling.test.ts). Covers the
 * proration math, the auto-pay gate, provider-failure resilience, and the
 * payment_link.* webhook updating the purchase row's status.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prisma: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let billingService: any;

const run = Date.now().toString(36);
let tenantId: string;
let planId: string;
let ownerId: string;

const RZP_SUB_ID = `sub_prorate_${run}`;
const UNIT_PRICE = 100; // pricePerWorkspace on the fixture plan

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const linkCalls: any[] = [];
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
  async createAddon() {
    throw new Error('not used in this suite');
  },
  async createPaymentLink(opts: { amount: number; currency: string; description: string; customerName: string; customerEmail: string; notes: Record<string, string> }) {
    linkCalls.push(opts);
    return { id: `plink_${linkCalls.length}_${run}`, shortUrl: `https://rzp.io/l/fake${linkCalls.length}` };
  },
  verifyCheckoutSignature() {
    return true;
  },
  verifyWebhookSignature() {
    return true;
  },
};

async function setPeriod(daysElapsed: number, daysTotal: number) {
  const now = Date.now();
  const start = new Date(now - daysElapsed * 86_400_000);
  const end = new Date(now + (daysTotal - daysElapsed) * 86_400_000);
  await prisma.subscription.update({ where: { tenantId }, data: { currentPeriodStart: start, currentPeriodEnd: end } });
}

beforeAll(async () => {
  ({ prisma } = await import('./helpers.js'));
  billingService = await import('../src/services/billing/billingService.js');
  billingService.setPaymentProvider(stubProvider);

  const plan = await prisma.plan.create({
    data: { code: `PRORATE_${run}`, name: 'Prorated Addon Test Plan', isActive: true, maxWorkspaces: 1, pricePerWorkspace: UNIT_PRICE },
  });
  planId = plan.id;
  const tenant = await prisma.tenant.create({
    data: { name: `Prorate ${run}`, slug: `prorate-${run}`, status: 'ACTIVE', planId },
  });
  tenantId = tenant.id;

  const role = await prisma.role.findFirst({ where: { name: 'ADMIN' } });
  const owner = await prisma.user.create({
    data: { tenantId, roleId: role.id, fullName: 'Prorate Owner', email: `prorate.owner.${run}@agnohire.local`, isActive: true },
  });
  ownerId = owner.id;
  await prisma.tenant.update({ where: { id: tenantId }, data: { ownerUserId: ownerId } });

  await prisma.subscription.create({
    data: {
      tenantId,
      planId,
      status: 'ACTIVE',
      autoPayEnabled: true,
      autoPayConsentedAt: new Date(),
      razorpaySubscriptionId: RZP_SUB_ID,
      currentPeriodStart: new Date(Date.now() - 10 * 86_400_000),
      currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000), // 30-day cycle, 20 days remaining
    },
  });
});

afterAll(async () => {
  if (!tenantId) return;
  await prisma.notification.deleteMany({ where: { entityId: tenantId } }).catch(() => {});
  await prisma.emailLog.deleteMany({ where: { toEmail: `prorate.owner.${run}@agnohire.local` } }).catch(() => {});
  await prisma.tenantAddonPurchase.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { tenantId } });
  await prisma.subscription.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await prisma.plan.delete({ where: { id: planId } }).catch(() => {});
  await prisma.$disconnect();
});

describe('Mid-cycle add-on increase — immediate prorated charge (auto-pay only)', () => {
  it('20 of 30 days remaining → prorates to 2/3 of the full per-unit price', async () => {
    const result = await billingService.purchaseAddonCapacity(tenantId, 'WORKSPACES', 1);
    expect(result.amount).toBe(UNIT_PRICE); // full amount still recorded as the purchase's face value
    expect(result.prorationAmount).toBeCloseTo((UNIT_PRICE * 20) / 30, 1);
    expect(result.paymentLinkUrl).toBe('https://rzp.io/l/fake1');

    expect(linkCalls).toHaveLength(1);
    expect(linkCalls[0]).toMatchObject({ currency: 'INR', customerEmail: `prorate.owner.${run}@agnohire.local` });
    expect(linkCalls[0].amount).toBeCloseTo((UNIT_PRICE * 20) / 30, 1);

    const purchase = await prisma.tenantAddonPurchase.findFirst({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
    expect(purchase.paymentLinkStatus).toBe('PENDING');
    expect(Number(purchase.prorationAmount)).toBeCloseTo((UNIT_PRICE * 20) / 30, 1);
  });

  it('capacity applies immediately regardless of proration — base 1 + 1 purchased = 2', async () => {
    const { getEffectiveLimit } = await import('../src/services/entitlementService.js');
    const limit = await getEffectiveLimit(tenantId, 'WORKSPACES');
    expect(limit).toBe(2);
  });

  it('a payment_link.paid webhook marks the purchase PAID', async () => {
    const purchase = await prisma.tenantAddonPurchase.findFirst({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
    await billingService.processWebhookEvent(`evt_link_paid_${run}`, 'payment_link.paid', {
      event: 'payment_link.paid',
      payload: {
        payment_link: { entity: { id: purchase.razorpayPaymentLinkId, notes: { tenantId } } },
        payment: { entity: { id: `pay_${run}` } },
      },
    });
    const updated = await prisma.tenantAddonPurchase.findUnique({ where: { id: purchase.id } });
    expect(updated.paymentLinkStatus).toBe('PAID');
  });

  it('no proration when auto-pay is off — behaves exactly as before this feature', async () => {
    await prisma.subscription.update({ where: { tenantId }, data: { autoPayEnabled: false } });
    const before = linkCalls.length;
    const result = await billingService.purchaseAddonCapacity(tenantId, 'WORKSPACES', 1);
    expect(result.newEffectiveLimit).toBe(3); // capacity still applies immediately either way
    expect(result.prorationAmount).toBeNull();
    expect(result.paymentLinkUrl).toBeNull();
    expect(linkCalls).toHaveLength(before); // no new provider call
    await prisma.subscription.update({ where: { tenantId }, data: { autoPayEnabled: true } });
  });

  it('a provider failure is logged, not thrown — the capacity increase still succeeds', async () => {
    const failing = { ...stubProvider, createPaymentLink: async () => { throw new Error('Razorpay outage'); } };
    billingService.setPaymentProvider(failing);

    const result = await billingService.purchaseAddonCapacity(tenantId, 'WORKSPACES', 1);
    expect(result.newEffectiveLimit).toBe(4); // capacity increase went through regardless
    expect(result.paymentLinkUrl).toBeNull(); // but no link — provider call failed

    billingService.setPaymentProvider(stubProvider);
  });

  it('~0 days remaining in the cycle → no proration issued (nothing meaningful left to charge for)', async () => {
    await setPeriod(30, 30); // 0 days remaining
    const before = linkCalls.length;
    const result = await billingService.purchaseAddonCapacity(tenantId, 'WORKSPACES', 1);
    expect(result.prorationAmount).toBeNull();
    expect(result.paymentLinkUrl).toBeNull();
    expect(linkCalls).toHaveLength(before);
  });
});
