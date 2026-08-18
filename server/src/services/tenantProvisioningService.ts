import crypto from 'node:crypto';
import type { Request } from 'express';
import { prisma, tenantTransaction } from '../config/database.js';
import { runAsPlatform, runWithTenant } from '../config/tenantContext.js';
import { ensureDefaultOrganizationAndWorkspace, ensureWorkspaceMembership } from './workspaceProvisioningService.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { hashPassword } from './authService.js';
import { recordAudit } from './auditService.js';
import { BadRequestError, ConflictError, NotFoundError } from '../utils/errors.js';
import { ROLES, isValidTimezone, type RegisterTenantInput, type RegisterResult } from '@agnohire/shared';

/**
 * Public self-service registration → tenant provisioning.
 *
 * Every signup is created inert (tenant PENDING, approvalStatus PENDING) —
 * marketing still phone-qualifies every tenant before approving.
 *
 * FREE plan  → no subscription created yet; approveTenant() starts the
 *              14-day trial when a superadmin approves.
 * PAID plan  → a Razorpay subscription (status CREATED) is created right here
 *              and its checkout details are returned to the client, which must
 *              complete Razorpay Checkout before anything else happens. The
 *              subscription only reaches ACTIVE via the subscription.activated
 *              webhook — approveTenant() refuses to approve a paid-plan
 *              tenant until that happens, so no trial/access is ever granted
 *              without a real completed payment.
 *
 * The owner user is created with the existing ADMIN role so the approved
 * client UI works unchanged; owner-ness is Tenant.ownerUserId.
 */

function makeSlug(companyName: string): string {
  const base =
    companyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'tenant';
  return base;
}

async function uniqueSlug(companyName: string): Promise<string> {
  const base = makeSlug(companyName);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const existing = await prisma.tenant.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!existing) return candidate;
  }
  return `${base}-${crypto.randomBytes(3).toString('hex')}`;
}

/**
 * Seed per-tenant defaults on activation: default org/workspace + sector +
 * baseline config, and grant the tenant's owner (if set by this point) a
 * WorkspaceMember row so their next login/refresh resolves a real "current
 * workspace" instead of null (TENANT_OWNER/ADMIN can already ACT in any
 * workspace by role — see workspaceMembershipService — but the JWT's
 * organizationId/workspaceId claims still come only from an actual
 * membership row, so they need one too).
 */
export async function seedTenantDefaults(tenantId: string): Promise<void> {
  // Runs under runAsPlatform (bypass, no ambient organization/workspace) —
  // this tenant doesn't have one yet, that's exactly what's being created
  // here — so organizationId/workspaceId are resolved explicitly rather than
  // via requireOrganizationId()/requireWorkspaceId(), which would throw.
  const { organizationId, workspaceId } = await ensureDefaultOrganizationAndWorkspace(tenantId);
  await runAsPlatform(async () => {
    const existing = await prisma.sector.findFirst({ where: { tenantId }, select: { id: true } });
    if (!existing) {
      await prisma.sector.create({
        data: { name: 'General', type: 'DEPARTMENT', tenantId, organizationId, workspaceId },
      });
    }
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { ownerUserId: true } });
    if (tenant?.ownerUserId) {
      await ensureWorkspaceMembership(tenant.ownerUserId, tenantId, organizationId, workspaceId, true);
    }
  });
}

export async function activateTenant(tenantId: string): Promise<void> {
  await runAsPlatform(async () => {
    await prisma.tenant.update({ where: { id: tenantId }, data: { status: 'ACTIVE' } });
  });
  await seedTenantDefaults(tenantId);
}

