import { prisma } from '../../config/database.js';
import { runAsPlatform, runWithTenant } from '../../config/tenantContext.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { ROLES } from '@agnohire/shared';
import { BadRequestError, NotFoundError } from '../../utils/errors.js';
import { razorpayProvider, type PaymentProvider } from './razorpayProvider.js';
import { rolloverPeriod, getEntitlements, priceFor, getEffectiveLimit, extraFor } from '../entitlementService.js';
import { activateTenant } from '../tenantProvisioningService.js';
import type {
  CheckoutBootstrap,
  SubscriptionSummary,
  BillingInterval,
  BillableMetric,
  TenantAddonPurchaseItem,
  PendingAddonChangeItem,
  RecurringAddonSummary,
} from '@agnohire/shared';

const BILLABLE_METRICS: BillableMetric[] = ['ORGANIZATIONS', 'WORKSPACES', 'USERS', 'CANDIDATES'];

/** Injectable for tests; production uses the real Razorpay provider. */
let provider: PaymentProvider = razorpayProvider;
export function setPaymentProvider(p: PaymentProvider): void {
  provider = p;
}

function requireBillingEnabled(): void {
  if (!env.razorpay.enabled) {
    throw new BadRequestError('Billing is not configured on this deployment (RAZORPAY_KEY_ID/SECRET missing)');
  }
}

export async function createSubscriptionForTenant(
  tenantId: string,
  planId: string,
  interval: BillingInterval,
): Promise<CheckoutBootstrap> {
  requireBillingEnabled();
  return runAsPlatform(async () => {
    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundError('Plan not found');
    const razorpayPlanId = interval === 'yearly' ? plan.razorpayPlanIdYearly : plan.razorpayPlanIdMonthly;
    if (!razorpayPlanId) {
      throw new BadRequestError(`Plan ${plan.code} has no Razorpay plan mapped for ${interval} billing. Run the plan bootstrap script.`);
    }

    const providerSub = await provider.createSubscription({
      razorpayPlanId,
      // monthly → 12 cycles commitment window; yearly → 1 cycle (renewed by webhook).
      totalCount: interval === 'yearly' ? 1 : 12,
      notes: { tenantId, planCode: plan.code },
    });

    const sub = await prisma.subscription.upsert({
      where: { tenantId },
      create: {
        tenantId,
        planId: plan.id,
        status: 'CREATED',
        billingInterval: interval,
        razorpaySubscriptionId: providerSub.id,
        shortUrl: providerSub.shortUrl,
      },
      update: {
        planId: plan.id,
        status: 'CREATED',
        billingInterval: interval,
        razorpaySubscriptionId: providerSub.id,
        shortUrl: providerSub.shortUrl,
        // A fresh Razorpay subscription object was just created — any scheduled
        // cancellation belonged to the OLD one (e.g. a resumeSubscription() call
        // replacing a subscription that was set to cancel at period end).
        cancelAtPeriodEnd: false,
      },
    });

    return {
      tenantId,
      subscriptionId: sub.id,
      razorpaySubscriptionId: providerSub.id,
      shortUrl: providerSub.shortUrl,
      keyId: env.razorpay.keyId,
    };
  });
}

/**
 * POST /api/billing/verify — verifies the Checkout success signature. Marks
 * the local subscription PENDING (authenticated). Access is NOT granted here;
 * the webhook (subscription.activated/charged) is authoritative.
 */
export async function verifyCheckout(
  paymentId: string,
  subscriptionId: string,
  signature: string,
): Promise<{ state: string }> {
  requireBillingEnabled();
  const valid = provider.verifyCheckoutSignature(paymentId, subscriptionId, signature);
  if (!valid) throw new BadRequestError('Invalid checkout signature');
  await runAsPlatform(async () => {
    await prisma.subscription.updateMany({
      where: { razorpaySubscriptionId: subscriptionId, status: { in: ['CREATED', 'PENDING'] } },
      data: { status: 'PENDING' },
    });
  });
  return { state: 'processing' };
}

/**
 * Dunning / lifecycle notifications: email the tenant owner and drop an in-app
 * notification on billing state changes. Best-effort — a notification failure
 * never blocks the webhook state transition.
 */
async function notifyTenantOwner(tenantId: string, title: string, message: string): Promise<void> {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { ownerUserId: true, name: true },
    });
    if (!tenant?.ownerUserId) return;
    const owner = await prisma.user.findUnique({
      where: { id: tenant.ownerUserId },
      select: { id: true, email: true },
    });
    if (!owner) return;

    const { notify } = await import('../notificationService.js');
    await notify({
      recipientId: owner.id,
      type: 'BILLING',
      title,
      message,
      entityType: 'Subscription',
      entityId: tenantId,
    });

    const { sendMail } = await import('../mailerService.js');
    // Sent under this tenant's own context, not the platform bypass the
    // webhook handler runs in, so it resolves that tenant's SMTP override
    // rather than always falling back to the platform default.
    await runWithTenant(tenantId, () =>
      sendMail({
        to: owner.email,
        subject: `[AgnoHire] ${title}`,
        html: `<p>${message}</p><p>Workspace: <strong>${tenant.name}</strong></p><p>Manage your subscription from Admin → Billing &amp; Plan.</p>`,
        templateId: 'billing-dunning',
        entityType: 'Subscription',
        entityId: tenantId,
      }),
    );
  } catch (err) {
    logger.warn('Billing notification failed (non-fatal)', { tenantId, err: (err as Error).message });
  }
}

