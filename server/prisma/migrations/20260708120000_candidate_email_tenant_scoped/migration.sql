-- Candidate.email was globally unique, which made it impossible for two
-- tenants to hold the same candidate: a second tenant's create hit the global
-- unique index and failed with a raw P2002 even though the per-tenant dedup
-- lookup (auto-scoped by the tenant middleware) found nothing to reuse.
--
-- Replace the global unique index with a per-tenant partial unique index that
-- also excludes soft-deleted rows, so:
--   * two tenants may independently store the same email, and
--   * within a tenant, a previously soft-deleted email can be re-created
--     (the restore path still reuses the row when present, but is no longer
--     required for correctness).
--
-- NOTE: rows with tenantId IS NULL (public/legacy, pre-SaaS token flows) are
-- NULL-distinct under this index and therefore not deduplicated at the DB
-- level; those paths dedupe in application code.

DROP INDEX "Candidate_email_key";

CREATE UNIQUE INDEX "Candidate_tenantId_email_active_key"
  ON "Candidate" ("tenantId", "email")
  WHERE "deletedAt" IS NULL;