export async function registerTenant(input: RegisterTenantInput): Promise<RegisterResult> {
  return runAsPlatform(async () => {
    const existingUser = await prisma.user.findFirst({
      where: { email: input.email.toLowerCase(), deletedAt: null },
      select: { id: true, tenantId: true },
    });

    // A prior signup for this email may simply have abandoned Razorpay
    // Checkout without paying — the tenant/owner were already created (see
    // below) before checkout even opens. Rather than permanently locking the
    // email out, let them retry: reuse the still-inert PENDING/PENDING
    // tenant+owner if no payment ever went through (no subscription row, or
    // one stuck at the pre-checkout CREATED state).
    let reuseTenant: { id: string; ownerUserId: string } | null = null;
    if (existingUser) {
      const existingTenant = existingUser.tenantId
        ? await prisma.tenant.findUnique({
            where: { id: existingUser.tenantId },
            include: { subscription: true },
          })
        : null;
      const abandonedSignup =
        existingTenant &&
        existingTenant.status === 'PENDING' &&
        existingTenant.approvalStatus === 'PENDING' &&
        existingTenant.ownerUserId === existingUser.id &&
        (!existingTenant.subscription || existingTenant.subscription.status === 'CREATED');

      if (!abandonedSignup) throw new ConflictError('A user with that email already exists');
      reuseTenant = { id: existingTenant.id, ownerUserId: existingUser.id };
    }

    const plan = await prisma.plan.findUnique({ where: { code: input.planCode } });
    if (!plan || !plan.isActive) throw new BadRequestError('Unknown or inactive plan');

    // Fail fast, before creating anything: a paid plan needs a working
    // Razorpay checkout, and we must not leave an orphaned tenant/owner row
    // (with the email now "taken") behind if billing isn't configured.
    const isPaidPlan = plan.priceMonthly != null && Number(plan.priceMonthly) > 0;
    if (isPaidPlan && !env.razorpay.enabled) {
      throw new BadRequestError('Billing is not configured on this deployment (RAZORPAY_KEY_ID/SECRET missing)');
    }

    const adminRole = await prisma.role.findUnique({ where: { name: ROLES.ADMIN } });
    if (!adminRole) throw new NotFoundError('ADMIN role not seeded');

    const verifyToken = crypto.randomBytes(24).toString('hex');
    const passwordHash = await hashPassword(input.password);
    // Soft-detected client-side; anything invalid/missing silently clamps to
    // UTC rather than blocking registration over it.
    const timezone = isValidTimezone(input.timezone) ? input.timezone : 'UTC';

    // Self-serve signups are created INERT: status PENDING + approvalStatus
    // PENDING, no defaults seeded and no subscription. The owner cannot log in
    // until marketing qualifies them (phone call) and approves — approval then
    // activates the tenant and starts the trial. The selected plan is recorded
    // (planId) for use when the trial is provisioned.
    const { tenant } = reuseTenant
      ? await tenantTransaction(async (tx) => {
          const tenant = await tx.tenant.update({
            where: { id: reuseTenant!.id },
            data: { name: input.companyName, phone: input.phone, planId: plan.id, timezone },
          });
          await tx.user.update({
            where: { id: reuseTenant!.ownerUserId },
            data: { fullName: input.fullName, passwordHash, verifyToken },
          });
          return { tenant };
        })
      : await tenantTransaction(async (tx) => {
      const slug = await uniqueSlug(input.companyName);
      const tenant = await tx.tenant.create({
        data: {
          name: input.companyName,
          slug,
          status: 'PENDING',
          approvalStatus: 'PENDING',
          phone: input.phone,
          planId: plan.id,
          timezone,
        },
      });
      const owner = await tx.user.create({
        data: {
          fullName: input.fullName,
          email: input.email.toLowerCase(),
          passwordHash,
          roleId: adminRole.id,
          tenantId: tenant.id,
          isActive: true,
          verifyToken,
        },
      });
      await tx.tenant.update({ where: { id: tenant.id }, data: { ownerUserId: owner.id } });
      return { tenant, owner };
    });

    // Paid plans must pay before anything else happens: create the Razorpay
    // subscription now and hand the client checkout details back. The tenant
    // stays PENDING/unapproved — approveTenant() below refuses to approve
    // a paid-plan tenant until the subscription.activated webhook confirms
    // real payment, so no free ride into a paid plan's trial.
    let checkout: RegisterResult['checkout'];
    if (isPaidPlan) {
      const { createSubscriptionForTenant } = await import('./billing/billingService.js');
      checkout = await createSubscriptionForTenant(tenant.id, plan.id, input.billingInterval);
    }

    // Best-effort "we'll be in touch" email; registration still succeeds without SMTP.
    // Sent under the NEW tenant's own context (not the platform bypass this
    // function runs in), so it resolves that tenant's SMTP override rather than
    // always falling back to the platform default.
    try {
      const { sendMail } = (await import('./mailerService.js')) as {
        sendMail?: (opts: { to: string; subject: string; html: string }) => Promise<unknown>;
      };
      if (sendMail) {
        const html = isPaidPlan
          ? `<p>Thanks for signing up for AgnoHire, ${input.fullName}!</p>
<p>Your workspace <strong>${input.companyName}</strong> is awaiting payment confirmation. Once your payment goes through, our team will review and activate your workspace — we'll reach out at <strong>${input.phone}</strong> shortly after.</p>`
          : `<p>Thanks for signing up for AgnoHire, ${input.fullName}!</p>
<p>Your workspace <strong>${input.companyName}</strong> is being reviewed by our team. We'll reach out at <strong>${input.phone}</strong> shortly to get you set up — once approved you'll be able to sign in.</p>`;
        await runWithTenant(tenant.id, () =>
          sendMail({
            to: input.email.toLowerCase(),
            subject: isPaidPlan ? 'Your AgnoHire workspace payment' : 'Your AgnoHire workspace is under review',
            html,
          }),
        );
      }
    } catch (err) {
      logger.warn('Registration email not sent (SMTP unavailable?)', { err: (err as Error).message });
    }

    return {
      tenantId: tenant.id,
      requiresPayment: isPaidPlan,
      requiresEmailVerification: true,
      requiresApproval: true,
      checkout,
    };
  });
}