/**
 * Notifies EVERY admin-tier user (ADMIN + TENANT_OWNER) under a tenant — not
 * just the owner. Unlike notifyTenantOwner's notify() call, this queries the
 * recipient list directly rather than relying on notify()'s tenantId-based
 * admin fan-out, which never fires here: this whole webhook/reminder path
 * runs under runAsPlatform (bypass), so the Notification row's own tenantId
 * would come back null and silently skip that fan-out.
 *
 * `dedupeKey` (entityId) makes the email idempotent per-cycle via
 * sendMailOnce — safe to call this more than once for the same renewal
 * (retry, duplicate dispatch) without spamming multiple emails.
 */
export async function notifyAllTenantAdmins(
  tenantId: string,
  title: string,
  message: string,
  dedupeKey: string,
): Promise<void> {
  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
    if (!tenant) return;
    const admins = await prisma.user.findMany({
      where: {
        tenantId,
        deletedAt: null,
        isActive: true,
        role: { name: { in: [ROLES.ADMIN, ROLES.TENANT_OWNER] } },
      },
      select: { id: true, email: true },
    });
    if (admins.length === 0) return;

    const { notify } = await import('../notificationService.js');
    await Promise.all(
      admins.map((admin) =>
        notify({
          recipientId: admin.id,
          type: 'BILLING',
          title,
          message,
          entityType: 'Subscription',
          entityId: tenantId,
        }),
      ),
    );

    const { sendMailOnce } = await import('../mailerService.js');
    // Sent under this tenant's own context (not the platform bypass this
    // whole path runs in) so it resolves that tenant's SMTP override.
    await runWithTenant(tenantId, () =>
      Promise.all(
        admins.map((admin) =>
          sendMailOnce({
            to: admin.email,
            subject: `[AgnoHire] ${title}`,
            html: `<p>${message}</p><p>Workspace: <strong>${tenant.name}</strong></p><p>Manage this from Admin → Billing &amp; Plan.</p>`,
            templateId: 'billing-renewal-reminder',
            entityType: 'Subscription',
            entityId: dedupeKey,
          }),
        ),
      ),
    );
  } catch (err) {
    logger.warn('Billing admin notification failed (non-fatal)', { tenantId, err: (err as Error).message });
  }
}

const RENEWAL_REMINDER_LEAD_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

/**
 * Schedules (or re-schedules, replacing any prior one — see
 * dispatchBillingRenewalReminder's deterministic jobId) the pre-renewal
 * reminder for 5 days before `periodEnd`. No-op if there's no period end
 * (e.g. a FREE-plan subscription with no Razorpay cycle) — best-effort, a
 * dispatch failure never blocks the webhook's own state transition.
 */
async function scheduleRenewalReminder(tenantId: string, periodEnd: Date | null): Promise<void> {
  if (!periodEnd) return;
  try {
    const { dispatchBillingRenewalReminder } = await import('../../jobs/dispatch.js');
    await dispatchBillingRenewalReminder(tenantId, new Date(periodEnd.getTime() - RENEWAL_REMINDER_LEAD_MS));
  } catch (err) {
    logger.warn('Failed to schedule renewal reminder (non-fatal)', { tenantId, err: (err as Error).message });
  }
}

