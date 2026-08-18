import { prisma } from '../config/database.js';
import { runAsPlatform } from '../config/tenantContext.js';
import { logger } from '../config/logger.js';
import { sendSubscriptionReminderEmail, sendSubscriptionExpiredEmail } from '../services/billing/billingEmailService.js';

const EXPIRY_REMINDER_LEAD_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

/**
 * Periodic sweep for the two one-time TRIAL-expiry emails — mirrors app.ts's
 * existing inline AI-interview-timeout sweeper's shape (a plain setInterval
 * scanning across all tenants via runAsPlatform), rather than introducing
 * Bull/queue-based scheduling for something this coarse-grained. Both sends
 * are self-deduping (see billingEmailService.ts), so running this more than
 * once for the same subscription period is harmless.
 *
 * Scoped to TRIALING only, deliberately — an ACTIVE paid subscription's
 * currentPeriodEnd is a renewal date, not an expiry: it's already covered by
 * the subscription.charged/pending/halted webhook notifications and the
 * separate recurring add-on renewal reminder (billingService.
 * scheduleRenewalReminder). Adding a second "ending soon" email for paid
 * tenants here would just be redundant with those.
 */
export function startSubscriptionExpirySweeper(intervalMs = 60 * 60_000): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      const now = new Date();
      const soon = new Date(now.getTime() + EXPIRY_REMINDER_LEAD_MS);

      const nearingExpiry = await runAsPlatform(() =>
        prisma.subscription.findMany({
          where: {
            status: 'TRIALING',
            currentPeriodEnd: { not: null, gt: now, lte: soon },
            expiryReminderSentAt: null,
          },
          select: { tenantId: true },
          take: 200,
        }),
      );
      for (const sub of nearingExpiry) {
        await sendSubscriptionReminderEmail(sub.tenantId);
      }

      const pastExpiry = await runAsPlatform(() =>
        prisma.subscription.findMany({
          where: {
            status: { in: ['TRIALING', 'EXPIRED'] },
            currentPeriodEnd: { not: null, lte: now },
            expiredNotificationSentAt: null,
          },
          select: { tenantId: true },
          take: 200,
        }),
      );
      for (const sub of pastExpiry) {
        await sendSubscriptionExpiredEmail(sub.tenantId);
      }
    } catch (err) {
      logger.error('Error in subscription expiry sweeper', { err: (err as Error).message });
    }
  }, intervalMs);
}
