-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "jobRequisitionId" TEXT;

-- AlterTable
ALTER TABLE "Interview" ADD COLUMN     "jobRequisitionId" TEXT;

-- AlterTable
ALTER TABLE "InterviewResult" ADD COLUMN     "confidenceScore" DOUBLE PRECISION,
ADD COLUMN     "culturalFitScore" DOUBLE PRECISION,
ADD COLUMN     "domainKnowledgeScore" DOUBLE PRECISION,
ADD COLUMN     "generatedAt" TIMESTAMP(3),
ADD COLUMN     "improvements" TEXT,
ADD COLUMN     "problemSolvingScore" DOUBLE PRECISION,
ADD COLUMN     "strengths" TEXT,
ADD COLUMN     "technicalScore" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "CandidateAnswer" ADD COLUMN     "aiImprovements" TEXT,
ADD COLUMN     "aiReasoning" TEXT,
ADD COLUMN     "aiStrengths" TEXT;

-- CreateIndex
CREATE INDEX "Candidate_jobRequisitionId_idx" ON "Candidate"("jobRequisitionId");

-- CreateIndex
CREATE INDEX "Interview_jobRequisitionId_idx" ON "Interview"("jobRequisitionId");

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_jobRequisitionId_fkey" FOREIGN KEY ("jobRequisitionId") REFERENCES "JobRequisition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_jobRequisitionId_fkey" FOREIGN KEY ("jobRequisitionId") REFERENCES "JobRequisition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
