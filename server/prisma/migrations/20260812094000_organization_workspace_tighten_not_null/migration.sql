-- Step 5 of the Tenant -> Organization -> Workspace rollout (mirrors
-- 20260703000001_tenant_not_null_tightening's own precedent for tenantId):
-- tighten organizationId/workspaceId to NOT NULL on Sector and JobRequisition
-- only. Every other table touched by the previous two migrations stays
-- nullable permanently — their sectorId is itself optional, so
-- organizationId/workspaceId can never be unconditionally derived for them.
--
-- Safety re-check before tightening: if either UPDATE below matches any row,
-- the migration fails loudly on the NOT NULL constraint that follows instead
-- of silently truncating data — same "verify then tighten" order the
-- historical tenantId rollout used.

UPDATE "Sector" s SET "organizationId" = d."organizationId", "workspaceId" = d."workspaceId"
FROM (
  SELECT o."tenantId" AS tenant_id, o."id" AS "organizationId", w."id" AS "workspaceId"
  FROM "Organization" o
  JOIN "Workspace" w ON w."organizationId" = o."id"
  WHERE o."slug" = 'default' AND w."slug" = 'default'
) d
WHERE d.tenant_id = s."tenantId" AND s."organizationId" IS NULL;

UPDATE "JobRequisition" t SET "organizationId" = s."organizationId", "workspaceId" = s."workspaceId"
FROM "Sector" s WHERE t."sectorId" = s."id" AND t."organizationId" IS NULL;

-- AlterTable
ALTER TABLE "Sector" ALTER COLUMN "organizationId" SET NOT NULL,
ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "JobRequisition" ALTER COLUMN "organizationId" SET NOT NULL,
ALTER COLUMN "workspaceId" SET NOT NULL;