/** Map a webhook event to its tenant via notes.tenantId or the subscription id. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveTenantId(payload: any): Promise<string | null> {
  const subEntity = payload?.payload?.subscription?.entity;
  const notesTenant = subEntity?.notes?.tenantId;
  if (notesTenant) return notesTenant;
  const rzpSubId = subEntity?.id;
  if (rzpSubId) {
    const sub = await prisma.subscription.findUnique({
      where: { razorpaySubscriptionId: rzpSubId },
      select: { tenantId: true },
    });
    if (sub?.tenantId) return sub.tenantId;
  }
  // Prorated add-on Payment Links carry tenantId in their own notes — they
  // have no `subscription` entity in their webhook payload at all.
  const linkTenant = payload?.payload?.payment_link?.entity?.notes?.tenantId;
  if (linkTenant) return linkTenant;
  return null;
}

/**
 * Webhook processor — idempotent (PaymentEvent.eventId unique). Called with a
 * signature-verified, parsed event. State transitions per the documented
 * Subscription state machine.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function processWebhookEvent(eventId: string, eventType: string, payload: any): Promise<void> {
  await runAsPlatform(async () => {
    // Idempotency: first insert wins; duplicates (Razorpay retries) are skipped.
    try {
      await prisma.paymentEvent.create({
        data: { eventId, eventType, payloadJson: payload, signatureValid: true },
      });
    } catch {
      logger.info('Duplicate webhook event skipped', { eventId, eventType });
      return;
    }

    const tenantId = await resolveTenantId(payload);
    if (!tenantId) {
      await prisma.paymentEvent.update({ where: { eventId }, data: { status: 'SKIPPED', processedAt: new Date() } });
      logger.warn('Webhook event could not be mapped to a tenant', { eventId, eventType });
      return;
    }

    const subEntity = payload?.payload?.subscription?.entity;
    const periodStart = subEntity?.current_start ? new Date(subEntity.current_start * 1000) : new Date();
    const periodEnd = subEntity?.current_end ? new Date(subEntity.current_end * 1000) : null;

    const setStatus = (status: string) =>
      prisma.subscription.update({ where: { tenantId }, data: { status } });

    switch (eventType) {
      case 'subscription.authenticated':
        await setStatus('PENDING');
        break;

      case 'subscription.activated': {
        await prisma.subscription.update({
          where: { tenantId },
          data: { status: 'ACTIVE', currentPeriodStart: periodStart, currentPeriodEnd: periodEnd },
        });
        await activateTenant(tenantId);
        await scheduleRenewalReminder(tenantId, periodEnd);
        break;
      }

      case 'subscription.charged': {
        // Renewal: advance the period (usage counters roll over via period key).
        await prisma.subscription.update({ where: { tenantId }, data: { status: 'ACTIVE' } });
        await rolloverPeriod(tenantId, periodStart, periodEnd);
        await activateTenant(tenantId);
        await scheduleRenewalReminder(tenantId, periodEnd);
        const paymentEntity = payload?.payload?.payment?.entity;
        await prisma.invoice.create({
          data: {
            tenantId,
            razorpayPaymentId: paymentEntity?.id ?? null,
            amount: paymentEntity?.amount != null ? paymentEntity.amount / 100 : null,
            currency: paymentEntity?.currency ?? 'INR',
            status: 'PAID',
            periodStart,
            periodEnd,
            paidAt: new Date(),
          },
        });
        await notifyTenantOwner(
          tenantId,
          'Payment received — subscription renewed',
          'Your subscription payment was received and the new billing period has started. Usage counters have been reset.',
        );
        break;
      }

      case 'subscription.pending':
        await setStatus('PAST_DUE');
        await notifyTenantOwner(
          tenantId,
          'Payment retry pending',
          'Your latest subscription payment did not go through. Razorpay will retry automatically — please make sure your payment method is up to date to avoid interruption.',
        );
        break;

      case 'subscription.halted':
        await setStatus('HALTED');
        await prisma.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED' } });
        await notifyTenantOwner(
          tenantId,
          'Subscription halted — workspace suspended',
          'Payment retries were exhausted and your subscription is halted. Your workspace is suspended (read-only) until payment is updated and the subscription resumes.',
        );
        break;

      case 'subscription.cancelled':
      case 'subscription.completed':
        await setStatus('CANCELLED');
        await prisma.tenant.update({ where: { id: tenantId }, data: { status: 'CANCELLED' } });
        await notifyTenantOwner(
          tenantId,
          'Subscription cancelled',
          'Your subscription has been cancelled. Your data is retained; reactivate any time by choosing a plan from the billing page.',
        );
        break;

      case 'subscription.updated': {
        const planCode = subEntity?.notes?.planCode;
        if (planCode) {
          const plan = await prisma.plan.findUnique({ where: { code: planCode } });
          if (plan) await prisma.subscription.update({ where: { tenantId }, data: { planId: plan.id } });
        }
        break;
      }

      // Prorated mid-cycle add-on charge (see issueProratedInvoice) — these
      // never touch Subscription/Tenant status, only the originating
      // TenantAddonPurchase row's own payment-link status.
      case 'payment_link.paid': {
        const linkId = payload?.payload?.payment_link?.entity?.id;
        if (linkId) {
          await prisma.tenantAddonPurchase.updateMany({
            where: { razorpayPaymentLinkId: linkId },
            data: { paymentLinkStatus: 'PAID' },
          });
        }
        await notifyTenantOwner(
          tenantId,
          'Add-on payment received',
          'Your prorated payment for mid-cycle add-on capacity was received.',
        );
        break;
      }

      case 'payment_link.expired':
      case 'payment_link.cancelled': {
        const linkId = payload?.payload?.payment_link?.entity?.id;
        if (linkId) {
          await prisma.tenantAddonPurchase.updateMany({
            where: { razorpayPaymentLinkId: linkId },
            data: { paymentLinkStatus: eventType === 'payment_link.expired' ? 'EXPIRED' : 'CANCELLED' },
          });
        }
        break;
      }

      default:
        logger.info('Unhandled billing webhook event', { eventType });
    }

    await prisma.paymentEvent.update({
      where: { eventId },
      data: { tenantId, status: 'PROCESSED', processedAt: new Date() },
    });
  });
}

export async function getSubscriptionSummary(tenantId: string): Promise<SubscriptionSummary> {
  return runAsPlatform(async () => {
    const sub = await prisma.subscription.findUnique({
      where: { tenantId },
      include: { plan: true },
    });
    if (!sub) throw new NotFoundError('No subscription for tenant');
    return {
      status: sub.status as SubscriptionSummary['status'],
      billingInterval: sub.billingInterval as SubscriptionSummary['billingInterval'],
      autoPayEnabled: sub.autoPayEnabled,
      autoPayConsentedAt: sub.autoPayConsentedAt?.toISOString() ?? null,
      currentPeriodStart: sub.currentPeriodStart?.toISOString() ?? null,
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      shortUrl: sub.shortUrl,
      plan: {
        code: sub.plan.code as SubscriptionSummary['plan']['code'],
        name: sub.plan.name,
        priceMonthly: sub.plan.priceMonthly ? Number(sub.plan.priceMonthly) : null,
        priceYearly: sub.plan.priceYearly ? Number(sub.plan.priceYearly) : null,
        currency: sub.plan.currency,
        isActive: sub.plan.isActive,
        maxUsers: sub.plan.maxUsers,
        maxInterviewedCandidates: sub.plan.maxInterviewedCandidates,
        maxActiveJobs: sub.plan.maxActiveJobs,
        maxCandidates: sub.plan.maxCandidates,
        maxSchedules: sub.plan.maxSchedules,
        maxOrganizations: sub.plan.maxOrganizations,
        maxWorkspaces: sub.plan.maxWorkspaces,
        storageMb: sub.plan.storageMb,
        pricePerOrganization: sub.plan.pricePerOrganization != null ? Number(sub.plan.pricePerOrganization) : null,
        pricePerWorkspace: sub.plan.pricePerWorkspace != null ? Number(sub.plan.pricePerWorkspace) : null,
        pricePerUser: sub.plan.pricePerUser != null ? Number(sub.plan.pricePerUser) : null,
        pricePerCandidate: sub.plan.pricePerCandidate != null ? Number(sub.plan.pricePerCandidate) : null,
        minOrganizations: sub.plan.minOrganizations,
        minWorkspaces: sub.plan.minWorkspaces,
        minUsers: sub.plan.minUsers,
        minCandidates: sub.plan.minCandidates,
        trialDays: sub.plan.trialDays,
        aiEnabled: sub.plan.aiEnabled,
        proctoringEnabled: sub.plan.proctoringEnabled,
        features: Array.isArray(sub.plan.featuresJson) ? (sub.plan.featuresJson as string[]) : [],
      },
    };
  });
}

/** Change plan: cancel-and-create (portable across Razorpay plan transitions). */
export async function changePlan(
  tenantId: string,
  planCode: string,
  interval?: BillingInterval,
): Promise<CheckoutBootstrap | { changed: true }> {
  return runAsPlatform(async () => {
    const plan = await prisma.plan.findUnique({ where: { code: planCode } });
    if (!plan || !plan.isActive) throw new BadRequestError('Unknown or inactive plan');
    const sub = await prisma.subscription.findUnique({ where: { tenantId } });
    if (!sub) throw new NotFoundError('No subscription for tenant');
    const nextInterval = interval ?? (sub.billingInterval as BillingInterval);

    if (plan.code === 'FREE') {
      if (sub.razorpaySubscriptionId) {
        await provider.cancelSubscription(sub.razorpaySubscriptionId, false).catch((err) =>
          logger.warn('Provider cancel failed during downgrade', { err: (err as Error).message }),
        );
      }
      await prisma.subscription.update({
        where: { tenantId },
        data: {
          planId: plan.id,
          status: 'ACTIVE',
          provider: 'internal',
          razorpaySubscriptionId: null,
          shortUrl: null,
          currentPeriodStart: new Date(),
          currentPeriodEnd: null,
        },
      });
      await prisma.tenant.update({ where: { id: tenantId }, data: { planId: plan.id, status: 'ACTIVE' } });
      return { changed: true };
    }

    // Paid target: cancel existing provider sub (immediate) and create a new
    // one — activation again arrives via webhook.
    if (sub.razorpaySubscriptionId) {
      await provider.cancelSubscription(sub.razorpaySubscriptionId, false).catch((err) =>
        logger.warn('Provider cancel failed during plan change', { err: (err as Error).message }),
      );
    }
    await prisma.tenant.update({ where: { id: tenantId }, data: { planId: plan.id } });
    return createSubscriptionForTenant(tenantId, plan.id, nextInterval);
  });
}

