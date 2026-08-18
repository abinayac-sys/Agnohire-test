-- Multi-tenant SaaS migration (forward-only, `prisma migrate deploy` safe).
-- 1) New tenancy/billing tables  2) nullable tenantId on tenant-owned tables
-- 3) backfill legacy data into a default tenant  4) new roles.

-- ── 1. New tables ────────────────────────────────────────────────────────────

CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceMonthly" DECIMAL(65,30),
    "priceYearly" DECIMAL(65,30),
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "razorpayPlanIdMonthly" TEXT,
    "razorpayPlanIdYearly" TEXT,
    "maxUsers" INTEGER,
    "maxInterviewedCandidates" INTEGER,
    "maxActiveJobs" INTEGER,
    "maxAssessments" INTEGER,
    "storageMb" INTEGER,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "proctoringEnabled" BOOLEAN NOT NULL DEFAULT true,
    "featuresJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");

CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "ownerUserId" TEXT,
    "planId" TEXT,
    "settings" JSONB,
    "razorpayCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");
CREATE INDEX "Tenant_status_idx" ON "Tenant"("status");
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "billingInterval" TEXT NOT NULL DEFAULT 'monthly',
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT NOT NULL DEFAULT 'razorpay',
    "razorpaySubscriptionId" TEXT,
    "razorpayCustomerId" TEXT,
    "shortUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Subscription_tenantId_key" ON "Subscription"("tenantId");
CREATE UNIQUE INDEX "Subscription_razorpaySubscriptionId_key" ON "Subscription"("razorpaySubscriptionId");
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "UsageCounter" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UsageCounter_tenantId_metric_periodStart_key" ON "UsageCounter"("tenantId", "metric", "periodStart");
CREATE INDEX "UsageCounter_tenantId_idx" ON "UsageCounter"("tenantId");
ALTER TABLE "UsageCounter" ADD CONSTRAINT "UsageCounter_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'razorpay',
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadJson" JSONB,
    "signatureValid" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaymentEvent_eventId_key" ON "PaymentEvent"("eventId");
CREATE INDEX "PaymentEvent_tenantId_idx" ON "PaymentEvent"("tenantId");
CREATE INDEX "PaymentEvent_eventType_idx" ON "PaymentEvent"("eventType");

CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "razorpayInvoiceId" TEXT,
    "razorpayPaymentId" TEXT,
    "amount" DECIMAL(65,30),
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL DEFAULT 'PAID',
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "hostedUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Invoice_razorpayInvoiceId_key" ON "Invoice"("razorpayInvoiceId");
CREATE INDEX "Invoice_tenantId_idx" ON "Invoice"("tenantId");
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "TenantInvite" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TenantInvite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TenantInvite_token_key" ON "TenantInvite"("token");
CREATE INDEX "TenantInvite_tenantId_idx" ON "TenantInvite"("tenantId");
CREATE INDEX "TenantInvite_email_idx" ON "TenantInvite"("email");
ALTER TABLE "TenantInvite" ADD CONSTRAINT "TenantInvite_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 2. tenantId columns on tenant-owned tables (nullable; fail-closed scoping
--       is enforced in the application choke point) ──────────────────────────

ALTER TABLE "User" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "verifyToken" TEXT;
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

ALTER TABLE "Sector" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "Sector" ADD CONSTRAINT "Sector_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Sector_tenantId_idx" ON "Sector"("tenantId");

ALTER TABLE "Domain" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "Domain_tenantId_idx" ON "Domain"("tenantId");
ALTER TABLE "JobRequisition" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "JobRequisition_tenantId_idx" ON "JobRequisition"("tenantId");
ALTER TABLE "JobTemplate" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "JobTemplate_tenantId_idx" ON "JobTemplate"("tenantId");
ALTER TABLE "Candidate" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "Candidate_tenantId_idx" ON "Candidate"("tenantId");
ALTER TABLE "JobApplication" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "JobApplication_tenantId_idx" ON "JobApplication"("tenantId");
ALTER TABLE "CandidateList" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "CandidateList_tenantId_idx" ON "CandidateList"("tenantId");
ALTER TABLE "CandidateAssignment" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "CandidateAssignment_tenantId_idx" ON "CandidateAssignment"("tenantId");
ALTER TABLE "Resume" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "Resume_tenantId_idx" ON "Resume"("tenantId");
ALTER TABLE "Interview" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "Interview_tenantId_idx" ON "Interview"("tenantId");
ALTER TABLE "InterviewSchedule" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "InterviewSchedule_tenantId_idx" ON "InterviewSchedule"("tenantId");
ALTER TABLE "QuestionBank" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "QuestionBank_tenantId_idx" ON "QuestionBank"("tenantId");
ALTER TABLE "Question" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "Question_tenantId_idx" ON "Question"("tenantId");
ALTER TABLE "Assessment" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "Assessment_tenantId_idx" ON "Assessment"("tenantId");
ALTER TABLE "AssessmentAssignment" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "AssessmentAssignment_tenantId_idx" ON "AssessmentAssignment"("tenantId");
ALTER TABLE "PipelineNote" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "PipelineNote_tenantId_idx" ON "PipelineNote"("tenantId");
ALTER TABLE "SourcingChannel" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "SourcingChannel_tenantId_idx" ON "SourcingChannel"("tenantId");
ALTER TABLE "Referral" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "Referral_tenantId_idx" ON "Referral"("tenantId");
ALTER TABLE "Offer" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "Offer_tenantId_idx" ON "Offer"("tenantId");
ALTER TABLE "ChatbotConversation" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "ChatbotConversation_tenantId_idx" ON "ChatbotConversation"("tenantId");
ALTER TABLE "ChatbotFaq" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "ChatbotFaq_tenantId_idx" ON "ChatbotFaq"("tenantId");
ALTER TABLE "Notification" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "Notification_tenantId_idx" ON "Notification"("tenantId");
ALTER TABLE "EmailTemplate" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "EmailTemplate_tenantId_idx" ON "EmailTemplate"("tenantId");
ALTER TABLE "EmailLog" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "EmailLog_tenantId_idx" ON "EmailLog"("tenantId");
ALTER TABLE "Integration" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "Integration_tenantId_idx" ON "Integration"("tenantId");
ALTER TABLE "WebhookLog" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "WebhookLog_tenantId_idx" ON "WebhookLog"("tenantId");
ALTER TABLE "AuditLog" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");
ALTER TABLE "GdprRequest" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "GdprRequest_tenantId_idx" ON "GdprRequest"("tenantId");
ALTER TABLE "AnalyticsSnapshot" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "AnalyticsSnapshot_tenantId_idx" ON "AnalyticsSnapshot"("tenantId");
ALTER TABLE "Attachment" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "Attachment_tenantId_idx" ON "Attachment"("tenantId");

