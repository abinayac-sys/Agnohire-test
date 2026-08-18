-- DropForeignKey
ALTER TABLE "ChatMessage" DROP CONSTRAINT "ChatMessage_conversationId_fkey";

-- DropForeignKey
ALTER TABLE "ChatbotConversation" DROP CONSTRAINT "ChatbotConversation_candidateId_fkey";

-- AlterTable
ALTER TABLE "QuestionBank" ADD COLUMN     "attachmentId" TEXT;

-- DropTable
DROP TABLE "ChatMessage";

-- DropTable
DROP TABLE "ChatbotConversation";

-- DropTable
DROP TABLE "ChatbotFaq";

-- CreateTable
CREATE TABLE "AiChatHistory" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "messages" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "tenantId" TEXT,
    "userId" TEXT,

    CONSTRAINT "AiChatHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiChatHistory_tenantId_idx" ON "AiChatHistory"("tenantId");

-- CreateIndex
CREATE INDEX "AiChatHistory_userId_idx" ON "AiChatHistory"("userId");

-- AddForeignKey
ALTER TABLE "QuestionBank" ADD CONSTRAINT "QuestionBank_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiChatHistory" ADD CONSTRAINT "AiChatHistory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiChatHistory" ADD CONSTRAINT "AiChatHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Give AiChatHistory the same tenant-isolation RLS policy as every other
-- tenant-scoped table (see 20260708140000_rls_phase3_policies /
-- 20260708160000_rls_phase4_enable_remaining). ChatbotConversation's policy
-- and RLS setting are dropped implicitly along with the table above.
DROP POLICY IF EXISTS tenant_isolation ON "AiChatHistory";
CREATE POLICY tenant_isolation ON "AiChatHistory"
USING (
  current_setting('app.bypass', true) = 'on'
  OR "tenantId" = current_setting('app.tenant_id', true)
  OR "tenantId" IS NULL
)
WITH CHECK (
  current_setting('app.bypass', true) = 'on'
  OR "tenantId" = current_setting('app.tenant_id', true)
  OR "tenantId" IS NULL
);
ALTER TABLE "AiChatHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiChatHistory" FORCE ROW LEVEL SECURITY;
