-- AlterTable
ALTER TABLE "EmailLog" ADD COLUMN     "entityId" TEXT,
ADD COLUMN     "entityType" TEXT;

-- CreateIndex
CREATE INDEX "EmailLog_entityType_entityId_templateId_status_idx" ON "EmailLog"("entityType", "entityId", "templateId", "status");

-- CreateIndex
CREATE INDEX "EmailLog_toEmail_templateId_status_idx" ON "EmailLog"("toEmail", "templateId", "status");
