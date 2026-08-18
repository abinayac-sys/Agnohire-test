import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Reverting a scheduled ("cancel at period end") cancellation. Razorpay has
 * no API to undo cancel_at_cycle_end once set, so resumeSubscription()
 * replaces the doomed subscription with a fresh one on the same plan —
 * exercised here against a stub PaymentProvider (real DB, no HTTP, no
 * network), mirroring recurringAddonBilling.test.ts's style.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prisma: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let billingService: any;

const run = Date.now().toString(36);
let tenantId: string;
let planId: string;

const OLD_SUB_ID = `sub_old_${run}`;
let createCalls = 0;
let cancelCalls: { id: string; atCycleEnd: boolean }[] = [];

const stubProvider = {
  async createSubscription() {
    createCalls += 1;
    return { id: `sub_new_${run}_${createCalls}`, status: 'created', shortUrl: null, currentStart: null, currentEnd: null };
  },
  async cancelSubscription(id: string, atCycleEnd: boolean) {
    cancelCalls.push({ id, atCycleEnd });
  },
  async fetchSubscription() {
    throw new Error('not used in this suite');
  },
  async createAddon() {
    throw new Error('not used in this suite');
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
  billingService.setPaymentProvider(stubProvider);

  const plan = await prisma.plan.create({
    data: {
      code: `RESUME_${run}`,
      name: 'Resume Test Plan',
      isActive: true,
      priceMonthly: 999,
      razorpayPlanIdMonthly: `plan_${run}`,
    },
  });
  planId = plan.id;
  const tenant = await prisma.tenant.create({
    data: { name: `Resume ${run}`, slug: `resume-${run}`, status: 'ACTIVE', planId },
  });
  tenantId = tenant.id;
});

afterAll(async () => {
  await prisma.subscription.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await prisma.plan.delete({ where: { id: planId } }).catch(() => {});
  await prisma.$disconnect();
});

describe('resumeSubscription', () => {
  it('rejects when the subscription is not scheduled to cancel', async () => {
    await prisma.subscription.upsert({
      where: { tenantId },
      create: { tenantId, planId, status: 'ACTIVE', billingInterval: 'monthly', razorpaySubscriptionId: OLD_SUB_ID, cancelAtPeriodEnd: false },
      update: { status: 'ACTIVE', razorpaySubscriptionId: OLD_SUB_ID, cancelAtPeriodEnd: false },
    });
    await expect(billingService.resumeSubscription(tenantId)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects when the subscription is already cancelled (not merely scheduled)', async () => {
    await prisma.subscription.update({ where: { tenantId }, data: { status: 'CANCELLED', cancelAtPeriodEnd: true } });
    await expect(billingService.resumeSubscription(tenantId)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('replaces the doomed subscription: cancels the old one immediately, creates a fresh one, clears cancelAtPeriodEnd', async () => {
    await prisma.subscription.update({
      where: { tenantId },
      data: { status: 'ACTIVE', cancelAtPeriodEnd: true, razorpaySubscriptionId: OLD_SUB_ID },
    });

    const result = await billingService.resumeSubscription(tenantId);

    expect(result.razorpaySubscriptionId).not.toBe(OLD_SUB_ID);
    expect(cancelCalls).toEqual(expect.arrayContaining([{ id: OLD_SUB_ID, atCycleEnd: false }]));

    const sub = await prisma.subscription.findUnique({ where: { tenantId } });
    expect(sub.cancelAtPeriodEnd).toBe(false);
    expect(sub.razorpaySubscriptionId).toBe(result.razorpaySubscriptionId);
    expect(sub.status).toBe('CREATED'); // becomes ACTIVE again only once Razorpay confirms via webhook
  });
});
