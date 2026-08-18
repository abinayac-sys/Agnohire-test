-- AlterTable
ALTER TABLE "Interview" ADD COLUMN     "terminatedReason" TEXT;

-- CreateTable
CREATE TABLE "ProctorShot" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'PERIODIC',
    "note" TEXT,
    "mimeType" TEXT NOT NULL DEFAULT 'image/jpeg',
    "imageData" BYTEA NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProctorShot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProctorShot_interviewId_idx" ON "ProctorShot"("interviewId");

-- AddForeignKey
ALTER TABLE "ProctorShot" ADD CONSTRAINT "ProctorShot_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
