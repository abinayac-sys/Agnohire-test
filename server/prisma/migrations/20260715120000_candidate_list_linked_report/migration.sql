-- Bulk-import UX: checkCandidateDuplicate (bulkUploadService.ts) silently
-- reuses an existing candidate when a row matches by email/phone/resume/
-- LinkedIn/GitHub — correct behaviour (a person shouldn't be duplicated
-- because they appear in two source files), but previously gave zero
-- visibility into it. A second CSV that happens to overlap with an earlier
-- one (a very common real-world case: re-exported lists, the same candidate
-- sourced from two channels) would show familiar names in the "just
-- imported" results with no indication they weren't new — easy to mistake
-- for the app re-displaying a previous import's content.
--
-- Track linked-vs-new explicitly, mirroring the existing errorCount/
-- errorReport pattern.

ALTER TABLE "CandidateList"
  ADD COLUMN "linkedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "linkedReport" JSONB;