export async function cancelSubscription(tenantId: string, atPeriodEnd: boolean): Promise<void> {
  await runAsPlatform(async () => {
    const sub = await prisma.subscription.findUnique({ where: { tenantId } });
    if (!sub) throw new NotFoundError('No subscription for tenant');
    if (sub.razorpaySubscriptionId) {
      requireBillingEnabled();
      await provider.cancelSubscription(sub.razorpaySubscriptionId, atPeriodEnd);
    }
    await prisma.subscription.update({
      where: { tenantId },
      data: atPeriodEnd ? { cancelAtPeriodEnd: true } : { status: 'CANCELLED', cancelAtPeriodEnd: false },
    });
    if (!atPeriodEnd) {
      await prisma.tenant.update({ where: { id: tenantId }, data: { status: 'CANCELLED' } });
    }
  });
}

/**
 * Reverts a scheduled ("cancel at period end") cancellation. Razorpay's API
 * has no endpoint to undo `cancel_at_cycle_end` once set (their "Cancel an
 * Update" endpoint only reverts a pending plan/offer change, not a pending
 * cancellation) — the only reliable fix is to replace the doomed subscription
 * with a fresh one on the same plan/interval, exactly like changePlan() does
 * for a plan change. The tenant must complete Razorpay checkout again, and
 * their billing cycle restarts from today.
 */
