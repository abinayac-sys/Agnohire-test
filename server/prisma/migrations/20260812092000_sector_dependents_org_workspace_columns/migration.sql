-- Step 3 of the Tenant -> Organization -> Workspace rollout: add nullable
-- organizationId/workspaceId to every table that already carries a sectorId
-- (the "G1" group: JobRequisition, Domain, Candidate, User, Integration,
-- SystemConfiguration, QuestionBank, Assessment, JobTemplate, CandidateList,
-- EmailTemplate, AuditLog, AnalyticsSnapshot) plus five "best-effort only,
-- never auto-filtered" observability tables (Notification, WebhookLog,
-- GdprRequest, AiChatHistory, AdminNotificationState — no index, since
-- nothing queries by these columns, they just carry the value forward for
-- future reporting). See schema.prisma's doc comments on each model and the
-- next migration (...org_workspace_backfill) for how these get populated.
--
-- Every column here stays nullable forever EXCEPT JobRequisition's (tightened
-- to NOT NULL in migration 20260812094000_organization_workspace_tighten_
-- not_null, alongside Sector) — sectorId itself is optional on every other
-- table in this list, so organizationId/workspaceId can never be
-- unconditionally derived for them.
--
-- SystemConfiguration's unique index widens to include workspaceId, adding a
-- workspace tier to configService's resolution precedence chain without
-- disturbing the existing tenant+sector/tenant-global/platform tiers.

-- DropIndex
DROP INDEX "SystemConfiguration_key_tenantId_sectorId_key";

-- AlterTable
ALTER TABLE "AdminNotificationState" ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "AiChatHistory" ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "AnalyticsSnapshot" ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "CandidateList" ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "Domain" ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "EmailTemplate" ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "GdprRequest" ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "Integration" ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "JobRequisition" ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "JobTemplate" ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "QuestionBank" ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "SystemConfiguration" ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "WebhookLog" ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "workspaceId" TEXT;

-- CreateIndex
CREATE INDEX "AnalyticsSnapshot_organizationId_idx" ON "AnalyticsSnapshot"("organizationId");

-- CreateIndex
CREATE INDEX "AnalyticsSnapshot_workspaceId_idx" ON "AnalyticsSnapshot"("workspaceId");

-- CreateIndex
CREATE INDEX "Assessment_organizationId_idx" ON "Assessment"("organizationId");

-- CreateIndex
CREATE INDEX "Assessment_workspaceId_idx" ON "Assessment"("workspaceId");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_idx" ON "AuditLog"("organizationId");

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_idx" ON "AuditLog"("workspaceId");

-- CreateIndex
CREATE INDEX "Candidate_organizationId_idx" ON "Candidate"("organizationId");

-- CreateIndex
CREATE INDEX "Candidate_workspaceId_idx" ON "Candidate"("workspaceId");

-- CreateIndex
CREATE INDEX "CandidateList_organizationId_idx" ON "CandidateList"("organizationId");

-- CreateIndex
CREATE INDEX "CandidateList_workspaceId_idx" ON "CandidateList"("workspaceId");

-- CreateIndex
CREATE INDEX "Domain_organizationId_idx" ON "Domain"("organizationId");

-- CreateIndex
CREATE INDEX "Domain_workspaceId_idx" ON "Domain"("workspaceId");

-- CreateIndex
CREATE INDEX "EmailTemplate_organizationId_idx" ON "EmailTemplate"("organizationId");

-- CreateIndex
CREATE INDEX "EmailTemplate_workspaceId_idx" ON "EmailTemplate"("workspaceId");

-- CreateIndex
CREATE INDEX "Integration_organizationId_idx" ON "Integration"("organizationId");

-- CreateIndex
CREATE INDEX "Integration_workspaceId_idx" ON "Integration"("workspaceId");

-- CreateIndex
CREATE INDEX "JobRequisition_organizationId_idx" ON "JobRequisition"("organizationId");

-- CreateIndex
CREATE INDEX "JobRequisition_workspaceId_idx" ON "JobRequisition"("workspaceId");

-- CreateIndex
CREATE INDEX "JobTemplate_organizationId_idx" ON "JobTemplate"("organizationId");

-- CreateIndex
CREATE INDEX "JobTemplate_workspaceId_idx" ON "JobTemplate"("workspaceId");

-- CreateIndex
CREATE INDEX "QuestionBank_organizationId_idx" ON "QuestionBank"("organizationId");

-- CreateIndex
CREATE INDEX "QuestionBank_workspaceId_idx" ON "QuestionBank"("workspaceId");

-- CreateIndex
CREATE INDEX "SystemConfiguration_organizationId_idx" ON "SystemConfiguration"("organizationId");

-- CreateIndex
CREATE INDEX "SystemConfiguration_workspaceId_idx" ON "SystemConfiguration"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "SystemConfiguration_key_tenantId_workspaceId_sectorId_key" ON "SystemConfiguration"("key", "tenantId", "workspaceId", "sectorId");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE INDEX "User_workspaceId_idx" ON "User"("workspaceId");
