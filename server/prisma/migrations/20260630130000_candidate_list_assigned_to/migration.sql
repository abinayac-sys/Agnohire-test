-- Bulk-import assignment feature: the candidate list can be assigned to a user
-- at upload time. Added to schema.prisma without a migration originally (db push),
-- so teammates running `prisma migrate deploy` were missing the column and bulk
-- upload failed. IF NOT EXISTS keeps this safe on DBs that already have it.
ALTER TABLE "CandidateList" ADD COLUMN IF NOT EXISTS "assignedTo" TEXT;
