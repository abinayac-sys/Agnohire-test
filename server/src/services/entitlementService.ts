import { prisma } from '../config/database.js';
import { runAsPlatform } from '../config/tenantContext.js';
import { QuotaExceededError, SubscriptionInactiveError, ForbiddenError, NotFoundError } from '../utils/errors.js';
import type {
  PlanLimits,
  TenantUsage,
  UsageEntry,
  UsageMetric,
  BillableMetric,
  PlanCode,
  SubscriptionStatus,
  OverageCharge,
  OverageSummary,
} from '@agnohire/shared';

/**
 * Central entitlement/quota service. All limit checks happen server-side at
 * the write path — the client only mirrors this state for UX. Billing tables
 * (Tenant/Plan/Subscription/UsageCounter) are NOT tenant-scoped models, but we
 * still wrap in runAsPlatform so calls made inside a request's tenant context
 * can read across the join graph safely.
 */

const ACTIVE_STATUSES = new Set(['ACTIVE', 'TRIALING']);

/** Per-tenant add-on capacity purchased on top of the plan's included maxX — see Tenant.extraX. */
interface ExtraCapacity {
  organizations: number;
  workspaces: number;
  users: number;
  candidates: number;
}

interface Entitlements {
  tenantId: string;
  tenantStatus: string;
  planCode: PlanCode;
  currency: string;
  subscriptionStatus: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date | null;
  limits: PlanLimits;
  extra: ExtraCapacity;
}

export async function getEntitlements(tenantId: string): Promise<Entitlements> {
  return runAsPlatform(async () => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { plan: true, subscription: { include: { plan: true } } },
    });
    if (!tenant) throw new NotFoundError('Tenant not found');
    const plan = tenant.subscription?.plan ?? tenant.plan;
    if (!plan) throw new NotFoundError('Tenant has no plan');
    const sub = tenant.subscription;
    return {
      tenantId,
      tenantStatus: tenant.status,
      planCode: plan.code as PlanCode,
      currency: plan.currency,
      subscriptionStatus: (sub?.status ?? 'ACTIVE') as SubscriptionStatus,
      currentPeriodStart: sub?.currentPeriodStart ?? tenant.createdAt,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      limits: {
        maxUsers: plan.maxUsers,
        maxInterviewedCandidates: plan.maxInterviewedCandidates,
        maxActiveJobs: plan.maxActiveJobs,
        maxCandidates: plan.maxCandidates,
        maxSchedules: plan.maxSchedules,
        maxOrganizations: plan.maxOrganizations,
        maxWorkspaces: plan.maxWorkspaces,
        storageMb: plan.storageMb,
        aiEnabled: plan.aiEnabled,
        proctoringEnabled: plan.proctoringEnabled,
        pricePerOrganization: plan.pricePerOrganization != null ? Number(plan.pricePerOrganization) : null,
        pricePerWorkspace: plan.pricePerWorkspace != null ? Number(plan.pricePerWorkspace) : null,
        pricePerUser: plan.pricePerUser != null ? Number(plan.pricePerUser) : null,
        pricePerCandidate: plan.pricePerCandidate != null ? Number(plan.pricePerCandidate) : null,
        minOrganizations: plan.minOrganizations,
        minWorkspaces: plan.minWorkspaces,
        minUsers: plan.minUsers,
        minCandidates: plan.minCandidates,
        trialDays: plan.trialDays,
      },
      extra: {
        organizations: tenant.extraOrganizations,
        workspaces: tenant.extraWorkspaces,
        users: tenant.extraUsers,
        candidates: tenant.extraCandidates,
      },
    };
  });
}

/** Throws 402 unless the subscription allows writes. */
export async function assertActiveSubscription(tenantId: string): Promise<Entitlements> {
  const ent = await getEntitlements(tenantId);
  // A tenant suspended/cancelled by a platform operator is read-only, even
  // if its subscription row still reads ACTIVE (manual suspend vs billing halt).
  if (ent.tenantStatus === 'SUSPENDED' || ent.tenantStatus === 'CANCELLED') {
    throw new SubscriptionInactiveError(ent.tenantStatus);
  }
  // TRIALING has no billing webhook to flip its status when the trial ends —
  // there's no Razorpay event for "a free trial expired." Check it here, on
  // the write path, and self-heal the row to EXPIRED so it doesn't just sit
  // stale forever (the next read-only request still sees TRIALING with a
  // past currentPeriodEnd until something writes; that's fine, this only
  // needs to be correct by the time it matters — a write attempt).
  if (ent.subscriptionStatus === 'TRIALING' && ent.currentPeriodEnd && ent.currentPeriodEnd.getTime() <= Date.now()) {
    await runAsPlatform(() => prisma.subscription.update({ where: { tenantId }, data: { status: 'EXPIRED' } }));
    throw new SubscriptionInactiveError('EXPIRED');
  }
  if (!ACTIVE_STATUSES.has(ent.subscriptionStatus)) {
    throw new SubscriptionInactiveError(ent.subscriptionStatus);
  }
  return ent;
}