/**
 * Platform-superadmin: provision a tenant on an owner's behalf. Creates the
 * tenant (ACTIVE) + internal subscription + owner ADMIN user + default sector
 * atomically. `createdById` records the provisioning operator so the Tenant
 * Accounts view can gate edit/impersonation to the creator.
 *
 * The owner user is created up-front (active, ADMIN) so it shows in the list
 * immediately and can be impersonated by its creator. The owner sets their own
 * password later via the emailed set-password token (verifyToken). No
 * admin-chosen password is stored.
 */
export async function createTenantByAdmin(
  input: { companyName: string; ownerFullName: string; ownerEmail: string; ownerPassword: string; planCode: string },
  createdById: string,
): Promise<{ tenantId: string; slug: string; ownerEmail: string; ownerUserId: string; setPasswordToken: string }> {
  return runAsPlatform(async () => {
    const email = input.ownerEmail.toLowerCase();
    const existingUser = await prisma.user.findFirst({ where: { email, deletedAt: null }, select: { id: true } });
    if (existingUser) throw new ConflictError('A user with that email already exists');

    const plan = await prisma.plan.findUnique({ where: { code: input.planCode } });
    if (!plan || !plan.isActive) throw new BadRequestError('Unknown or inactive plan');

    const adminRole = await prisma.role.findUnique({ where: { name: ROLES.ADMIN } });
    if (!adminRole) throw new NotFoundError('ADMIN role not seeded');

    const slug = await uniqueSlug(input.companyName);
    const setPasswordToken = crypto.randomBytes(24).toString('hex');
    // The operator sets the owner's initial password, so the owner can sign in
    // with email + password immediately (they may change it later via the
    // emailed set-password token). Operators can also still impersonate.
    const passwordHash = await hashPassword(input.ownerPassword);

    const { tenant, owner } = await tenantTransaction(async (tx) => {
      const t = await tx.tenant.create({
        data: { name: input.companyName, slug, status: 'ACTIVE', planId: plan.id, createdById },
      });
      const owner = await tx.user.create({
        data: {
          fullName: input.ownerFullName,
          email,
          passwordHash,
          roleId: adminRole.id,
          tenantId: t.id,
          isActive: true,
          verifyToken: setPasswordToken,
          // The operator chose this password, so it's known outside the
          // owner's own head — force them to replace it with one only they
          // know on first login (see authService.changePassword).
          mustChangePassword: true,
        },
      });
      await tx.tenant.update({ where: { id: t.id }, data: { ownerUserId: owner.id } });
      await tx.subscription.create({
        data: {
          tenantId: t.id,
          planId: plan.id,
          status: 'ACTIVE',
          billingInterval: 'monthly',
          provider: 'internal',
          currentPeriodStart: new Date(),
        },
      });
      return { tenant: t, owner };
    });

    await seedTenantDefaults(tenant.id);

    // Best-effort set-password email (registration/invite style); creation still
    // succeeds without SMTP. Sent under the new tenant's own context (see
    // registerTenant) so it resolves that tenant's SMTP override, not the
    // platform default.
    try {
      const { sendMail } = (await import('./mailerService.js')) as {
        sendMail?: (opts: { to: string; subject: string; html: string }) => Promise<unknown>;
      };
      if (sendMail) {
        const link = `${env.clientUrl}/accept-invite?token=${setPasswordToken}`;
        await runWithTenant(tenant.id, () =>
          sendMail({
            to: email,
            subject: 'Your AgnoHire workspace is ready',
            html: `<p>A workspace has been created for you on AgnoHire.</p><p><a href="${link}">Set your password</a> to sign in.</p>`,
          }),
        );
      }
    } catch (err) {
      logger.warn('Tenant owner set-password email not sent', { err: (err as Error).message });
    }

    return { tenantId: tenant.id, slug, ownerEmail: email, ownerUserId: owner.id, setPasswordToken };
  });
}

