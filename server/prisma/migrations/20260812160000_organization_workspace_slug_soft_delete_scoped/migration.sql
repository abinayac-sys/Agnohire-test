-- Organization.slug and Workspace.slug were unique on the plain columns,
-- which makes a soft-deleted row permanently squat its slug — deleting
-- "acme" and trying to create a new "acme" fails forever, even though the
-- deleted row is invisible everywhere else. Same bug this repo already fixed
-- once for Candidate.email (see 20260708120000_candidate_email_tenant_scoped)
-- and the same fix: replace the plain unique index with a partial one scoped
-- to live rows only.

DROP INDEX "Organization_tenantId_slug_key";
CREATE UNIQUE INDEX "Organization_tenantId_slug_active_key"
  ON "Organization" ("tenantId", "slug")
  WHERE "deletedAt" IS NULL;

DROP INDEX "Workspace_organizationId_slug_key";
CREATE UNIQUE INDEX "Workspace_organizationId_slug_active_key"
  ON "Workspace" ("organizationId", "slug")
  WHERE "deletedAt" IS NULL;