function limitFor(limits: PlanLimits, metric: UsageMetric): number | null {
  switch (metric) {
    case 'USERS':
      return limits.maxUsers;
    case 'INTERVIEWED_CANDIDATES':
      return limits.maxInterviewedCandidates;
    case 'ACTIVE_JOBS':
      return limits.maxActiveJobs;
    case 'CANDIDATES':
      return limits.maxCandidates;
    case 'SCHEDULES':
      return limits.maxSchedules;
    case 'ORGANIZATIONS':
      return limits.maxOrganizations;
    case 'WORKSPACES':
      return limits.maxWorkspaces;
  }
}

/**
 * Per-unit overage price for a metric, if its plan has one configured — only
 * ORGANIZATIONS/WORKSPACES/USERS/CANDIDATES are billable this way; every
 * other metric stays a hard block at its limit (see assertWithinLimit).
 * Exported: also used by billingService.purchaseAddonCapacity, which reuses
 * this same rate for a tenant's proactive add-on purchases.
 */
export function priceFor(limits: PlanLimits, metric: UsageMetric): number | null {
  switch (metric) {
    case 'ORGANIZATIONS':
      return limits.pricePerOrganization;
    case 'WORKSPACES':
      return limits.pricePerWorkspace;
    case 'USERS':
      return limits.pricePerUser;
    case 'CANDIDATES':
      return limits.pricePerCandidate;
    default:
      return null;
  }
}

/** Deletion floor for a metric, if its plan has one configured (see assertAboveMinimum). */
function minFor(limits: PlanLimits, metric: UsageMetric): number | null {
  switch (metric) {
    case 'ORGANIZATIONS':
      return limits.minOrganizations;
    case 'WORKSPACES':
      return limits.minWorkspaces;
    case 'USERS':
      return limits.minUsers;
    case 'CANDIDATES':
      return limits.minCandidates;
    default:
      return null;
  }
}

/** This tenant's purchased add-on capacity for a metric (0 for non-billable metrics). Exported: also used by billingService for recurring-charge computation. */
export function extraFor(extra: ExtraCapacity, metric: UsageMetric): number {
  switch (metric) {
    case 'ORGANIZATIONS':
      return extra.organizations;
    case 'WORKSPACES':
      return extra.workspaces;
    case 'USERS':
      return extra.users;
    case 'CANDIDATES':
      return extra.candidates;
    default:
      return 0;
  }
}

/**
 * The EFFECTIVE limit for a metric: the plan's included maxX plus whatever
 * add-on capacity this tenant has purchased for it. This — not the raw plan
 * limit — is what actually gates writes and what getUsage displays, so a
 * tenant who bought add-ons sees and is governed by their true ceiling.
 */
function effectiveLimitFor(ent: Entitlements, metric: UsageMetric): number | null {
  const base = limitFor(ent.limits, metric);
  return base == null ? null : base + extraFor(ent.extra, metric);
}

/** Public accessor for the effective limit, e.g. to report back after a purchase. */
export async function getEffectiveLimit(tenantId: string, metric: UsageMetric): Promise<number | null> {
  const ent = await getEntitlements(tenantId);
  return effectiveLimitFor(ent, metric);
}

/** Normalize the counter period key to the current billing period start. */
function periodKey(ent: Entitlements): Date {
  return ent.currentPeriodStart;
}

async function readCounter(tenantId: string, metric: UsageMetric, periodStart: Date): Promise<number> {
  return runAsPlatform(async () => {
    const row = await prisma.usageCounter.findUnique({
      where: { tenantId_metric_periodStart: { tenantId, metric, periodStart } },
    });
    return row?.value ?? 0;
  });
}