export async function resumeSubscription(tenantId: string): Promise<CheckoutBootstrap> {
  return runAsPlatform(async () => {
    const sub = await prisma.subscription.findUnique({ where: { tenantId }, include: { plan: true } });
    if (!sub) throw new NotFoundError('No subscription for tenant');
    if (sub.status !== 'ACTIVE' || !sub.cancelAtPeriodEnd) {
      throw new BadRequestError('Subscription is not currently scheduled to cancel at period end');
    }
    const result = await changePlan(tenantId, sub.plan.code, sub.billingInterval as BillingInterval);
    if (!('razorpaySubscriptionId' in result)) {
      // Only reachable if the current plan is FREE, which can never have
      // cancelAtPeriodEnd set in the first place (FREE has no Razorpay sub).
      throw new BadRequestError('Nothing to resume');
    }
    return result;
  });
}

export async function listInvoices(tenantId: string) {
  return runAsPlatform(async () => await prisma.invoice.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 50 }));
}

/** Builds the one Tenant.extraX field to increment for a given metric, guaranteed to type-check per case. */
function extraCapacityUpdate(metric: BillableMetric, quantity: number) {
  switch (metric) {
    case 'ORGANIZATIONS':
      return { extraOrganizations: { increment: quantity } };
    case 'WORKSPACES':
      return { extraWorkspaces: { increment: quantity } };
    case 'USERS':
      return { extraUsers: { increment: quantity } };
    case 'CANDIDATES':
      return { extraCandidates: { increment: quantity } };
  }
}

/**
 * Tenant self-service: buy `quantity` more of `metric`, raising this
 * tenant's own effective limit (Tenant.extraX) without touching the shared
 * Plan row — no other tenant on the same plan is affected. Reuses the
 * plan's existing per-unit overage price (pricePerX); only offered at all
 * when that's configured (see entitlementService.priceFor).
 *
 * This is a CAPACITY change, not a charging event: it doesn't itself create
 * a Razorpay charge. The recurring monthly cost of the resulting extraX is
 * computed fresh every cycle (see getRecurringAddonCharge) and, only if the
 * tenant has explicitly enabled autoPay, attached to their next Razorpay
 * invoice by the pre-renewal reminder job (see attachRecurringAddonCharge/
 * sendRenewalReminder) — never immediately here.
 */
/**
 * Fraction of the current billing cycle still remaining, as of `now` — null
 * if there's no cycle to prorate against (no period on record, or a
 * zero/negative-length period). 1.0 = the full cycle remains; 0 means the
 * cycle has already ended (nothing left to prorate).
 */
function prorationFactor(periodStart: Date | null | undefined, periodEnd: Date | null | undefined, now: Date): number | null {
  if (!periodStart || !periodEnd) return null;
  const totalMs = periodEnd.getTime() - periodStart.getTime();
  if (totalMs <= 0) return null;
  const remainingMs = periodEnd.getTime() - now.getTime();
  if (remainingMs <= 0) return null;
  return Math.min(1, remainingMs / totalMs);
}

/**
 * Immediate charge for a mid-cycle add-on increase, covering only the
 * remaining portion of the CURRENT cycle — only issued when the tenant has
 * auto-pay enabled (same consent gate as the recurring add-on mechanism; a
 * tenant without it just gets the capacity now and the full charge at next
 * renewal, as before). Razorpay's subscription-addon API only ever attaches
 * to the customer's NEXT invoice, so a genuinely immediate charge instead
 * uses a standalone Payment Link the customer opens and confirms themselves
 * — this never auto-debits a saved card. Never blocks the underlying
 * capacity increase: a Razorpay failure here is logged and left as a
 * missing proration (the purchase row simply has no payment link), not a
 * thrown error.
 */
