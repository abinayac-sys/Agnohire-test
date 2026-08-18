-- AlterTable
ALTER TABLE "InterviewResult" ADD COLUMN     "hrApprovedAt" TIMESTAMP(3),
ADD COLUMN     "hrApprovedById" TEXT,
ADD COLUMN     "hrRemarks" TEXT,
ADD COLUMN     "hrStatus" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "interviewerComments" TEXT,
ADD COLUMN     "recommendedPosition" TEXT,
ADD COLUMN     "recommendedSalary" DECIMAL(65,30);

-- AlterTable
ALTER TABLE "InterviewSchedule" ADD COLUMN     "inviteStatus" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "meetingProvider" TEXT NOT NULL DEFAULT 'GOOGLE_MEET';

-- AlterTable
ALTER TABLE "JobApplication" ADD COLUMN     "completedRounds" JSONB,
ADD COLUMN     "currentRound" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "failedRound" INTEGER,
ADD COLUMN     "workflowStatus" TEXT NOT NULL DEFAULT 'IN_PROGRESS';

-- AlterTable
ALTER TABLE "JobTemplate" ADD COLUMN     "headcount" INTEGER,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "sectorId" TEXT,
ADD COLUMN     "workflowRounds" JSONB;

-- CreateTable
CREATE TABLE "InterviewWorkflowRound" (
    "id" TEXT NOT NULL,
    "jobRequisitionId" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "roundName" TEXT NOT NULL,
    "roundType" TEXT NOT NULL,
    "passPercentage" DOUBLE PRECISION,
    "sequenceOrder" INTEGER NOT NULL,
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "autoProgression" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "InterviewWorkflowRound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InterviewWorkflowRound_jobRequisitionId_idx" ON "InterviewWorkflowRound"("jobRequisitionId");

-- CreateIndex
CREATE INDEX "JobTemplate_sectorId_idx" ON "JobTemplate"("sectorId");

-- AddForeignKey
ALTER TABLE "InterviewWorkflowRound" ADD CONSTRAINT "InterviewWorkflowRound_jobRequisitionId_fkey" FOREIGN KEY ("jobRequisitionId") REFERENCES "JobRequisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