// ── Tenant invites ───────────────────────────────────────────────────────────

export async function createInvite(
  tenantId: string,
  email: string,
  roleName: string,
): Promise<{ token: string; expiresAt: Date }> {
  return runAsPlatform(async () => {
    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role || roleName === 'SUPERADMIN') {
      throw new BadRequestError('Invalid role for invite');
    }
    const existingUser = await prisma.user.findFirst({ where: { email: email.toLowerCase() } });
    if (existingUser) throw new ConflictError('A user with that email already exists');

    // Quota check: invites consume a seat on acceptance, but block early for UX.
    const { assertWithinLimit } = await import('./entitlementService.js');
    await assertWithinLimit(tenantId, 'USERS', 1);

    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 86_400_000);
    await prisma.tenantInvite.create({
      data: { tenantId, email: email.toLowerCase(), roleId: role.id, token, expiresAt },
    });

    try {
      const { sendMail } = await import('./mailerService.js');
      const link = `${env.clientUrl}/accept-invite?token=${token}`;
      // Sent under the inviting tenant's own context, not the platform bypass
      // this function runs in, so it resolves that tenant's SMTP override.
      await runWithTenant(tenantId, () =>
        sendMail({
          to: email,
          subject: 'You have been invited to AgnoHire',
          html: `<p>You've been invited to join a workspace on AgnoHire.</p><p><a href="${link}">Accept invitation</a> (expires in 7 days)</p>`,
        }),
      );
    } catch (err) {
      logger.warn('Invite email not sent', { err: (err as Error).message });
    }
    return { token, expiresAt };
  });
}

/** Corrects the tenant's stored timezone after signup (auto-detect can be wrong — VPN, shared machine, etc). */
export async function updateTenantTimezone(tenantId: string, timezone: string, req: Request): Promise<{ timezone: string }> {
  return runAsPlatform(async () => {
    const before = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
    const tenant = await prisma.tenant.update({ where: { id: tenantId }, data: { timezone }, select: { timezone: true } });
    await recordAudit(req, {
      action: 'UPDATE',
      entity: 'Tenant',
      entityId: tenantId,
      description: `Changed workspace timezone from ${before?.timezone ?? 'UTC'} to ${timezone}`,
    });
    return tenant;
  });
}

export async function listInvites(tenantId: string) {
  return runAsPlatform(async () => await prisma.tenantInvite.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 100 }));
}

export async function acceptInvite(
  token: string,
  fullName: string,
  password: string,
): Promise<{ accepted: boolean }> {
  return runAsPlatform(async () => {
    const invite = await prisma.tenantInvite.findUnique({ where: { token } });
    if (!invite || invite.status !== 'PENDING' || invite.expiresAt < new Date()) {
      throw new BadRequestError('Invite is invalid or expired');
    }
    const existingUser = await prisma.user.findFirst({ where: { email: invite.email } });
    if (existingUser) throw new ConflictError('A user with that email already exists');

    // Authoritative seat check at acceptance time.
    const { assertWithinLimit } = await import('./entitlementService.js');
    await assertWithinLimit(invite.tenantId, 'USERS', 1);

    const passwordHash = await hashPassword(password);
    await tenantTransaction(async (tx) => {
      await tx.user.create({
        data: {
          fullName,
          email: invite.email,
          passwordHash,
          roleId: invite.roleId,
          tenantId: invite.tenantId,
          isActive: true,
          emailVerifiedAt: new Date(), // invite email proves address ownership
        },
      });
      await tx.tenantInvite.update({ where: { id: invite.id }, data: { status: 'ACCEPTED' } });
    });
    return { accepted: true };
  });
}