async function issueProratedInvoice(
  tenantId: string,
  purchaseId: string,
  metric: BillableMetric,
  unitPrice: number,
  quantity: number,
  currency: string,
): Promise<{ amount: number; shortUrl: string } | null> {
  const sub = await prisma.subscription.findUnique({ where: { tenantId } });
  if (!sub?.autoPayEnabled || !sub.razorpaySubscriptionId) return null;

  const factor = prorationFactor(sub.currentPeriodStart, sub.currentPeriodEnd, new Date());
  if (!factor) return null;
  const amount = Math.round(unitPrice * quantity * factor * 100) / 100;
  if (amount <= 0) return null;

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { ownerUserId: true } });
  const owner = tenant?.ownerUserId
    ? await prisma.user.findUnique({ where: { id: tenant.ownerUserId }, select: { fullName: true, email: true } })
    : null;
  if (!owner) return null;

  try {
    requireBillingEnabled();
    const link = await provider.createPaymentLink({
      amount,
      currency,
      description: `Prorated charge — ${quantity} extra ${metric.toLowerCase()} added mid-cycle`,
      customerName: owner.fullName,
      customerEmail: owner.email,
      notes: { tenantId, purchaseId, metric },
    });
    await prisma.tenantAddonPurchase.update({
      where: { id: purchaseId },
      data: {
        prorationAmount: amount,
        razorpayPaymentLinkId: link.id,
        paymentLinkShortUrl: link.shortUrl,
        paymentLinkStatus: 'PENDING',
      },
    });
    return { amount, shortUrl: link.shortUrl };
  } catch (err) {
    logger.warn('Prorated add-on payment link creation failed', { tenantId, purchaseId, err: (err as Error).message });
    return null;
  }
}

export async function purchaseAddonCapacity(
  tenantId: string,
  metric: BillableMetric,
  quantity: number,
): Promise<{
  metric: BillableMetric;
  quantity: number;
  unitPrice: number;
  amount: number;
  currency: string;
  newEffectiveLimit: number | null;
  prorationAmount: number | null;
  paymentLinkUrl: string | null;
}> {
  return runAsPlatform(async () => {
    const ent = await getEntitlements(tenantId);
    const unitPrice = priceFor(ent.limits, metric);
    if (unitPrice == null) {
      throw new BadRequestError(
        `This plan does not offer add-on ${metric.toLowerCase()} capacity — a superadmin must configure a per-unit price for it on Billing & Plans first.`,
      );
    }
    const amount = unitPrice * quantity;
    await prisma.tenant.update({ where: { id: tenantId }, data: extraCapacityUpdate(metric, quantity) });
    const purchase = await prisma.tenantAddonPurchase.create({
      data: { tenantId, metric, quantity, unitPrice, amount, currency: ent.currency },
    });
    const newEffectiveLimit = await getEffectiveLimit(tenantId, metric);

    // Immediate capacity, immediate bill for the remainder of this cycle
    // (auto-pay tenants only) — the next renewal still charges the full
    // per-unit price via attachRecurringAddonCharge, no proration there.
    const proration = await issueProratedInvoice(tenantId, purchase.id, metric, unitPrice, quantity, ent.currency);

    return {
      metric,
      quantity,
      unitPrice,
      amount,
      currency: ent.currency,
      newEffectiveLimit,
      prorationAmount: proration?.amount ?? null,
      paymentLinkUrl: proration?.shortUrl ?? null,
    };
  });
}

export async function listAddonPurchases(tenantId: string): Promise<TenantAddonPurchaseItem[]> {
  return runAsPlatform(async () => {
    const rows = await prisma.tenantAddonPurchase.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((r) => ({
      id: r.id,
      metric: r.metric as BillableMetric,
      quantity: r.quantity,
      unitPrice: Number(r.unitPrice),
      amount: Number(r.amount),
      currency: r.currency,
      createdAt: r.createdAt.toISOString(),
      prorationAmount: r.prorationAmount != null ? Number(r.prorationAmount) : null,
      paymentLinkUrl: r.paymentLinkShortUrl,
      paymentLinkStatus: r.paymentLinkStatus as TenantAddonPurchaseItem['paymentLinkStatus'],
    }));
  });
}

/**
 * This cycle's recurring add-on charge: Tenant.extraX × the plan's CURRENT
 * pricePerX, per metric, summed. Recomputed fresh every time (not locked in
 * at purchase time) — if a superadmin changes the plan's pricing, the very
 * next cycle bills at the new rate, same as everything else in this system.
 * Separate from getOverageCharges, which is usage beyond even this raised
 * (plan + extra) ceiling.
 */
export async function getRecurringAddonCharge(tenantId: string): Promise<RecurringAddonSummary> {
  const ent = await getEntitlements(tenantId);
  const breakdown = BILLABLE_METRICS.map((metric) => {
    const extraUnits = extraFor(ent.extra, metric);
    const unitPrice = priceFor(ent.limits, metric);
    return { metric, extraUnits, unitPrice: unitPrice ?? 0, amount: extraUnits * (unitPrice ?? 0) };
  }).filter((b) => b.extraUnits > 0);
  return { breakdown, total: breakdown.reduce((sum, b) => sum + b.amount, 0), currency: ent.currency };
}

