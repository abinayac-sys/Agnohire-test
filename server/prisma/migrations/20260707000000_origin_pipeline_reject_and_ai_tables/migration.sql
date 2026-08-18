-- AlterTable
ALTER TABLE "JobApplication" ADD COLUMN     "rejectedRound" TEXT,
ADD COLUMN     "rejectionReason" TEXT;

-- CreateTable
CREATE TABLE "AiPromptTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiPromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiToolUsage" (
    "id" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT,
    "durationMs" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "errorMsg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiToolUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiTokenLog" (
    "id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "costUsd" DOUBLE PRECISION,
    "userId" TEXT,
    "sessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiTokenLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiPromptTemplate_key_key" ON "AiPromptTemplate"("key");

-- CreateIndex
CREATE INDEX "AiToolUsage_toolName_idx" ON "AiToolUsage"("toolName");

-- CreateIndex
CREATE INDEX "AiToolUsage_userId_idx" ON "AiToolUsage"("userId");

-- CreateIndex
CREATE INDEX "AiTokenLog_userId_idx" ON "AiTokenLog"("userId");

