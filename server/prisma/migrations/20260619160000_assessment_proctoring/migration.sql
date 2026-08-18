-- AlterTable
ALTER TABLE "AssessmentAssignment" ADD COLUMN     "violations" JSONB,
ADD COLUMN     "terminatedReason" TEXT,
ADD COLUMN     "recordingUrl" TEXT,
ADD COLUMN     "transcript" TEXT;

-- CreateTable
CREATE TABLE "AssessmentProctorShot" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'PERIODIC',
    "note" TEXT,
    "mimeType" TEXT NOT NULL DEFAULT 'image/jpeg',
    "imageData" BYTEA NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentProctorShot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssessmentProctorShot_assignmentId_idx" ON "AssessmentProctorShot"("assignmentId");

-- AddForeignKey
ALTER TABLE "AssessmentProctorShot" ADD CONSTRAINT "AssessmentProctorShot_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "AssessmentAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
