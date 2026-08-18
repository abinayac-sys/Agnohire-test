import { prisma, tenantTransaction } from '../config/database.js';
import { runAsPlatform, runWithTenant } from '../config/tenantContext.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../utils/errors.js';
import { getUsage } from './entitlementService.js';
import { seedTenantDefaults } from './tenantProvisioningService.js';
import { configService } from './configService.js';
import {
  isFreeEmailDomain,
  CONFIG_KEYS,
  type TenantListItem,
  type TenantDetail,
  type TenantStatus,
  type ApprovalStatus,
  type SubscriptionStatus,
} from '@agnohire/shared';

/** Last-resort fallback if even the platform-wide DEFAULT_TRIAL_DAYS config row is missing. */
const TRIAL_DAYS = 14;

/**
 * Platform-superadmin Tenant administration. Tenant/User/Job/etc.
 * counts are read cross-tenant via runAsPlatform. Suspending a tenant flips
 * Tenant.status → SUSPENDED; combined with the subscription/auth gating this
 * makes the tenant read-only. Delete is a soft delete (Tenant.deletedAt).
 */

async function ownerEmail(ownerUserId: string | null): Promise<string | null> {
  if (!ownerUserId) return null;
  const owner = await prisma.user.findUnique({ where: { id: ownerUserId }, select: { email: true } });
  return owner?.email ?? null;
}

