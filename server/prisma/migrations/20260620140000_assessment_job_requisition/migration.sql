-- Add optional job requisition link to assessments (used to filter assignments
-- by the role/job the assessment screens for, and to drive result-email tabs).
ALTER TABLE "Assessment" ADD COLUMN "jobRequisitionId" TEXT;
CREATE INDEX "Assessment_jobRequisitionId_idx" ON "Assessment"("jobRequisitionId");
