import { prisma } from '../../config/database.js';
import { runAsPlatform, runWithTenant } from '../../config/tenantContext.js';
import { ROLES } from '@agnohire/shared';
import { sendMail } from '../mailerService.js';
import { notify } from '../notificationService.js';
import { shell } from '../emailTemplates.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

/**
 * Dispatches an in-app notification and email to all tenant admins and the owner.
 */
export async function notifyAllTenantAdmins(
  tenantId: string,
  title: string,
  message: string,
  dedupeKey?: string,
): Promise<void> {
  await runAsPlatform(async () => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, ownerUserId: true },
    });
    if (!tenant) return;

    // Find all active admins and owner
    const admins = await prisma.user.findMany({
      where: {
        tenantId,
        deletedAt: null,
        isActive: true,
        OR: [
          { role: { name: { in: [ROLES.ADMIN, ROLES.TENANT_OWNER] } } },
          ...(tenant.ownerUserId ? [{ id: tenant.ownerUserId }] : []),
        ],
      },
      select: { id: true, email: true, fullName: true },
    });

    if (admins.length === 0) return;

    const billingUrl = `${env.clientUrl}/billing`;
    const htmlBody = `
      <p style="font-size:16px;color:#1e293b;margin-bottom:16px;">Hello,</p>
      <p style="font-size:15px;color:#334155;line-height:1.6;margin-bottom:20px;">${message}</p>
      <div style="margin:24px 0;text-align:center;">
        <a href="${billingUrl}" style="background-color:#0B5ED7;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;">
          Manage Subscription & Billing
        </a>
      </div>
      <p style="font-size:13px;color:#64748b;margin-top:24px;">If you have any questions or need assistance, please reply to this email or contact support.</p>
    `;

    const fullHtml = await runWithTenant(tenantId, () => shell(title, htmlBody));

    for (const admin of admins) {
      // 1. Send in-app notification
      try {
        await notify({
          recipientId: admin.id,
          type: 'SYSTEM',
          title,
          message,
          entityType: 'Tenant',
          entityId: tenantId,
        });
      } catch (err) {
        logger.warn('Failed to send in-app subscription notification to admin', { adminId: admin.id, err: (err as Error).message });
      }

      // 2. Send email notification
      try {
        await runWithTenant(tenantId, () =>
          sendMail({
            to: admin.email,
            subject: `[${tenant.name}] ${title}`,
            html: fullHtml,
            templateId: dedupeKey ?? `sub-notify-${tenantId}`,
          }),
        );
      } catch (err) {
        logger.warn('Failed to send subscription email to admin', { email: admin.email, err: (err as Error).message });
      }
    }
  });
}

/**
 * Two one-time notifications tied to a subscription's own currentPeriodEnd —
 * distinct from the recurring add-on/renewal reminder in billingService.ts,
 * which is about the amount that will be charged, not the subscription
 * itself lapsing. Deduped via Subscription.expiryReminderSentAt/
 * expiredNotificationSentAt so the periodic sweeper (see
 * server/src/jobs/subscriptionSweeper.ts) can run as often as it likes
 * without spamming either email more than once per period.
 */
export async function sendSubscriptionReminderEmail(tenantId: string): Promise<void> {
  await runAsPlatform(async () => {
    const sub = await prisma.subscription.findUnique({ where: { tenantId } });
    if (!sub || sub.expiryReminderSentAt) return;
    await notifyAllTenantAdmins(
      tenantId,
      'Your subscription is ending soon',
      `Your ${sub.status === 'TRIALING' ? 'free trial' : 'subscription'} ends on ${sub.currentPeriodEnd?.toLocaleDateString('en-IN') ?? 'soon'}. Renew or upgrade from the Billing & Usage page to avoid losing access.`,
      `sub-expiry-reminder-${tenantId}-${sub.currentPeriodEnd?.toISOString() ?? 'unknown'}`,
    );
    await prisma.subscription.update({ where: { tenantId }, data: { expiryReminderSentAt: new Date() } });
  });
}

export async function sendSubscriptionExpiredEmail(tenantId: string): Promise<void> {
  await runAsPlatform(async () => {
    const sub = await prisma.subscription.findUnique({ where: { tenantId } });
    if (!sub || sub.expiredNotificationSentAt) return;
    await notifyAllTenantAdmins(
      tenantId,
      'Your subscription has expired',
      'Your subscription/trial has ended and your workspace is now read-only. Renew or upgrade from the Billing & Usage page to restore full access.',
      `sub-expired-${tenantId}-${sub.currentPeriodEnd?.toISOString() ?? 'unknown'}`,
    );
    await prisma.subscription.update({ where: { tenantId }, data: { expiredNotificationSentAt: new Date() } });
  });
}