-- SystemConfiguration: widen the uniqueness to include tenantId.
ALTER TABLE "SystemConfiguration" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "SystemConfiguration_tenantId_idx" ON "SystemConfiguration"("tenantId");
DROP INDEX IF EXISTS "SystemConfiguration_key_sectorId_key";
CREATE UNIQUE INDEX "SystemConfiguration_key_tenantId_sectorId_key" ON "SystemConfiguration"("key", "tenantId", "sectorId");

-- ── 3. Backfill: legacy plan, default tenant, subscription, data ─────────────

INSERT INTO "Plan" ("id", "code", "name", "aiEnabled", "proctoringEnabled", "isActive", "updatedAt")
VALUES ('00000000-0000-4000-8000-00000000plan', 'LEGACY_ENTERPRISE', 'Legacy Enterprise (unlimited)', true, true, false, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "Tenant" ("id", "name", "slug", "status", "planId", "updatedAt")
VALUES ('00000000-0000-4000-8000-0000000000t1', 'Default Tenant', 'default', 'ACTIVE', '00000000-0000-4000-8000-00000000plan', CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "Subscription" ("id", "tenantId", "planId", "status", "provider", "currentPeriodStart", "updatedAt")
VALUES ('00000000-0000-4000-8000-0000000000s1', '00000000-0000-4000-8000-0000000000t1', '00000000-0000-4000-8000-00000000plan', 'ACTIVE', 'internal', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("tenantId") DO NOTHING;

UPDATE "User" SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "Sector" SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "Domain" SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "JobRequisition" SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "JobTemplate" SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "Candidate" SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "JobApplication" SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "CandidateList" SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "CandidateAssignment" SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "Resume" SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "Interview" SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "InterviewSchedule" SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "QuestionBank" SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "Question" SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "Assessment" SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "AssessmentAssignment" SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "PipelineNote" SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "SourcingChannel" SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "Referral" SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "Offer" SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "ChatbotConversation" SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "ChatbotFaq" SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "Notification" SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "EmailTemplate" SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "EmailLog" SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "Integration" SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "WebhookLog" SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "AuditLog" SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "GdprRequest" SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
-- SystemConfiguration rows are intentionally NOT backfilled: tenantId NULL
-- rows are PLATFORM DEFAULTS; tenants get override rows on first write.
UPDATE "AnalyticsSnapshot" SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "Attachment" SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;

-- Mark existing users as email-verified (they predate verification).
UPDATE "User" SET "emailVerifiedAt" = CURRENT_TIMESTAMP WHERE "emailVerifiedAt" IS NULL;

-- ── 4. New roles: TENANT_OWNER + PLATFORM_SUPERADMIN ─────────────────────────
INSERT INTO "Role" ("id", "name", "displayName")
VALUES (gen_random_uuid()::text, 'TENANT_OWNER', 'Tenant Owner')
ON CONFLICT ("name") DO NOTHING;
INSERT INTO "Role" ("id", "name", "displayName")
VALUES (gen_random_uuid()::text, 'PLATFORM_SUPERADMIN', 'Platform Superadmin')
ON CONFLICT ("name") DO NOTHING;

-- TENANT_OWNER inherits every permission ADMIN has (billing gates are separate).
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r2."id", rp."permissionId"
FROM "RolePermission" rp
JOIN "Role" r ON r."id" = rp."roleId" AND r."name" = 'ADMIN'
CROSS JOIN (SELECT "id" FROM "Role" WHERE "name" = 'TENANT_OWNER') r2
ON CONFLICT DO NOTHING;

-- PLATFORM_SUPERADMIN inherits every permission SUPERADMIN has.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r2."id", rp."permissionId"
FROM "RolePermission" rp
JOIN "Role" r ON r."id" = rp."roleId" AND r."name" = 'SUPERADMIN'
CROSS JOIN (SELECT "id" FROM "Role" WHERE "name" = 'PLATFORM_SUPERADMIN') r2
ON CONFLICT DO NOTHING;

-- Default tenant owner: the earliest active ADMIN/SUPERADMIN user.
UPDATE "Tenant" SET "ownerUserId" = (
  SELECT u."id" FROM "User" u
  JOIN "Role" r ON r."id" = u."roleId"
  WHERE r."name" IN ('SUPERADMIN', 'ADMIN') AND u."deletedAt" IS NULL
  ORDER BY u."createdAt" ASC LIMIT 1
)
WHERE "slug" = 'default' AND "ownerUserId" IS NULL;