export async function verifyEmail(token: string): Promise<{ verified: boolean }> {
  return runAsPlatform(async () => {
    const user = await prisma.user.findFirst({ where: { verifyToken: token } });
    if (!user) throw new BadRequestError('Invalid or expired verification token');
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date(), verifyToken: null },
    });
    return { verified: true };
  });
}

export async function resendVerification(email: string): Promise<{ sent: boolean }> {
  return runAsPlatform(async () => {
    const user = await prisma.user.findFirst({ where: { email: email.toLowerCase() } });
    // Do not leak account existence.
    if (!user || user.emailVerifiedAt) return { sent: true };
    const verifyToken = crypto.randomBytes(24).toString('hex');
    await prisma.user.update({ where: { id: user.id }, data: { verifyToken } });
    try {
      const { sendMail } = (await import('./mailerService.js')) as {
        sendMail?: (opts: { to: string; subject: string; html: string }) => Promise<unknown>;
      };
      if (sendMail) {
        const link = `${env.clientUrl}/verify-email?token=${verifyToken}`;
        // Sent under the user's own tenant context, not the platform bypass
        // this function runs in, so it resolves that tenant's SMTP override.
        await runWithTenant(user.tenantId ?? null, () =>
          sendMail({
            to: user.email,
            subject: 'Verify your AgnoHire account',
            html: `<p>Verify your email:</p><p><a href="${link}">${link}</a></p>`,
          }),
        );
      }
    } catch {
      /* best-effort */
    }
    return { sent: true };
  });
}

// ── Password reset (self-service "forgot password") ────────────────────────

/**
 * Emails a single-use reset link for any account with a password (tenant
 * owners/members, superadmins). Never reveals whether the email exists.
 */
export async function requestPasswordReset(email: string): Promise<{ sent: boolean }> {
  return runAsPlatform(async () => {
    const user = await prisma.user.findFirst({ where: { email: email.toLowerCase() } });
    if (!user || !user.isActive) return { sent: true };

    const resetToken = crypto.randomBytes(24).toString('hex');
    const resetTokenExp = new Date(Date.now() + 60 * 60_000); // 1 hour
    await prisma.user.update({ where: { id: user.id }, data: { resetToken, resetTokenExp } });

    try {
      const { sendMail } = (await import('./mailerService.js')) as {
        sendMail?: (opts: { to: string; subject: string; html: string }) => Promise<unknown>;
      };
      if (sendMail) {
        const link = `${env.clientUrl}/reset-password?token=${resetToken}`;
        // Sent under the user's own tenant context (not the platform bypass this
        // function runs in) so it resolves that tenant's SMTP override.
        await runWithTenant(user.tenantId ?? null, () =>
          sendMail({
            to: user.email,
            subject: 'Reset your AgnoHire password',
            html: `<p>We received a request to reset your password.</p><p><a href="${link}">Reset your password</a> (this link expires in 1 hour).</p><p>If you didn't request this, you can safely ignore this email.</p>`,
          }),
        );
      }
    } catch (err) {
      logger.warn('Password reset email not sent', { err: (err as Error).message });
    }
    return { sent: true };
  });
}

export async function resetPasswordWithToken(token: string, password: string): Promise<{ reset: boolean }> {
  return runAsPlatform(async () => {
    const user = await prisma.user.findFirst({ where: { resetToken: token } });
    if (!user || !user.resetTokenExp || user.resetTokenExp < new Date()) {
      throw new BadRequestError('Reset link is invalid or expired');
    }
    const passwordHash = await hashPassword(password);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        resetToken: null,
        resetTokenExp: null,
        loginAttempts: 0,
        lockedUntil: null,
      },
    });
    // A password reset invalidates existing sessions (forces re-login everywhere).
    const { revokeUserSessions } = await import('./authService.js');
    await revokeUserSessions(user.id);
    return { reset: true };
  });
}
