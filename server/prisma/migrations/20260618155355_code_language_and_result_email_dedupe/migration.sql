-- AlterTable
ALTER TABLE "InterviewResult" ADD COLUMN     "resultEmailedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CandidateAnswer" ADD COLUMN     "language" TEXT;

-- AlterTable
ALTER TABLE "AssessmentAnswer" ADD COLUMN     "language" TEXT;