/**
 * Live counts for metrics that are structural (not period-metered): they are
 * computed from the data itself, so they self-heal and can't drift.
 *
 * USERS and ACTIVE_JOBS are deliberately LIFETIME ceilings, not "currently
 * live" snapshots: once a seat/job slot is consumed it stays consumed for
 * the life of the tenant, even after the user is deactivated/deleted or the
 * job is closed. Without this, a tenant could cycle endlessly through a
 * free plan's limit (create 3 users, delete them, create 3 more...) and
 * never actually need to upgrade. Both `User` and `JobRequisition` are soft
 * -delete models (see SOFT_DELETE_MODELS in config/database.ts — a `.delete()`
 * on either is transparently rewritten to `deletedAt = now()`, never a real
 * row removal), so counting deleted rows alongside live ones is safe and
 * always available — no separate usage counter needed.
 */
async function structuralCount(tenantId: string, metric: UsageMetric): Promise<number | null> {
  return runAsPlatform(async () => {
    switch (metric) {
      case 'USERS': {
        // No isActive/deletedAt filter — deactivating or deleting a user
        // must not free up a seat (see comment above).
        const [live, deleted] = await Promise.all([
          prisma.user.count({ where: { tenantId, role: { name: { notIn: ['CANDIDATE'] } } } }),
          prisma.user.count({
            where: { tenantId, role: { name: { notIn: ['CANDIDATE'] } }, deletedAt: { not: null } },
          }),
        ]);
        return live + deleted;
      }
      case 'ACTIVE_JOBS': {
        // Counts every job that has ever reached OPEN at least once (OPEN or
        // CLOSED status) — closing or deleting a job does not free its slot.
        // DRAFT/PENDING_APPROVAL/REJECTED jobs never consumed a slot in the
        // first place (the quota check runs at approval time, not creation),
        // so they're intentionally excluded.
        const openOrClosed = { in: ['OPEN', 'CLOSED'] };
        const [live, deleted] = await Promise.all([
          prisma.jobRequisition.count({ where: { tenantId, status: openOrClosed } }),
          prisma.jobRequisition.count({ where: { tenantId, status: openOrClosed, deletedAt: { not: null } } }),
        ]);
        return live + deleted;
      }
      case 'CANDIDATES':
        return prisma.candidate.count({ where: { tenantId, deletedAt: null } });
      case 'SCHEDULES':
        return prisma.interviewSchedule.count({ where: { tenantId } });
      // Unlike USERS/ACTIVE_JOBS above, ORGANIZATIONS/WORKSPACES are LIVE-only
      // counts by design: deleting one frees its slot immediately. (Creation
      // is now always hard-capped at the effective limit — see
      // assertWithinLimit, which no longer lets a per-unit price bypass the
      // cap — so there's no seat-cycling loophole to guard against the way
      // there was when going over just meant automatic metered billing.)
      case 'ORGANIZATIONS':
        return prisma.organization.count({ where: { tenantId, deletedAt: null } });
      case 'WORKSPACES':
        return prisma.workspace.count({ where: { tenantId, deletedAt: null } });
      default:
        return null; // period-metered → UsageCounter
    }
  });
}

const BILLABLE_METRICS: UsageMetric[] = ['ORGANIZATIONS', 'WORKSPACES', 'USERS', 'CANDIDATES'];

/**
 * CURRENT (live-only) count for the 4 billable metrics — deliberately
 * separate from structuralCount's lifetime-ceiling counting for
 * USERS/ORGANIZATIONS/WORKSPACES. That lifetime counting exists to stop a
 * tenant from cycling through a FREE hard cap (create, delete, recreate);
 * once a plan charges per unit instead of blocking, there's no cap to game,
 * and billing must move with the tenant's actual current count in both
 * directions — an org/workspace/user/candidate they've deleted must stop
 * being charged for, immediately.
 */
async function liveCount(tenantId: string, metric: UsageMetric): Promise<number> {
  return runAsPlatform(async () => {
    switch (metric) {
      case 'ORGANIZATIONS':
        return prisma.organization.count({ where: { tenantId, deletedAt: null } });
      case 'WORKSPACES':
        return prisma.workspace.count({ where: { tenantId, deletedAt: null } });
      case 'USERS':
        return prisma.user.count({ where: { tenantId, deletedAt: null, role: { name: { notIn: ['CANDIDATE'] } } } });
      case 'CANDIDATES':
        return prisma.candidate.count({ where: { tenantId, deletedAt: null } });
      default:
        return 0;
    }
  });
}

/**
 * Current overage charges: for each billable metric whose plan has a
 * per-unit price configured AND is currently over its included quota, the
 * live units over times the unit price. Purely a live snapshot — nothing is
 * persisted here (see the fast-follow note in billingService for wiring this
 * into an actual Razorpay recurring charge); this is what the tenant would
 * owe right now if a bill ran this instant, shown on the Billing page so
 * there are no surprises.
 */
