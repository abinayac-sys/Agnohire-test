/*
  Warnings:

  - A unique constraint covering the columns `[reToken]` on the table `OfferDocument` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "JobApplication" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OfferDocument" ADD COLUMN     "description" TEXT,
ADD COLUMN     "maxSizeInt" INTEGER,
ADD COLUMN     "reToken" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT,
ALTER COLUMN "fileUrl" DROP NOT NULL;

-- CreateTable
CREATE TABLE "BiometricReport" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "enrollmentImage" TEXT NOT NULL,
    "enrollmentTimestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "faceSignature" JSONB,
    "verificationStatus" TEXT NOT NULL DEFAULT 'VERIFIED',
    "totalChecks" INTEGER NOT NULL DEFAULT 0,
    "successfulMatches" INTEGER NOT NULL DEFAULT 0,
    "failedMatches" INTEGER NOT NULL DEFAULT 0,
    "warningsIssued" INTEGER NOT NULL DEFAULT 0,
    "noFaceEvents" INTEGER NOT NULL DEFAULT 0,
    "multipleFaceEvents" INTEGER NOT NULL DEFAULT 0,
    "matchHistory" JSONB,
    "latestImage" TEXT,

    CONSTRAINT "BiometricReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BiometricReport_interviewId_key" ON "BiometricReport"("interviewId");

-- CreateIndex
CREATE UNIQUE INDEX "OfferDocument_reToken_key" ON "OfferDocument"("reToken");

-- AddForeignKey
ALTER TABLE "BiometricReport" ADD CONSTRAINT "BiometricReport_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
