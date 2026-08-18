-- AlterTable
ALTER TABLE "Resume" ADD COLUMN     "fileData" BYTEA,
ADD COLUMN     "parseError" TEXT,
ADD COLUMN     "parseStatus" TEXT NOT NULL DEFAULT 'PENDING';
