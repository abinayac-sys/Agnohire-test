-- SEC-2: User.email was FULLY unique (User_email_key), soft-deleted rows included.
--
-- deleteUser only soft-deletes (sets deletedAt + isActive:false) and never releases
-- the email, so a deleted user's address stayed permanently, invisibly burned:
--
--   POST /admin/users {email}  -> 201
--   DELETE /admin/users/:id    -> 200   (soft)
--   POST /admin/users {email}  -> 409 "That record already exists"
--   GET  /admin/users?search=  -> 0 results        <-- and yet nothing is there
--
-- The reason it is invisible: the soft-delete middleware (config/database.ts)
-- rewrites every read to inject `deletedAt: null`, so the dedup lookup cannot see
-- the tombstone it is about to collide with. It concludes "no such user", calls
-- create(), and the DB constraint fires as a raw P2002. Reads are filtered;
-- constraints are not.
--
-- Fix: unique among LIVE rows only, so deleting a user releases their email.
-- Email remains GLOBALLY unique across tenants — this is NOT per-tenant identity
-- (that is SEC-3 Stage 2, and it needs a login-UX decision: today login resolves a
-- user by email with no tenant discriminator, so two tenants sharing an email would
-- make `loadUser({ email })` ambiguous).
--
-- Build the new index BEFORE dropping the old one: while User_email_key still
-- exists no duplicate emails can exist at all, so the partial index is strictly
-- weaker and its creation cannot fail on existing data. (Verified pre-flight on the
-- target DB: 0 duplicate live emails.)
--
-- CONSEQUENCE for application code: multiple soft-deleted rows may now share one
-- email, and may coexist with a live one. Any "find the tombstone" lookup must
-- `ORDER BY deletedAt DESC` and take the newest, or it resurrects an arbitrary one.
--
-- CREATE INDEX CONCURRENTLY is not usable here: Prisma wraps each migration in a
-- transaction. The table is small, so the brief lock is a non-issue.

CREATE UNIQUE INDEX "User_email_active_key"
  ON "User" ("email")
  WHERE "deletedAt" IS NULL;

DROP INDEX "User_email_key";