export async function listTenants(currentUserId: string): Promise<TenantListItem[]> {
  return runAsPlatform(async () => {
    const tenants = await prisma.tenant.findMany({
      where: { deletedAt: null },
      include: {
        plan: { select: { code: true, name: true } },
        subscription: { select: { status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(
      tenants.map(async (t): Promise<TenantListItem> => {
        const [userCount, jobCount, candidateCount, interviewCount, email] = await Promise.all([
          prisma.user.count({ where: { tenantId: t.id, deletedAt: null, role: { name: { not: 'CANDIDATE' } } } }),
          prisma.jobRequisition.count({ where: { tenantId: t.id, deletedAt: null } }),
          prisma.candidate.count({ where: { tenantId: t.id, deletedAt: null } }),
          prisma.interview.count({ where: { tenantId: t.id, deletedAt: null } }),
          ownerEmail(t.ownerUserId),
        ]);
        return {
          id: t.id,
          name: t.name,
          slug: t.slug,
          status: t.status as TenantStatus,
          approvalStatus: t.approvalStatus as ApprovalStatus,
          phone: t.phone,
          ownerEmailFreemail: email ? isFreeEmailDomain(email) : false,
          planCode: t.plan?.code ?? null,
          planName: t.plan?.name ?? null,
          subscriptionStatus: (t.subscription?.status as SubscriptionStatus) ?? null,
          ownerEmail: email,
          ownerUserId: t.ownerUserId,
          userCount,
          jobCount,
          candidateCount,
          interviewCount,
          createdAt: t.createdAt.toISOString(),
          createdById: t.createdById,
          createdByMe: t.createdById === currentUserId,
          careersPageEnabled: t.careersPageEnabled,
        };
      }),
    );
  });
}

export async function getTenant(id: string, currentUserId: string): Promise<TenantDetail> {
  return runAsPlatform(async () => {
    const t = await prisma.tenant.findFirst({
      where: { id, deletedAt: null },
      include: {
        plan: { select: { code: true, name: true } },
        subscription: { select: { status: true, currentPeriodEnd: true } },
      },
    });
    if (!t) throw new NotFoundError('Workspace not found');

    const [userCount, jobCount, candidateCount, interviewCount, email, usage] = await Promise.all([
      prisma.user.count({ where: { tenantId: t.id, deletedAt: null, role: { name: { not: 'CANDIDATE' } } } }),
      prisma.jobRequisition.count({ where: { tenantId: t.id, deletedAt: null } }),
      prisma.candidate.count({ where: { tenantId: t.id, deletedAt: null } }),
      prisma.interview.count({ where: { tenantId: t.id, deletedAt: null } }),
      ownerEmail(t.ownerUserId),
      getUsage(t.id).catch(() => null),
    ]);

    return {
      id: t.id,
      name: t.name,
      slug: t.slug,
      status: t.status as TenantStatus,
      approvalStatus: t.approvalStatus as ApprovalStatus,
      phone: t.phone,
      ownerEmailFreemail: email ? isFreeEmailDomain(email) : false,
      planCode: t.plan?.code ?? null,
      planName: t.plan?.name ?? null,
      subscriptionStatus: (t.subscription?.status as SubscriptionStatus) ?? null,
      ownerEmail: email,
      ownerUserId: t.ownerUserId,
      userCount,
      jobCount,
      candidateCount,
      interviewCount,
      createdAt: t.createdAt.toISOString(),
      createdById: t.createdById,
      createdByMe: t.createdById === currentUserId,
      careersPageEnabled: t.careersPageEnabled,
      usage: usage?.usage ?? [],
      currentPeriodEnd: t.subscription?.currentPeriodEnd?.toISOString() ?? null,
    };
  });
}

/**
 * Guards operator-only actions (edit, impersonation) to the tenant's creator.
 * Returns the tenant's ownerUserId. Throws 403 if the caller didn't create it,
 * 404 if it doesn't exist.
 */
export async function assertCreatedByAndGetOwner(id: string, currentUserId: string): Promise<string> {
  return runAsPlatform(async () => {
    const t = await prisma.tenant.findFirst({
      where: { id, deletedAt: null },
      select: { createdById: true, ownerUserId: true },
    });
    if (!t) throw new NotFoundError('Workspace not found');
    if (t.createdById !== currentUserId) {
      throw new ForbiddenError('You can only manage workspaces you created');
    }
    if (!t.ownerUserId) throw new BadRequestError('Workspace has no owner to sign in as');
    return t.ownerUserId;
  });
}

/**
 * Edit a tenant profile: rename and/or reassign its plan. A plan change is
 * applied directly to both Tenant.planId and the Subscription (no Razorpay round
 * trip) — the platform operator is the authority here, mirroring the internal
 * subscription used by admin-provisioned tenants.
 */
export async function updateTenant(
  id: string,
  input: { name?: string; planCode?: string },
  currentUserId: string,
): Promise<TenantDetail> {
  return runAsPlatform(async () => {
    const tenant = await prisma.tenant.findFirst({ where: { id, deletedAt: null }, select: { createdById: true } });
    if (!tenant) throw new NotFoundError('Workspace not found');
    // Editing is restricted to the operator who created the tenant.
    if (tenant.createdById !== currentUserId) {
      throw new ForbiddenError('You can only edit workspaces you created');
    }

    let planId: string | undefined;
    if (input.planCode) {
      const plan = await prisma.plan.findUnique({ where: { code: input.planCode }, select: { id: true, isActive: true } });
      if (!plan || !plan.isActive) throw new BadRequestError('Unknown or inactive plan');
      planId = plan.id;
    }

    await prisma.tenant.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(planId ? { planId } : {}),
      },
    });

    if (planId) {
      // Keep the subscription's plan in step so entitlements/usage reflect it.
      await prisma.subscription.updateMany({ where: { tenantId: id }, data: { planId } });
    }

    return getTenant(id, currentUserId);
  });
}

/**
 * Operator-triggered reset of the tenant owner's password — for when the
 * owner forgot it and has no way to reset it themselves. Restricted to the
 * operator who created the tenant, same as edit/impersonate. Invalidates
 * the owner's existing sessions so the new password takes effect immediately.
 */
export async function resetOwnerPassword(id: string, password: string, currentUserId: string): Promise<void> {
  await runAsPlatform(async () => {
    const tenant = await prisma.tenant.findFirst({
      where: { id, deletedAt: null },
      select: { createdById: true, ownerUserId: true },
    });
    if (!tenant) throw new NotFoundError('Workspace not found');
    if (tenant.createdById !== currentUserId) {
      throw new ForbiddenError('You can only manage workspaces you created');
    }
    if (!tenant.ownerUserId) throw new BadRequestError('Workspace has no owner account yet');

    const { hashPassword, revokeUserSessions } = await import('./authService.js');
    const passwordHash = await hashPassword(password);
    await prisma.user.update({
      where: { id: tenant.ownerUserId },
      // The operator chose this password, so — same as a freshly provisioned
      // tenant — force the owner to replace it with one only they know on
      // next login (see authService.changePassword).
      data: { passwordHash, loginAttempts: 0, lockedUntil: null, mustChangePassword: true },
    });
    await revokeUserSessions(tenant.ownerUserId);
  });
}

export async function setTenantStatus(id: string, status: 'ACTIVE' | 'SUSPENDED'): Promise<void> {
  await runAsPlatform(async () => {
    const t = await prisma.tenant.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!t) throw new NotFoundError('Workspace not found');
    await prisma.tenant.update({ where: { id }, data: { status } });

    // Suspension has to bite immediately, for every member — not just the owner.
    // Flipping the column alone left existing access tokens working until they
    // expired and existing refresh tokens minting new ones indefinitely. Pairs
    // with the SUSPENDED check in authService.assertTenantApproved, which is
    // what stops them simply logging back in.
    if (status === 'SUSPENDED') {
      const members = await prisma.user.findMany({
        where: { tenantId: id, deletedAt: null },
        select: { id: true },
      });
      const { revokeUserSessions } = await import('./authService.js');
      for (const m of members) await revokeUserSessions(m.id);
    }
  });
}

/**
 * Grant/revoke the public careers-page (website embed) feature for a specific
 * tenant. Unlike updateTenant/resetOwnerPassword/impersonation, this is
 * NOT restricted to the operator who created the tenant — any superadmin
 * may grant or revoke it, same as setTenantStatus above. This is the ONLY
 * way the flag changes; tenant staff have no endpoint that can set it.
 */
export async function setCareersPageEnabled(id: string, enabled: boolean): Promise<void> {
  await runAsPlatform(async () => {
    const t = await prisma.tenant.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!t) throw new NotFoundError('Workspace not found');
    await prisma.tenant.update({ where: { id }, data: { careersPageEnabled: enabled } });
  });
}