export async function getOverageCharges(tenantId: string): Promise<OverageSummary> {
  const ent = await getEntitlements(tenantId);
  const charges: OverageCharge[] = [];
  for (const metric of BILLABLE_METRICS) {
    // Effective limit — units already covered by a purchased add-on are
    // billed for once, at purchase time (see purchaseAddonCapacity), not
    // again here as ongoing overage.
    const limit = effectiveLimitFor(ent, metric);
    const unitPrice = priceFor(ent.limits, metric);
    if (limit == null || unitPrice == null) continue; // unlimited, or no paid overage configured
    const used = await liveCount(tenantId, metric);
    const unitsOver = Math.max(0, used - limit);
    if (unitsOver > 0) charges.push({ metric, unitsOver, unitPrice, amount: unitsOver * unitPrice });
  }
  return { charges, total: charges.reduce((sum, c) => sum + c.amount, 0), currency: ent.currency };
}

export async function getUsage(tenantId: string): Promise<TenantUsage> {
  const ent = await getEntitlements(tenantId);
  const metrics: UsageMetric[] = [
    'USERS',
    'INTERVIEWED_CANDIDATES',
    'ACTIVE_JOBS',
    'CANDIDATES',
    'SCHEDULES',
    'ORGANIZATIONS',
    'WORKSPACES',
  ];
  const usage: UsageEntry[] = [];
  for (const metric of metrics) {
    // EFFECTIVE limit (plan + any purchased add-on capacity) — see
    // effectiveLimitFor's doc comment. For non-billable metrics this is
    // identical to the raw plan limit (extraFor returns 0 for them).
    const limit = effectiveLimitFor(ent, metric);
    const used =
      (await structuralCount(tenantId, metric)) ?? (await readCounter(tenantId, metric, periodKey(ent)));
    usage.push({
      metric,
      used,
      limit,
      remaining: limit === null ? null : Math.max(0, limit - used),
      unitPrice: priceFor(ent.limits, metric),
      extra: extraFor(ent.extra, metric),
    });
  }
  return {
    tenantId,
    planCode: ent.planCode,
    subscriptionStatus: ent.subscriptionStatus,
    currentPeriodStart: ent.currentPeriodStart.toISOString(),
    currentPeriodEnd: ent.currentPeriodEnd?.toISOString() ?? null,
    usage,
  };
}

/**
 * Throws QuotaExceededError (402) if `incrementBy` more of `metric` would
 * exceed the EFFECTIVE limit (plan maxX + any purchased add-on capacity —
 * see effectiveLimitFor). Also asserts the subscription is active. Does NOT
 * increment — call recordUsage() after the action succeeds (period-metered
 * metrics only; structural metrics need no recording).
 *
 * Always a hard stop once at the limit, even when the plan has a per-unit
 * price configured for this metric (priceFor — ORGANIZATIONS/WORKSPACES/
 * USERS/CANDIDATES): a price only matters for the explicit, self-service
 * "buy add-on capacity" purchase (purchaseAddonCapacity), which raises the
 * effective limit checked here. There is no automatic metered-overage path
 * anymore — going over is never silently allowed-and-billed; capacity must
 * be bought (and the limit raised) before more can be created.
 */
export async function assertWithinLimit(
  tenantId: string,
  metric: UsageMetric,
  incrementBy = 1,
): Promise<void> {
  const ent = await assertActiveSubscription(tenantId);
  const limit = effectiveLimitFor(ent, metric); // plan maxX + any purchased add-on capacity
  if (limit === null || limit === undefined) return; // unlimited
  const used =
    (await structuralCount(tenantId, metric)) ?? (await readCounter(tenantId, metric, periodKey(ent)));
  if (used + incrementBy > limit) {
    throw new QuotaExceededError(metric, used, limit);
  }
}

/**
 * Deletion floor: throws if removing `decrementBy` more of `metric` would
 * take the tenant's CURRENT (live) count below its plan's configured
 * minimum (see minFor) — independent of maxX/extra add-on capacity above.
 * Null minimum (the default) means no floor beyond the existing structural
 * one (a tenant's single "default" organization/workspace already can't be
 * deleted — see organizationService/workspaceService).
 */
