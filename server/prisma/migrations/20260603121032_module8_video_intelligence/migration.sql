-- AlterTable
ALTER TABLE "Interview" ADD COLUMN     "transcript" TEXT;

-- AlterTable
ALTER TABLE "InterviewResult" ADD COLUMN     "recommendation" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "reviewerNotes" TEXT,
ADD COLUMN     "transcriptSummary" TEXT;
