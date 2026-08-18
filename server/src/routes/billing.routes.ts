import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/rbac.middleware.js';
import {
  ROLES,
  CONFIG_KEYS,
  verifyCheckoutSchema,
  changePlanSchema,
  cancelSubscriptionSchema,
  purchaseAddonSchema,
  decreaseAddonSchema,
  setAutoPaySchema,
} from '@agnohire/shared';
import { env } from '../config/env.js';
import { prisma } from '../config/database.js';
import { runAsPlatform } from '../config/tenantContext.js';
import { ok } from '../utils/response.js';
import { NotFoundError } from '../utils/errors.js';
import { configService } from '../services/configService.js';
import {
  verifyCheckout,
  getSubscriptionSummary,
  changePlan,
  cancelSubscription,
  resumeSubscription,
  listInvoices,
  purchaseAddonCapacity,
  listAddonPurchases,
  getRecurringAddonCharge,
  getPendingAddonChanges,
  scheduleAddonDecrease,
  cancelPendingAddonChange,
  setAutoPay,
} from '../services/billing/billingService.js';
import { getUsage, getOverageCharges } from '../services/entitlementService.js';

const router = Router();

/** Public: safe client bootstrap (key id only — never secrets) + plan catalogue. */
router.get('/config', async (_req, res, next) => {
  try {
    const plans = await runAsPlatform(() =>
      prisma.plan.findMany({
        where: { isActive: true, code: { not: 'LEGACY_ENTERPRISE' } },
        select: {
          code: true,
          name: true,
          priceMonthly: true,
          priceYearly: true,
          currency: true,
          maxUsers: true,
          maxInterviewedCandidates: true,
          maxActiveJobs: true,
          maxCandidates: true,
          maxSchedules: true,
          maxOrganizations: true,
          maxWorkspaces: true,
          storageMb: true,
          pricePerOrganization: true,
          pricePerWorkspace: true,
          pricePerUser: true,
          pricePerCandidate: true,
          aiEnabled: true,
          proctoringEnabled: true,
          featuresJson: true,
          trialDays: true,
        },
        orderBy: { priceMonthly: 'asc' },
      }),
    );
    const defaultTrialDays = await configService.getNumber(CONFIG_KEYS.DEFAULT_TRIAL_DAYS, 14);
    const withFeatures = plans.map(({ featuresJson, trialDays, ...p }) => ({
      ...p,
      trialDays: trialDays ?? defaultTrialDays,
      features: Array.isArray(featuresJson) ? (featuresJson as string[]) : [],
    }));
    return ok(res, { keyId: env.razorpay.keyId, billingEnabled: env.razorpay.enabled, plans: withFeatures });
  } catch (err) {
    next(err);
  }
});

/** Public: Checkout success handler posts payment/subscription id + signature. */
router.post('/verify', async (req, res, next) => {
  try {
    const input = verifyCheckoutSchema.parse(req.body);
    return ok(
      res,
      await verifyCheckout(input.razorpay_payment_id, input.razorpay_subscription_id, input.razorpay_signature),
    );
  } catch (err) {
    next(err);
  }
});

// ── Authenticated management (tenant owner / admin only) ────────────────────
const manage = [authenticate, requireRole(ROLES.ADMIN, ROLES.TENANT_OWNER, ROLES.SUPERADMIN)] as const;

router.get('/subscription', ...manage, async (req, res, next) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) throw new NotFoundError('No tenant on session');
    const [subscription, usage, invoices, overage, addonPurchases, recurringAddon, pendingAddonChanges] = await Promise.all([
      getSubscriptionSummary(tenantId),
      getUsage(tenantId),
      listInvoices(tenantId),
      getOverageCharges(tenantId),
      listAddonPurchases(tenantId),
      getRecurringAddonCharge(tenantId),
      getPendingAddonChanges(tenantId),
    ]);
    return ok(res, { subscription, usage, invoices, overage, addonPurchases, recurringAddon, pendingAddonChanges });
  } catch (err) {
    next(err);
  }
});

/** Tenant self-service: buy add-on capacity for a billable metric (see billingService.purchaseAddonCapacity). */
router.post('/addon', ...manage, async (req, res, next) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) throw new NotFoundError('No tenant on session');
    const { metric, quantity } = purchaseAddonSchema.parse(req.body);
    return ok(res, await purchaseAddonCapacity(tenantId, metric, quantity), 201);
  } catch (err) {
    next(err);
  }
});

/** Tenant self-service: schedule removing add-on capacity, effective next renewal. */
router.post('/addon/decrease', ...manage, async (req, res, next) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) throw new NotFoundError('No tenant on session');
    const { metric, quantity } = decreaseAddonSchema.parse(req.body);
    return ok(res, await scheduleAddonDecrease(tenantId, metric, quantity), 201);
  } catch (err) {
    next(err);
  }
});

/** Tenant self-service: undo a scheduled add-on decrease before it takes effect. */
router.delete('/addon/pending/:id', ...manage, async (req, res, next) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) throw new NotFoundError('No tenant on session');
    await cancelPendingAddonChange(tenantId, req.params.id);
    return ok(res, { cancelled: true });
  } catch (err) {
    next(err);
  }
});

/**
 * Tenant self-service: explicit opt-in/out for auto-collecting the recurring
 * add-on/overage amount via Razorpay each cycle. See
 * billingService.setAutoPay's doc comment for why this requires an existing
 * paid subscription/mandate and never touches payment details directly.
 */
router.post('/auto-pay', ...manage, async (req, res, next) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) throw new NotFoundError('No tenant on session');
    const { enabled } = setAutoPaySchema.parse(req.body);
    return ok(res, await setAutoPay(tenantId, enabled));
  } catch (err) {
    next(err);
  }
});

router.post('/change-plan', ...manage, async (req, res, next) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) throw new NotFoundError('No tenant on session');
    const { planCode, billingInterval } = changePlanSchema.parse(req.body);
    return ok(res, await changePlan(tenantId, planCode, billingInterval));
  } catch (err) {
    next(err);
  }
});

router.post('/cancel', ...manage, async (req, res, next) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) throw new NotFoundError('No tenant on session');
    const { atPeriodEnd } = cancelSubscriptionSchema.parse(req.body);
    await cancelSubscription(tenantId, atPeriodEnd);
    return ok(res, { cancelled: true, atPeriodEnd });
  } catch (err) {
    next(err);
  }
});

router.post('/resume', ...manage, async (req, res, next) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) throw new NotFoundError('No tenant on session');
    return ok(res, await resumeSubscription(tenantId));
  } catch (err) {
    next(err);
  }
});

export default router;