export async function assertAboveMinimum(
  tenantId: string,
  metric: BillableMetric,
  decrementBy = 1,
): Promise<void> {
  const ent = await getEntitlements(tenantId);
  const min = minFor(ent.limits, metric);
  if (min == null) return; // no plan-configured floor
  const used = await liveCount(tenantId, metric);
  if (used - decrementBy < min) {
    throw new ForbiddenError(
      `Your plan requires at least ${min} ${metric.toLowerCase()} — deleting this one would drop below that.`,
    );
  }
}

/** Idempotent-ish increment of a period-metered counter (INTERVIEWED_CANDIDATES). */
export async function recordUsage(tenantId: string, metric: UsageMetric, incrementBy = 1): Promise<void> {
  const ent = await getEntitlements(tenantId);
  const periodStart = periodKey(ent);
  await runAsPlatform(() =>
    prisma.usageCounter.upsert({
      where: { tenantId_metric_periodStart: { tenantId, metric, periodStart } },
      create: { tenantId, metric, periodStart, value: incrementBy },
      update: { value: { increment: incrementBy } },
    }),
  );
}

/**
 * Meter an interviewed candidate exactly once per candidate per billing
 * period: increments only if no OTHER interview for this candidate already
 * started within the current period.
 */
export async function meterInterviewedCandidate(
  tenantId: string,
  candidateId: string,
  interviewId: string,
): Promise<void> {
  const ent = await getEntitlements(tenantId);
  const periodStart = periodKey(ent);
  const already = await runAsPlatform(async () =>
    await prisma.interview.count({
      where: {
        tenantId,
        candidateId,
        id: { not: interviewId },
        startedAt: { gte: periodStart },
      },
    }),
  );
  if (already === 0) await recordUsage(tenantId, 'INTERVIEWED_CANDIDATES', 1);
}

/** Feature gate: throws 402 when the plan lacks a boolean feature. */
export async function assertFeature(tenantId: string, feature: 'aiEnabled' | 'proctoringEnabled'): Promise<void> {
  const ent = await assertActiveSubscription(tenantId);
  if (!ent.limits[feature]) {
    throw new QuotaExceededError(feature, 0, 0);
  }
}

/** Builds the one Tenant.extraX field to set (floored at 0) for a given metric, guaranteed to type-check per case. */
function extraSetData(metric: BillableMetric, value: number) {
  switch (metric) {
    case 'ORGANIZATIONS':
      return { extraOrganizations: value };
    case 'WORKSPACES':
      return { extraWorkspaces: value };
    case 'USERS':
      return { extraUsers: value };
    case 'CANDIDATES':
      return { extraCandidates: value };
  }
}

/**
 * Applies every PENDING add-on decrease scheduled for this tenant (see
 * billingService.scheduleAddonDecrease) — called at rollover, i.e. exactly
 * when the deferral it promised ("takes effect next cycle") actually arrives.
 * Never applied early: a tenant keeps the capacity they already paid for
 * through the end of the cycle they requested the decrease in.
 *
 * Re-reads Tenant.extraX and floors at 0 right before each write (rather than
 * blindly decrementing) — defensive against the pending amount ever exceeding
 * current capacity, however that happened, since a negative extraX would be a
 * silent billing bug that quietly undercounts what to charge.
 */
async function applyPendingAddonChanges(tenantId: string): Promise<void> {
  await runAsPlatform(async () => {
    const pending = await prisma.tenantAddonPendingChange.findMany({
      where: { tenantId, status: 'PENDING' },
    });
    for (const change of pending) {
      const metric = change.metric as BillableMetric;
      const quantity = Math.abs(change.delta);
      const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      const current = extraFor(
        {
          organizations: tenant.extraOrganizations,
          workspaces: tenant.extraWorkspaces,
          users: tenant.extraUsers,
          candidates: tenant.extraCandidates,
        },
        metric,
      );
      await prisma.tenant.update({ where: { id: tenantId }, data: extraSetData(metric, Math.max(0, current - quantity)) });
      await prisma.tenantAddonPendingChange.update({
        where: { id: change.id },
        data: { status: 'APPLIED', appliedAt: new Date() },
      });
    }
  });
}

/** Advance the usage period after a renewal (called from the billing webhook). */
export async function rolloverPeriod(tenantId: string, newStart: Date, newEnd: Date | null): Promise<void> {
  await runAsPlatform(async () =>
    await prisma.subscription.update({
      where: { tenantId },
      data: { currentPeriodStart: newStart, currentPeriodEnd: newEnd },
    }),
  );
  // Fresh UsageCounter rows are created lazily on first recordUsage() of the
  // new period (periodStart is part of the unique key), so no reset is needed.
  await applyPendingAddonChanges(tenantId);
}
