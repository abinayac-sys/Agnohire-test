-- Tighten tenantId to NOT NULL on tables whose rows are only ever created in
-- an authenticated (tenant-stamped) context. Deliberately conservative:
-- tables that public/token or OAuth flows can create rows in (User, Candidate,
-- Interview children, EmailLog, Attachment, Notification, logs, config, ...)
-- stay nullable and remain protected by the fail-closed choke point.
--
-- Step 1: safety backfill — any stray NULLs (rows created between the SaaS
-- migration and this one by boot/system paths) go to the default tenant.

UPDATE "Sector"         SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "Domain"         SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "JobRequisition" SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "JobTemplate"    SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "QuestionBank"   SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "Question"       SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "Assessment"     SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;
UPDATE "CandidateList"  SET "tenantId" = '00000000-0000-4000-8000-0000000000t1' WHERE "tenantId" IS NULL;

-- Step 2: tighten.
ALTER TABLE "Sector"         ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Domain"         ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "JobRequisition" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "JobTemplate"    ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "QuestionBank"   ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Question"       ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Assessment"     ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "CandidateList"  ALTER COLUMN "tenantId" SET NOT NULL;
