-- Step 2 of the Tenant -> Organization -> Workspace rollout: give every
-- existing Tenant exactly one default Organization + one default Workspace,
-- point every existing Sector at it, and make every existing User (via a
-- membership row) a member of both — so no existing tenant, sector, or user
-- needs any manual migration action, and every pre-existing single-tenant
-- flow continues to resolve to the one and only workspace it has always
-- effectively been operating in.
--
-- Container-role mapping (OrganizationMember.role / WorkspaceMember.role):
-- TENANT_OWNER/ADMIN, who already administer the whole tenant today, become
-- ORG_ADMIN/WORKSPACE_ADMIN of the default org/workspace; every other role
-- becomes a plain ORG_MEMBER/WORKSPACE_MEMBER. This is a separate, additive
-- dimension from the user's existing functional Role (HR/RECRUITER/etc, which
-- this migration does not touch) — see schema.prisma's OrganizationMember/
-- WorkspaceMember doc comments.
--
-- SUPERADMIN users (tenantId IS NULL) are intentionally excluded: they are
-- cross-tenant platform operators, not members of any one tenant's default
-- workspace, and workspaceMembershipService.canAccessWorkspace already grants
-- them access to every workspace by role, without needing a membership row.

-- 1. One default Organization per existing Tenant.
INSERT INTO "Organization" ("id", "tenantId", "name", "slug", "isActive", "updatedAt")
SELECT gen_random_uuid()::text, t."id", t."name" || ' — Default Organization', 'default', true, CURRENT_TIMESTAMP
FROM "Tenant" t
WHERE NOT EXISTS (
  SELECT 1 FROM "Organization" o WHERE o."tenantId" = t."id" AND o."slug" = 'default'
);

-- 2. One default Workspace per default Organization.
INSERT INTO "Workspace" ("id", "tenantId", "organizationId", "name", "slug", "isActive", "updatedAt")
SELECT gen_random_uuid()::text, o."tenantId", o."id", 'Default Workspace', 'default', true, CURRENT_TIMESTAMP
FROM "Organization" o
WHERE o."slug" = 'default'
  AND NOT EXISTS (
    SELECT 1 FROM "Workspace" w WHERE w."organizationId" = o."id" AND w."slug" = 'default'
  );

-- 3. Point every existing Sector at its tenant's default org+workspace.
WITH default_ws AS (
  SELECT o."tenantId" AS tenant_id, o."id" AS organization_id, w."id" AS workspace_id
  FROM "Organization" o
  JOIN "Workspace" w ON w."organizationId" = o."id"
  WHERE o."slug" = 'default' AND w."slug" = 'default'
)
UPDATE "Sector" s
SET "organizationId" = d.organization_id, "workspaceId" = d.workspace_id
FROM default_ws d
WHERE d.tenant_id = s."tenantId" AND s."organizationId" IS NULL;

-- 4. Membership backfill: every existing user becomes a member of their
--    tenant's default org+workspace.
WITH default_ws AS (
  SELECT o."tenantId" AS tenant_id, o."id" AS organization_id, w."id" AS workspace_id
  FROM "Organization" o
  JOIN "Workspace" w ON w."organizationId" = o."id"
  WHERE o."slug" = 'default' AND w."slug" = 'default'
),
user_role AS (
  SELECT u."id" AS user_id, u."tenantId" AS tenant_id, r."name" AS role_name
  FROM "User" u
  JOIN "Role" r ON r."id" = u."roleId"
  WHERE u."tenantId" IS NOT NULL AND u."deletedAt" IS NULL
)
INSERT INTO "OrganizationMember" ("id", "organizationId", "tenantId", "userId", "role", "updatedAt")
SELECT gen_random_uuid()::text, d.organization_id, ur.tenant_id, ur.user_id,
       CASE WHEN ur.role_name IN ('TENANT_OWNER', 'ADMIN') THEN 'ORG_ADMIN' ELSE 'ORG_MEMBER' END,
       CURRENT_TIMESTAMP
FROM user_role ur
JOIN default_ws d ON d.tenant_id = ur.tenant_id
ON CONFLICT ("organizationId", "userId") DO NOTHING;

WITH default_ws AS (
  SELECT o."tenantId" AS tenant_id, o."id" AS organization_id, w."id" AS workspace_id
  FROM "Organization" o
  JOIN "Workspace" w ON w."organizationId" = o."id"
  WHERE o."slug" = 'default' AND w."slug" = 'default'
),
user_role AS (
  SELECT u."id" AS user_id, u."tenantId" AS tenant_id, r."name" AS role_name
  FROM "User" u
  JOIN "Role" r ON r."id" = u."roleId"
  WHERE u."tenantId" IS NOT NULL AND u."deletedAt" IS NULL
)
INSERT INTO "WorkspaceMember" ("id", "workspaceId", "tenantId", "userId", "role", "updatedAt")
SELECT gen_random_uuid()::text, d.workspace_id, ur.tenant_id, ur.user_id,
       CASE WHEN ur.role_name IN ('TENANT_OWNER', 'ADMIN') THEN 'WORKSPACE_ADMIN' ELSE 'WORKSPACE_MEMBER' END,
       CURRENT_TIMESTAMP
FROM user_role ur
JOIN default_ws d ON d.tenant_id = ur.tenant_id
ON CONFLICT ("workspaceId", "userId") DO NOTHING;
