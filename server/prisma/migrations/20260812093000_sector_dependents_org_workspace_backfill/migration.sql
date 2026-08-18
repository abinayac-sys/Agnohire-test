-- Step 4 of the Tenant -> Organization -> Workspace rollout: populate the
-- nullable organizationId/workspaceId columns added in the previous migration
-- by joining each table's own sectorId back to Sector.organizationId/
-- workspaceId (already backfilled to every tenant's default org+workspace by
-- migration 20260812091000_organization_workspace_default_backfill).
--
-- Idempotent by construction (every UPDATE is guarded by
-- "organizationId" IS NULL), so it is safe to re-run — e.g. after a fresh
-- `prisma migrate reset` where seed data is created AFTER migrations run and
-- so isn't covered by the default-backfill migration's one-time pass.

-- G1: tables with a direct sectorId column.
UPDATE "JobRequisition" t SET "organizationId" = s."organizationId", "workspaceId" = s."workspaceId"
FROM "Sector" s WHERE t."sectorId" = s."id" AND t."organizationId" IS NULL;

UPDATE "Domain" t SET "organizationId" = s."organizationId", "workspaceId" = s."workspaceId"
FROM "Sector" s WHERE t."sectorId" = s."id" AND t."organizationId" IS NULL;

UPDATE "Candidate" t SET "organizationId" = s."organizationId", "workspaceId" = s."workspaceId"
FROM "Sector" s WHERE t."sectorId" = s."id" AND t."organizationId" IS NULL;

UPDATE "User" t SET "organizationId" = s."organizationId", "workspaceId" = s."workspaceId"
FROM "Sector" s WHERE t."sectorId" = s."id" AND t."organizationId" IS NULL;

UPDATE "Integration" t SET "organizationId" = s."organizationId", "workspaceId" = s."workspaceId"
FROM "Sector" s WHERE t."sectorId" = s."id" AND t."organizationId" IS NULL;

UPDATE "SystemConfiguration" t SET "organizationId" = s."organizationId", "workspaceId" = s."workspaceId"
FROM "Sector" s WHERE t."sectorId" = s."id" AND t."organizationId" IS NULL;

UPDATE "QuestionBank" t SET "organizationId" = s."organizationId", "workspaceId" = s."workspaceId"
FROM "Sector" s WHERE t."sectorId" = s."id" AND t."organizationId" IS NULL;

UPDATE "Assessment" t SET "organizationId" = s."organizationId", "workspaceId" = s."workspaceId"
FROM "Sector" s WHERE t."sectorId" = s."id" AND t."organizationId" IS NULL;

UPDATE "JobTemplate" t SET "organizationId" = s."organizationId", "workspaceId" = s."workspaceId"
FROM "Sector" s WHERE t."sectorId" = s."id" AND t."organizationId" IS NULL;

UPDATE "CandidateList" t SET "organizationId" = s."organizationId", "workspaceId" = s."workspaceId"
FROM "Sector" s WHERE t."sectorId" = s."id" AND t."organizationId" IS NULL;

UPDATE "EmailTemplate" t SET "organizationId" = s."organizationId", "workspaceId" = s."workspaceId"
FROM "Sector" s WHERE t."sectorId" = s."id" AND t."organizationId" IS NULL;

UPDATE "AuditLog" t SET "organizationId" = s."organizationId", "workspaceId" = s."workspaceId"
FROM "Sector" s WHERE t."sectorId" = s."id" AND t."organizationId" IS NULL;

UPDATE "AnalyticsSnapshot" t SET "organizationId" = s."organizationId", "workspaceId" = s."workspaceId"
FROM "Sector" s WHERE t."sectorId" = s."id" AND t."organizationId" IS NULL;

-- G3: no sectorId of their own — best-effort backfill from the nearest
-- natural anchor. WebhookLog has no such anchor at all and is intentionally
-- left NULL (see schema.prisma's doc comment on it).
UPDATE "Notification" t SET "organizationId" = u."organizationId", "workspaceId" = u."workspaceId"
FROM "User" u WHERE t."recipientId" = u."id" AND t."organizationId" IS NULL;

UPDATE "AdminNotificationState" t SET "organizationId" = u."organizationId", "workspaceId" = u."workspaceId"
FROM "User" u WHERE t."adminId" = u."id" AND t."organizationId" IS NULL;

UPDATE "AiChatHistory" t SET "organizationId" = u."organizationId", "workspaceId" = u."workspaceId"
FROM "User" u WHERE t."userId" = u."id" AND t."organizationId" IS NULL;

UPDATE "GdprRequest" t SET "organizationId" = c."organizationId", "workspaceId" = c."workspaceId"
FROM "Candidate" c WHERE t."candidateId" = c."id" AND t."organizationId" IS NULL;
