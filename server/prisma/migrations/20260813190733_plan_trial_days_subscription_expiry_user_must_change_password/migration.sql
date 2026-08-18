-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "trialDays" INTEGER;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "expiredNotificationSentAt" TIMESTAMP(3),
ADD COLUMN     "expiryReminderSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