export async function deleteTenant(id: string): Promise<void> {
  await runAsPlatform(async () => {
    const t = await prisma.tenant.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!t) throw new NotFoundError('Workspace not found');
    await prisma.tenant.update({ where: { id }, data: { deletedAt: new Date(), status: 'CANCELLED' } });

    // Soft-delete (and anonymize) every live user in this tenant too —
    // deleting a tenant previously left its User rows untouched, so an
    // owner's (or any member's) email stayed permanently "live" and blocked
    // re-registering that same email for a brand new tenant, even though
    // the tenant itself was gone. Mirrors adminUserService.deleteUser's
    // per-user delete. Each user needs its own placeholder email, so this is
    // a per-row update rather than one updateMany.
    const members = await prisma.user.findMany({
      where: { tenantId: id, deletedAt: null },
      select: { id: true },
    });
    if (members.length > 0) {
      const { anonymizedUserFields } = await import('../utils/piiAnonymize.js');
      await Promise.all(
        members.map((m) =>
          prisma.user.update({
            where: { id: m.id },
            data: { deletedAt: new Date(), isActive: false, ...anonymizedUserFields(m.id) },
          }),
        ),
      );
      const { revokeUserSessions } = await import('./authService.js');
      await Promise.all(members.map((m) => revokeUserSessions(m.id)));
    }
  });
}

/**
 * Marketing approves a pending self-serve tenant after qualifying the owner
 * by phone: flips approvalStatus → APPROVED, activates the tenant (ACTIVE +
 * seeded defaults), and emails the owner that they can now sign in.
 * Idempotent-safe.
 *
 * FREE-plan (or plan-less) tenants get a trial here — the plan's own
 * `trialDays` if set, else the platform-wide {@link CONFIG_KEYS.DEFAULT_TRIAL_DAYS}
 * default (falling back to the hardcoded {@link TRIAL_DAYS} only if even that
 * config row is missing). PAID-plan tenants must already have an ACTIVE
 * subscription (set exclusively by the Razorpay subscription.activated
 * webhook once payment clears) — approval is refused otherwise, so a paid
 * plan can never be unlocked without a real completed payment. When the
 * subscription is already ACTIVE, it's left untouched (its real paid period
 * is preserved, not overwritten with a fresh trial).
 */
