-- Sector.name, Domain.name, and QuestionBank.name had zero uniqueness
-- enforcement, app-level or DB-level. Add real DB-level guards, scoped per
-- tenant (matching the Candidate.email pattern) and excluding soft-deleted
-- rows so a previously deleted name can be reused.
--
-- No backfill of pre-existing duplicates is included here: the target
-- database was checked directly and has zero duplicate Sector/Domain/
-- QuestionBank names under these scopes as of this migration, so a rename
-- pass would be a no-op.
--
-- Sector/Domain are case-insensitive to match resolveSectorId()/
-- resolveDomainId()'s own case-insensitive name lookups (used wherever a
-- tool/AI agent resolves e.g. "IT" or "Backend" by name instead of by id) —
-- a case-sensitive constraint alone would still leave "IT" and "it"
-- resolving ambiguously. This does NOT touch, alter, or replace the
-- existing organizationId/workspaceId columns or RLS policies on Sector/
-- Domain; it only adds a uniqueness constraint on top of that shape.
CREATE UNIQUE INDEX IF NOT EXISTS "Sector_tenantId_name_ci_active_key"
  ON "Sector" ("tenantId", lower("name"))
  WHERE "deletedAt" IS NULL;

-- sectorId is nullable; NULLs are not equal to each other under standard
-- unique-index semantics, so domains with no sector are not deduplicated
-- against one another — acceptable, they aren't organized under anything.
CREATE UNIQUE INDEX IF NOT EXISTS "Domain_tenantId_sectorId_name_ci_active_key"
  ON "Domain" ("tenantId", "sectorId", lower("name"))
  WHERE "deletedAt" IS NULL;

-- QuestionBank is case-sensitive (unlike Sector/Domain above) — it has no
-- equivalent case-insensitive name-resolution lookup to match.
CREATE UNIQUE INDEX IF NOT EXISTS "QuestionBank_tenantId_name_active_key"
  ON "QuestionBank" ("tenantId", "name")
  WHERE "deletedAt" IS NULL;
