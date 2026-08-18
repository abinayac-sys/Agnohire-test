-- RLS Phase 1: a restricted application role.
--
-- The app must NOT connect as a superuser/BYPASSRLS/owner role, or Row-Level
-- Security is bypassed and provides no protection. This role can read/write
-- data but cannot bypass RLS and does not own the tables. Migrations continue
-- to run as the owner (via datasource `directUrl`).
--
-- Idempotent: safe to re-run. The password here is a LOCAL/dev default; in
-- real environments set it out-of-band (ALTER ROLE ... PASSWORD) and never
-- commit the real secret.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agnohire_app') THEN
    CREATE ROLE agnohire_app LOGIN PASSWORD 'agnohire_app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO agnohire_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO agnohire_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO agnohire_app;

-- Future tables/sequences created by the owner are auto-granted to the app role.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO agnohire_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO agnohire_app;
