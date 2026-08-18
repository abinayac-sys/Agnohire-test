-- Production incident: a load test of ~70 concurrent staff/candidate sessions
-- hit 429 RATE_LIMITED on ordinary dashboard traffic (GET /api/candidates,
-- /api/jobs, /api/candidates/stats, etc.). Root cause: these rows were seeded
-- with an old, far-too-low value before the app was tuned to support
-- 10,000+ concurrent candidates. The application code's default was already
-- raised to 10,000,000, but that default only applies when a row is MISSING —
-- it can't correct a row that already exists with a stale low value. This
-- force-updates every existing rate-limit row (platform default AND any
-- per-tenant override) to the same safe ceiling, regardless of what's
-- currently stored, so the fix actually takes effect in already-deployed
-- environments instead of only on fresh installs.
UPDATE "SystemConfiguration"
SET "value" = '10000000'
WHERE "key" IN ('rate_limit.window_ms', 'rate_limit.max_requests', 'rate_limit.interview_max_requests');