export async function approveTenant(
  id: string,
  notes: string | undefined,
  approverId: string,
): Promise<TenantDetail> {
  return runAsPlatform(async () => {
    const t = await prisma.tenant.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, approvalStatus: true, planId: true, ownerUserId: true, name: true },
    });
    if (!t) throw new NotFoundError('Workspace not found');

    const plan = t.planId ? await prisma.plan.findUnique({ where: { id: t.planId }, select: { priceMonthly: true, trialDays: true } }) : null;
    const isPaidPlan = plan?.priceMonthly != null && Number(plan.priceMonthly) > 0;
    const existingSub = await prisma.subscription.findUnique({ where: { tenantId: id }, select: { status: true } });

    if (isPaidPlan && existingSub?.status !== 'ACTIVE') {
      throw new BadRequestError(
        'Payment not yet completed for this workspace’s paid plan — cannot approve until the subscription is active.',
      );
    }

    // Per-plan override, else the platform-wide default (see CONFIG_KEYS.DEFAULT_TRIAL_DAYS).
    const trialDays = plan?.trialDays ?? (await configService.getNumber(CONFIG_KEYS.DEFAULT_TRIAL_DAYS, TRIAL_DAYS));
    const now = new Date();
    const trialEnd = new Date(now.getTime() + trialDays * 86_400_000);

    await tenantTransaction(async (tx) => {
      await tx.tenant.update({
        where: { id },
        data: {
          approvalStatus: 'APPROVED',
          approvedAt: now,
          approvedById: approverId,
          approvalNotes: notes ?? null,
          status: 'ACTIVE',
        },
      });

      // Paid plan with a confirmed payment: leave the real subscription (and
      // its actual paid period) exactly as the webhook set it — do not grant
      // a trial on top of a paid subscription.
      if (isPaidPlan) return;

      const existing = await tx.subscription.findUnique({ where: { tenantId: id } });
      if (existing) {
        await tx.subscription.update({
          where: { tenantId: id },
          data: { status: 'TRIALING', currentPeriodStart: now, currentPeriodEnd: trialEnd },
        });
      } else if (t.planId) {
        await tx.subscription.create({
          data: {
            tenantId: id,
            planId: t.planId,
            status: 'TRIALING',
            billingInterval: 'monthly',
            provider: 'internal',
            currentPeriodStart: now,
            currentPeriodEnd: trialEnd,
          },
        });
      }
    });

    await seedTenantDefaults(id);

    // Best-effort "you're live" email. Sent under the approved tenant's own
    // context, not the platform bypass this function runs in, so it resolves
    // that tenant's SMTP override rather than always falling back to the
    // platform default.
    try {
      const email = await ownerEmail(t.ownerUserId);
      const { sendMail } = (await import('./mailerService.js')) as {
        sendMail?: (opts: { to: string; subject: string; html: string }) => Promise<unknown>;
      };
      if (email && sendMail) {
        await runWithTenant(id, () =>
          sendMail({
            to: email,
            subject: 'Your AgnoHire workspace is live 🎉',
            html: `<p>Good news — your workspace <strong>${t.name}</strong> has been approved and is now active${isPaidPlan ? '' : ` with a ${trialDays}-day free trial`}.</p>
<p>Sign in to get started: <a href="${env.clientUrl}/login">${env.clientUrl}/login</a></p>`,
          }),
        );
      }
    } catch (err) {
      logger.warn('Approval email not sent (SMTP unavailable?)', { err: (err as Error).message });
    }

    return getTenant(id, approverId);
  });
}

/** Marketing rejects a pending tenant (stays inert; owner cannot sign in). */
export async function rejectTenant(
  id: string,
  notes: string | undefined,
  approverId: string,
): Promise<void> {
  await runAsPlatform(async () => {
    const t = await prisma.tenant.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!t) throw new NotFoundError('Workspace not found');
    await prisma.tenant.update({
      where: { id },
      data: { approvalStatus: 'REJECTED', approvedAt: new Date(), approvedById: approverId, approvalNotes: notes ?? null },
    });
  });
}