/** Reads Tenant.extraX for one metric directly off a loaded Tenant row. */
function tenantExtraFor(tenant: { extraOrganizations: number; extraWorkspaces: number; extraUsers: number; extraCandidates: number }, metric: BillableMetric): number {
  switch (metric) {
    case 'ORGANIZATIONS':
      return tenant.extraOrganizations;
    case 'WORKSPACES':
      return tenant.extraWorkspaces;
    case 'USERS':
      return tenant.extraUsers;
    case 'CANDIDATES':
      return tenant.extraCandidates;
  }
}

export async function getPendingAddonChanges(tenantId: string): Promise<PendingAddonChangeItem[]> {
  return runAsPlatform(async () => {
    const [rows, sub] = await Promise.all([
      prisma.tenantAddonPendingChange.findMany({ where: { tenantId, status: 'PENDING' }, orderBy: { createdAt: 'desc' } }),
      prisma.subscription.findUnique({ where: { tenantId }, select: { currentPeriodEnd: true } }),
    ]);
    return rows.map((r) => ({
      id: r.id,
      metric: r.metric as BillableMetric,
      delta: r.delta,
      effectiveAt: sub?.currentPeriodEnd?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  });
}

/**
 * Tenant self-service: schedule removing `quantity` add-on units of
 * `metric`, effective at the NEXT renewal — never immediate. The tenant
 * already paid for this cycle's higher capacity, so they keep it (and keep
 * being billed the recurring amount for it) through the end of the current
 * cycle; only the cycle AFTER that reflects the lower count. Applied by
 * entitlementService.applyPendingAddonChanges at rollover.
 */
export async function scheduleAddonDecrease(
  tenantId: string,
  metric: BillableMetric,
  quantity: number,
): Promise<PendingAddonChangeItem> {
  return runAsPlatform(async () => {
    const [tenant, sub, alreadyPending] = await Promise.all([
      prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
      prisma.subscription.findUnique({ where: { tenantId }, select: { currentPeriodEnd: true } }),
      prisma.tenantAddonPendingChange.findMany({ where: { tenantId, metric, status: 'PENDING' } }),
    ]);
    const current = tenantExtraFor(tenant, metric);
    const pendingTotal = alreadyPending.reduce((sum, p) => sum + Math.abs(p.delta), 0);
    const available = current - pendingTotal;
    if (quantity > available) {
      throw new BadRequestError(
        `You only have ${available} add-on ${metric.toLowerCase()} available to remove (some may already be scheduled for removal next cycle).`,
      );
    }
    const change = await prisma.tenantAddonPendingChange.create({
      data: { tenantId, metric, delta: -quantity },
    });
    return {
      id: change.id,
      metric,
      delta: change.delta,
      effectiveAt: sub?.currentPeriodEnd?.toISOString() ?? null,
      createdAt: change.createdAt.toISOString(),
    };
  });
}

/** Tenant self-service: undo a scheduled decrease before it takes effect. */
export async function cancelPendingAddonChange(tenantId: string, id: string): Promise<void> {
  await runAsPlatform(async () => {
    const change = await prisma.tenantAddonPendingChange.findFirst({ where: { id, tenantId, status: 'PENDING' } });
    if (!change) throw new NotFoundError('No pending add-on change found');
    await prisma.tenantAddonPendingChange.update({ where: { id }, data: { status: 'CANCELLED' } });
  });
}

/**
 * Tenant admin/owner explicit opt-in/out for auto-collecting the recurring
 * add-on/overage amount via Razorpay. OFF by default (see schema comment on
 * Subscription.autoPayEnabled) — enabling it requires an ACTIVE Razorpay
 * mandate to already exist (set up once at Checkout); this never collects
 * or stores card/payment details itself, only flips whether the existing
 * mandate is used to also cover the variable recurring amount.
 */
export async function setAutoPay(tenantId: string, enabled: boolean): Promise<{ autoPayEnabled: boolean; autoPayConsentedAt: string | null }> {
  return runAsPlatform(async () => {
    const sub = await prisma.subscription.findUnique({ where: { tenantId } });
    if (!sub) throw new NotFoundError('No subscription for tenant');
    if (enabled && !sub.razorpaySubscriptionId) {
      throw new BadRequestError('Auto-pay requires an active paid subscription with a Razorpay mandate — switch off the Free plan first.');
    }
    const updated = await prisma.subscription.update({
      where: { tenantId },
      data: enabled ? { autoPayEnabled: true, autoPayConsentedAt: new Date() } : { autoPayEnabled: false },
    });
    return { autoPayEnabled: updated.autoPayEnabled, autoPayConsentedAt: updated.autoPayConsentedAt?.toISOString() ?? null };
  });
}

/**
 * Attaches this cycle's recurring add-on/overage amount to the tenant's
 * Razorpay subscription as a one-time addon on the NEXT invoice — Razorpay's
 * own documented mechanism for a variable recurring charge (see
 * razorpayProvider.createAddon's doc comment). Only ever called when the
 * tenant has explicitly enabled autoPay (checked by the caller,
 * sendRenewalReminder) — this function itself does not re-check that, since
 * it's also the natural place a future "retry a failed attach" action would
 * call from regardless of the toggle's current state.
 *
 * Idempotent per cycle via RecurringAddonCharge's unique [tenantId, periodEnd]
 * — a retry or duplicate dispatch for the same cycle is a silent no-op, never
 * double-charges. Failures are recorded, not thrown — a Razorpay outage must
 * not crash the reminder job or block the tenant's OWN flat-rate renewal,
 * which Razorpay drives independently.
 */
export async function attachRecurringAddonCharge(tenantId: string): Promise<void> {
  await runAsPlatform(async () => {
    const sub = await prisma.subscription.findUnique({ where: { tenantId } });
    if (!sub?.razorpaySubscriptionId || !sub.currentPeriodEnd) return;

    const existing = await prisma.recurringAddonCharge.findUnique({
      where: { tenantId_periodEnd: { tenantId, periodEnd: sub.currentPeriodEnd } },
    });
    if (existing) return;

    const [addon, overage] = await Promise.all([
      getRecurringAddonCharge(tenantId),
      import('../entitlementService.js').then((m) => m.getOverageCharges(tenantId)),
    ]);
    const amount = addon.total + overage.total;
    if (amount <= 0) return;

    try {
      const providerAddon = await provider.createAddon({
        razorpaySubscriptionId: sub.razorpaySubscriptionId,
        name: 'Add-on capacity & usage overage',
        amount,
        currency: addon.currency,
      });
      await prisma.recurringAddonCharge.create({
        data: {
          tenantId,
          periodEnd: sub.currentPeriodEnd,
          amount,
          currency: addon.currency,
          razorpayAddonId: providerAddon.id,
          status: 'ATTACHED',
        },
      });
    } catch (err) {
      logger.error('Failed to attach recurring addon charge', { tenantId, err: (err as Error).message });
      await prisma.recurringAddonCharge.create({
        data: {
          tenantId,
          periodEnd: sub.currentPeriodEnd,
          amount,
          currency: addon.currency,
          status: 'FAILED',
          errorMessage: (err as Error).message,
        },
      });
    }
  });
}

/**
 * Pre-renewal reminder — dispatched ~5 days before currentPeriodEnd (see
 * jobs/dispatch.ts's dispatchBillingRenewalReminder, called from the webhook
 * handler on every subscription.activated/subscription.charged). Two
 * independent things happen here, in this order:
 *
 *  1. ALWAYS notify every admin-tier user under the tenant (email + in-app,
 *     see notifyAllTenantAdmins) of the amount that will be added to their
 *     next invoice — computed fresh, live, right now, not a stale snapshot
 *     from when this was scheduled. Skipped only if there's nothing to
 *     charge (amount is 0).
 *  2. ONLY IF the tenant has explicitly enabled autoPay, actually attach
 *     that amount to their Razorpay subscription (see
 *     attachRecurringAddonCharge). If autoPay is off, the amount stays
 *     informational — same as today's overage behavior — and the tenant
 *     must act manually (buy add-ons, or nothing happens automatically).
 *
 * This ordering — notify first, using the same live numbers the attach step
 * would use — plus Razorpay's own mandate-holder pre-debit notifications for
 * registered subscriptions, is the compliance-relevant sequencing: the
 * customer sees the exact amount before it's ever attached to a real charge.
 */
export async function sendRenewalReminder(tenantId: string): Promise<void> {
  await runAsPlatform(async () => {
    const sub = await prisma.subscription.findUnique({ where: { tenantId } });
    if (!sub || !sub.currentPeriodEnd) return;
    if (!['ACTIVE', 'TRIALING', 'PAST_DUE'].includes(sub.status)) return;

    const [addon, overage] = await Promise.all([
      getRecurringAddonCharge(tenantId),
      import('../entitlementService.js').then((m) => m.getOverageCharges(tenantId)),
    ]);
    const total = addon.total + overage.total;
    if (total <= 0) return;

    const renewsOn = sub.currentPeriodEnd.toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
    await notifyAllTenantAdmins(
      tenantId,
      'Upcoming renewal includes add-on/usage charges',
      `Your subscription renews on ${renewsOn} and will include an extra ₹${total.toLocaleString('en-IN')} for add-on capacity and usage beyond your plan. ` +
        (sub.autoPayEnabled
          ? 'This will be collected automatically since auto-pay is enabled for this workspace.'
          : 'Auto-pay is OFF for this workspace, so this amount is not collected automatically — enable it on the Billing page, or it will remain outstanding.'),
      `renewal:${tenantId}:${sub.currentPeriodEnd.toISOString()}`,
    );

    if (sub.autoPayEnabled) {
      await attachRecurringAddonCharge(tenantId);
    }
  });
}
