-- RLS Phase 4 (staged): enable Row-Level Security on Candidate only.
--
-- Candidate is rolled out first (per the RLS plan) because every path that
-- touches it establishes tenant context: authenticated requests (auth
-- middleware), public token routes (publicTenantScope middleware), and Bull
-- workers (runJobInTenant). The owner role (agnohire, superuser) bypasses RLS,
-- so migrations and seed are unaffected; only the restricted app role is bound.
--
-- FORCE covers the table owner too (harmless here since the owner is a
-- superuser and bypasses RLS regardless). Instantly reversible:
--   ALTER TABLE "Candidate" DISABLE ROW LEVEL SECURITY;
--
-- Remaining TENANT_MODELS tables (esp. User, which is queried by email before a
-- tenant context exists during login) are enabled in later migrations once
-- their pre-auth / platform-job access paths set bypass context.

ALTER TABLE "Candidate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Candidate" FORCE ROW LEVEL SECURITY;
