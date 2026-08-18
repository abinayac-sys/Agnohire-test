-- Adds three InterviewResult columns that existed in schema.prisma but were
-- never captured in a migration, so any DB built purely from `migrate deploy`
-- was missing them. The generated Prisma client selects these on every
-- interview read (getInterview includes `result`), so their absence made
-- interview creation/read crash with a 500 ("column ... does not exist"),
-- which surfaced in the UI as "generate link is not working".
--
-- Idempotent (IF NOT EXISTS) so it is safe on databases that were manually
-- patched with `prisma db push` before this migration existed.

ALTER TABLE "InterviewResult" ADD COLUMN IF NOT EXISTS "failureReason" TEXT;
ALTER TABLE "InterviewResult" ADD COLUMN IF NOT EXISTS "recommendedLearning" TEXT;
ALTER TABLE "InterviewResult" ADD COLUMN IF NOT EXISTS "feedbackPdfPath" TEXT;
