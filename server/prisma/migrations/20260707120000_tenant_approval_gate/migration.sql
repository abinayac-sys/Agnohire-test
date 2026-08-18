-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "approvalNotes" TEXT,
ADD COLUMN     "approvalStatus" TEXT NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "phone" TEXT;

-- CreateIndex
CREATE INDEX "Tenant_approvalStatus_idx" ON "Tenant"("approvalStatus");

