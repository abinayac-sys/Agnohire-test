-- Assessments management was never wired into the product UI; the
-- maxAssessments plan limit and its quota counter are being removed.
ALTER TABLE "Plan" DROP COLUMN "maxAssessments";
