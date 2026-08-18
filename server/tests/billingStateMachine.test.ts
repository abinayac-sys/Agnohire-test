import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Webhook-driven subscription state machine, exercised against the REAL
 * database (no HTTP, no Razorpay network): activation → renewal (period
 * rollover + invoice mirror) → past-due → halted → cancelled, plus event
 * idempotency. This is the full activation path a real Razorpay webhook
 * drives — only the network delivery + signature layer (unit-tested in
 * billingSignatures.test.ts) is stubbed out.
 */

process.env.RAZORPAY_KEY_ID ??= 'rzp_test_dummy';
process.env.RAZORPAY_KEY_SECRET ??= 'dummy';
process.env.RAZORPAY_WEBHOOK_SECRET ??= 'dummy';

const run = Date.now().toString(36);
const RZP_SUB_ID = `sub_e2e_${run}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prisma: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let billing: any;
let tenantId: string;
let planId: string;

function subEvent(event: string, opts: { start?: number; end?: number } = {}) {
  return {
    event,
    payload: {
      subscription: {
        entity: {
          id: RZP_SUB_ID,
          notes: { tenantId, planCode: `E2E_${run}` },
          current_start: opts.start ?? Math.floor(Date.now() / 1000),
          current_end: opts.end ?? Math.floor(Date.now() / 1000) + 30 * 86400,
        },
      },
      payment: { entity: { id: `pay_e2e_${run}`, amount: 799900, currency: 'INR' } },
    },
  };
}

beforeAll(async () => {
  ({ prisma } = await import('./helpers.js'));
  billing = await import('../src/services/billing/billingService.js');

  const plan = await prisma.plan.create({
    data: { code: `E2E_${run}`, name: 'E2E Test Plan', maxUsers: 5, isActive: true },
  });
  planId = plan.id;
  const tenant = await prisma.tenant.create({
    data: { name: `E2E Billing ${run}`, slug: `e2e-billing-${run}`, status: 'PENDING', planId },
  });
  tenantId = tenant.id;
  await prisma.subscription.create({
    data: { tenantId, planId, status: 'CREATED', razorpaySubscriptionId: RZP_SUB_ID },
  });
});

afterAll(async () => {
  // Self-clean everything this test created.
  await prisma.paymentEvent.deleteMany({ where: { tenantId } });
  await prisma.invoice.deleteMany({ where: { tenantId } });
  await prisma.subscription.deleteMany({ where: { tenantId } });
  await prisma.usageCounter.deleteMany({ where: { tenantId } });
  await prisma.$executeRawUnsafe(`DELETE FROM "Sector" WHERE "tenantId" = '${tenantId}'`);
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
  await prisma.plan.delete({ where: { id: planId } }).catch(() => {});
  await prisma.$disconnect();
});

describe('billing webhook state machine (stubbed provider, real DB)', () => {
  it('subscription.activated → subscription ACTIVE + tenant activated + defaults seeded', async () => {
    await billing.processWebhookEvent(`evt_act_${run}`, 'subscription.activated', subEvent('subscription.activated'));
    const sub = await prisma.subscription.findUnique({ where: { tenantId } });
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    expect(sub.status).toBe('ACTIVE');
    expect(sub.currentPeriodStart).toBeTruthy();
    expect(tenant.status).toBe('ACTIVE');
    const sector = await prisma.sector.findFirst({ where: { tenantId } });
    expect(sector).toBeTruthy();
  });

  it('is idempotent: replaying the same event id changes nothing and does not throw', async () => {
    const before = await prisma.paymentEvent.count({ where: { tenantId } });
    await billing.processWebhookEvent(`evt_act_${run}`, 'subscription.activated', subEvent('subscription.activated'));
    const after = await prisma.paymentEvent.count({ where: { tenantId } });
    expect(after).toBe(before);
  });

  it('subscription.charged → period rolls forward and an invoice is mirrored', async () => {
    const newStart = Math.floor(Date.now() / 1000) + 30 * 86400;
    await billing.processWebhookEvent(
      `evt_chg_${run}`,
      'subscription.charged',
      subEvent('subscription.charged', { start: newStart, end: newStart + 30 * 86400 }),
    );
    const sub = await prisma.subscription.findUnique({ where: { tenantId } });
    expect(sub.status).toBe('ACTIVE');
    expect(Math.floor(sub.currentPeriodStart.getTime() / 1000)).toBe(newStart);
    const invoice = await prisma.invoice.findFirst({ where: { tenantId } });
    expect(invoice).toBeTruthy();
    expect(Number(invoice.amount)).toBe(7999); // paise → rupees
    expect(invoice.status).toBe('PAID');
  });

  it('subscription.pending → PAST_DUE (soft block)', async () => {
    await billing.processWebhookEvent(`evt_pen_${run}`, 'subscription.pending', subEvent('subscription.pending'));
    const sub = await prisma.subscription.findUnique({ where: { tenantId } });
    expect(sub.status).toBe('PAST_DUE');
  });

  it('subscription.halted → HALTED + tenant SUSPENDED', async () => {
    await billing.processWebhookEvent(`evt_hlt_${run}`, 'subscription.halted', subEvent('subscription.halted'));
    const sub = await prisma.subscription.findUnique({ where: { tenantId } });
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    expect(sub.status).toBe('HALTED');
    expect(tenant.status).toBe('SUSPENDED');
  });

  it('HALTED blocks quota-gated writes with a typed 402', async () => {
    const { assertWithinLimit } = await import('../src/services/entitlementService.js');
    await expect(assertWithinLimit(tenantId, 'USERS', 1)).rejects.toMatchObject({
      statusCode: 402,
      code: 'SUBSCRIPTION_INACTIVE',
    });
  });

  it('subscription.cancelled → CANCELLED + tenant CANCELLED', async () => {
    await billing.processWebhookEvent(`evt_cxl_${run}`, 'subscription.cancelled', subEvent('subscription.cancelled'));
    const sub = await prisma.subscription.findUnique({ where: { tenantId } });
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    expect(sub.status).toBe('CANCELLED');
    expect(tenant.status).toBe('CANCELLED');
  });

  it('unmapped events are recorded and skipped, not crashed on', async () => {
    await billing.processWebhookEvent(
      `evt_unknown_${run}`,
      'subscription.activated',
      { event: 'subscription.activated', payload: { subscription: { entity: { id: 'sub_does_not_exist' } } } },
    );
    const evt = await prisma.paymentEvent.findUnique({ where: { eventId: `evt_unknown_${run}` } });
    expect(evt.status).toBe('SKIPPED');
    await prisma.paymentEvent.delete({ where: { eventId: `evt_unknown_${run}` } });
  });
});
