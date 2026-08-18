/*
  Warnings:

  - You are about to drop the `AiTokenLog` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `AiToolUsage` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "CommunicationChannelType" AS ENUM ('GENERAL', 'ANNOUNCEMENT', 'DEPARTMENT', 'TEAM', 'PROJECT', 'DIRECT', 'JOB_DISCUSSION', 'INTERVIEW_ROOM', 'CANDIDATE_PORTAL');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "CommunicationChannelRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "CommunicationMessageType" AS ENUM ('TEXT', 'EMOJI', 'GIF', 'IMAGE', 'VIDEO', 'FILE', 'AUDIO', 'VOICE_NOTE');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "CommunicationCallType" AS ENUM ('AUDIO', 'VIDEO', 'SCREEN');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "CommunicationCallStatus" AS ENUM ('INITIATED', 'ONGOING', 'ENDED', 'MISSED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "CommunicationPresenceStatus" AS ENUM ('ONLINE', 'AWAY', 'BUSY', 'INVISIBLE', 'OFFLINE');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- DropTable
DROP TABLE IF EXISTS "AiTokenLog";

-- DropTable
DROP TABLE IF EXISTS "AiToolUsage";

-- CreateTable
CREATE TABLE "AiUsageLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT,
    "sessionId" TEXT,
    "feature" TEXT NOT NULL,
    "agentName" TEXT,
    "toolName" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "costUsd" DECIMAL(65,30),
    "billable" BOOLEAN NOT NULL DEFAULT false,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errorMsg" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationHub" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationHub_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationChannel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "commHubId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CommunicationChannelType" NOT NULL DEFAULT 'GENERAL',
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CommunicationChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationChannelMember" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "CommunicationChannelRole" NOT NULL DEFAULT 'MEMBER',
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationChannelMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationMessage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelId" TEXT,
    "dmPairId" TEXT,
    "senderId" TEXT NOT NULL,
    "content" TEXT,
    "type" "CommunicationMessageType" NOT NULL DEFAULT 'TEXT',
    "mediaUrl" TEXT,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "replyToId" TEXT,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "isStarred" BOOLEAN NOT NULL DEFAULT false,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationReaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationThread" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "parentMessageId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationCall" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "commHubId" TEXT NOT NULL,
    "channelId" TEXT,
    "callerId" TEXT NOT NULL,
    "type" "CommunicationCallType" NOT NULL DEFAULT 'AUDIO',
    "status" "CommunicationCallStatus" NOT NULL DEFAULT 'INITIATED',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationCallParticipant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'JOINED',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "CommunicationCallParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationPresence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "CommunicationPresenceStatus" NOT NULL DEFAULT 'ONLINE',
    "customStatus" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationPresence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationDevice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pushToken" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'WEB',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationMessageStatus" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DELIVERED',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationMessageStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationAiSummary" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelId" TEXT,
    "callId" TEXT,
    "summary" TEXT NOT NULL,
    "actionItems" TEXT,
    "highlights" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationAiSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationMeeting" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "commHubId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "meetingLink" TEXT,
    "interviewId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationNote" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "meetingId" TEXT,
    "channelId" TEXT,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastEditedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "messageId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'TODO',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "dueDate" TIMESTAMP(3),
    "assigneeId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunicationSettings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "notificationSound" BOOLEAN NOT NULL DEFAULT true,
    "desktopNotifications" BOOLEAN NOT NULL DEFAULT true,
    "defaultStatus" TEXT NOT NULL DEFAULT 'ONLINE',
    "theme" TEXT NOT NULL DEFAULT 'LIGHT',
    "autoJoinMeetings" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateTimelineEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "eventType" TEXT NOT NULL DEFAULT 'SYSTEM',
    "metadata" JSONB,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateTimelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationWorkflow" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "trigger" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationAction" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AutomationAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiUsageLog_tenantId_createdAt_idx" ON "AiUsageLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsageLog_feature_createdAt_idx" ON "AiUsageLog"("feature", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsageLog_sessionId_idx" ON "AiUsageLog"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationHub_tenantId_key" ON "CommunicationHub"("tenantId");

-- CreateIndex
CREATE INDEX "CommunicationHub_tenantId_idx" ON "CommunicationHub"("tenantId");

-- CreateIndex
CREATE INDEX "CommunicationChannel_tenantId_idx" ON "CommunicationChannel"("tenantId");

-- CreateIndex
CREATE INDEX "CommunicationChannel_commHubId_idx" ON "CommunicationChannel"("commHubId");

-- CreateIndex
CREATE INDEX "CommunicationChannel_createdById_idx" ON "CommunicationChannel"("createdById");

-- CreateIndex
CREATE INDEX "CommunicationChannelMember_tenantId_idx" ON "CommunicationChannelMember"("tenantId");

-- CreateIndex
CREATE INDEX "CommunicationChannelMember_channelId_idx" ON "CommunicationChannelMember"("channelId");

-- CreateIndex
CREATE INDEX "CommunicationChannelMember_userId_idx" ON "CommunicationChannelMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationChannelMember_channelId_userId_key" ON "CommunicationChannelMember"("channelId", "userId");

-- CreateIndex
CREATE INDEX "CommunicationMessage_tenantId_idx" ON "CommunicationMessage"("tenantId");

-- CreateIndex
CREATE INDEX "CommunicationMessage_channelId_idx" ON "CommunicationMessage"("channelId");

-- CreateIndex
CREATE INDEX "CommunicationMessage_dmPairId_idx" ON "CommunicationMessage"("dmPairId");

-- CreateIndex
CREATE INDEX "CommunicationMessage_senderId_idx" ON "CommunicationMessage"("senderId");

-- CreateIndex
CREATE INDEX "CommunicationMessage_replyToId_idx" ON "CommunicationMessage"("replyToId");

-- CreateIndex
CREATE INDEX "CommunicationReaction_tenantId_idx" ON "CommunicationReaction"("tenantId");

-- CreateIndex
CREATE INDEX "CommunicationReaction_messageId_idx" ON "CommunicationReaction"("messageId");

-- CreateIndex
CREATE INDEX "CommunicationReaction_userId_idx" ON "CommunicationReaction"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationReaction_messageId_userId_emoji_key" ON "CommunicationReaction"("messageId", "userId", "emoji");

-- CreateIndex
CREATE INDEX "CommunicationThread_tenantId_idx" ON "CommunicationThread"("tenantId");

-- CreateIndex
CREATE INDEX "CommunicationThread_parentMessageId_idx" ON "CommunicationThread"("parentMessageId");

-- CreateIndex
CREATE INDEX "CommunicationThread_messageId_idx" ON "CommunicationThread"("messageId");

-- CreateIndex
CREATE INDEX "CommunicationCall_tenantId_idx" ON "CommunicationCall"("tenantId");

-- CreateIndex
CREATE INDEX "CommunicationCall_commHubId_idx" ON "CommunicationCall"("commHubId");

-- CreateIndex
CREATE INDEX "CommunicationCall_channelId_idx" ON "CommunicationCall"("channelId");

-- CreateIndex
CREATE INDEX "CommunicationCall_callerId_idx" ON "CommunicationCall"("callerId");

-- CreateIndex
CREATE INDEX "CommunicationCallParticipant_tenantId_idx" ON "CommunicationCallParticipant"("tenantId");

-- CreateIndex
CREATE INDEX "CommunicationCallParticipant_callId_idx" ON "CommunicationCallParticipant"("callId");

-- CreateIndex
CREATE INDEX "CommunicationCallParticipant_userId_idx" ON "CommunicationCallParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationCallParticipant_callId_userId_key" ON "CommunicationCallParticipant"("callId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationPresence_userId_key" ON "CommunicationPresence"("userId");

-- CreateIndex
CREATE INDEX "CommunicationPresence_tenantId_idx" ON "CommunicationPresence"("tenantId");

-- CreateIndex
CREATE INDEX "CommunicationPresence_userId_idx" ON "CommunicationPresence"("userId");

-- CreateIndex
CREATE INDEX "CommunicationDevice_tenantId_idx" ON "CommunicationDevice"("tenantId");

-- CreateIndex
CREATE INDEX "CommunicationDevice_userId_idx" ON "CommunicationDevice"("userId");

-- CreateIndex
CREATE INDEX "CommunicationMessageStatus_tenantId_idx" ON "CommunicationMessageStatus"("tenantId");

-- CreateIndex
CREATE INDEX "CommunicationMessageStatus_messageId_idx" ON "CommunicationMessageStatus"("messageId");

-- CreateIndex
CREATE INDEX "CommunicationMessageStatus_userId_idx" ON "CommunicationMessageStatus"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationMessageStatus_messageId_userId_key" ON "CommunicationMessageStatus"("messageId", "userId");

-- CreateIndex
CREATE INDEX "CommunicationAiSummary_callId_idx" ON "CommunicationAiSummary"("callId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationMeeting_interviewId_key" ON "CommunicationMeeting"("interviewId");

-- CreateIndex
CREATE INDEX "CommunicationMeeting_tenantId_idx" ON "CommunicationMeeting"("tenantId");

-- CreateIndex
CREATE INDEX "CommunicationMeeting_commHubId_idx" ON "CommunicationMeeting"("commHubId");

-- CreateIndex
CREATE INDEX "CommunicationNote_tenantId_idx" ON "CommunicationNote"("tenantId");

-- CreateIndex
CREATE INDEX "CommunicationNote_meetingId_idx" ON "CommunicationNote"("meetingId");

-- CreateIndex
CREATE INDEX "CommunicationNote_channelId_idx" ON "CommunicationNote"("channelId");

-- CreateIndex
CREATE INDEX "CommunicationTask_tenantId_idx" ON "CommunicationTask"("tenantId");

-- CreateIndex
CREATE INDEX "CommunicationTask_messageId_idx" ON "CommunicationTask"("messageId");

-- CreateIndex
CREATE INDEX "CommunicationTask_assigneeId_idx" ON "CommunicationTask"("assigneeId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationSettings_userId_key" ON "CommunicationSettings"("userId");

-- CreateIndex
CREATE INDEX "CommunicationSettings_tenantId_idx" ON "CommunicationSettings"("tenantId");

-- CreateIndex
CREATE INDEX "CommunicationSettings_userId_idx" ON "CommunicationSettings"("userId");

-- CreateIndex
CREATE INDEX "CandidateTimelineEvent_tenantId_idx" ON "CandidateTimelineEvent"("tenantId");

-- CreateIndex
CREATE INDEX "CandidateTimelineEvent_candidateId_idx" ON "CandidateTimelineEvent"("candidateId");

-- CreateIndex
CREATE INDEX "AutomationWorkflow_tenantId_trigger_isActive_idx" ON "AutomationWorkflow"("tenantId", "trigger", "isActive");

-- CreateIndex
CREATE INDEX "AutomationLog_tenantId_idx" ON "AutomationLog"("tenantId");

-- AddForeignKey
ALTER TABLE "CommunicationChannel" ADD CONSTRAINT "CommunicationChannel_commHubId_fkey" FOREIGN KEY ("commHubId") REFERENCES "CommunicationHub"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationChannelMember" ADD CONSTRAINT "CommunicationChannelMember_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "CommunicationChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationMessage" ADD CONSTRAINT "CommunicationMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationMessage" ADD CONSTRAINT "CommunicationMessage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "CommunicationChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationMessage" ADD CONSTRAINT "CommunicationMessage_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "CommunicationMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationReaction" ADD CONSTRAINT "CommunicationReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "CommunicationMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationThread" ADD CONSTRAINT "CommunicationThread_parentMessageId_fkey" FOREIGN KEY ("parentMessageId") REFERENCES "CommunicationMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationCall" ADD CONSTRAINT "CommunicationCall_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "CommunicationChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationCallParticipant" ADD CONSTRAINT "CommunicationCallParticipant_callId_fkey" FOREIGN KEY ("callId") REFERENCES "CommunicationCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationMessageStatus" ADD CONSTRAINT "CommunicationMessageStatus_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "CommunicationMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationAiSummary" ADD CONSTRAINT "CommunicationAiSummary_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "CommunicationChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationAiSummary" ADD CONSTRAINT "CommunicationAiSummary_callId_fkey" FOREIGN KEY ("callId") REFERENCES "CommunicationCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationMeeting" ADD CONSTRAINT "CommunicationMeeting_commHubId_fkey" FOREIGN KEY ("commHubId") REFERENCES "CommunicationHub"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationMeeting" ADD CONSTRAINT "CommunicationMeeting_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationNote" ADD CONSTRAINT "CommunicationNote_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "CommunicationMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationNote" ADD CONSTRAINT "CommunicationNote_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "CommunicationChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunicationTask" ADD CONSTRAINT "CommunicationTask_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "CommunicationMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateTimelineEvent" ADD CONSTRAINT "CandidateTimelineEvent_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateTimelineEvent" ADD CONSTRAINT "CandidateTimelineEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "AutomationWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationAction" ADD CONSTRAINT "AutomationAction_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "AutomationWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationLog" ADD CONSTRAINT "AutomationLog_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "AutomationWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS for the new team communication / calling / AI-summarization / light
-- workflow-automation module (see schema.prisma's "TEAM COMMUNICATION ..."
-- section comment). Every table here is tenantId-scoped exactly like the
-- rest of TENANT_MODELS (see server/src/config/database.ts) — same
-- tenant_isolation policy, same CREATE+ENABLE+FORCE pattern already used for
-- every other TENANT_MODELS table (mirrors
-- 20260812130000_rls_organization_workspace_policies_stage1's Part A).
--
-- AutomationRule and AutomationAction are deliberately EXCLUDED here: unlike
-- every other table in this module, they carry no "tenantId" column of their
-- own (see schema.prisma) — they're always read/written through their parent
-- AutomationWorkflow (workflowId), which is itself tenant_isolation-protected
-- below, the same "child row with no tenantId, scoped transitively via its
-- parent FK" shape as e.g. AutomationRule/AutomationAction's own relation
-- target. Giving them a tenant_isolation policy referencing a nonexistent
-- "tenantId" column would just break every insert/select against them.
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'CommunicationHub', 'CommunicationChannel', 'CommunicationChannelMember',
    'CommunicationMessage', 'CommunicationReaction', 'CommunicationThread',
    'CommunicationCall', 'CommunicationCallParticipant', 'CommunicationPresence',
    'CommunicationDevice', 'CommunicationMessageStatus', 'CommunicationAiSummary',
    'CommunicationMeeting', 'CommunicationNote', 'CommunicationTask',
    'CommunicationSettings', 'CandidateTimelineEvent', 'AutomationWorkflow',
    'AutomationLog'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING ('
      '  current_setting(''app.bypass'', true) = ''on'''
      '  OR "tenantId" = current_setting(''app.tenant_id'', true)'
      '  OR "tenantId" IS NULL'
      ') '
      'WITH CHECK ('
      '  current_setting(''app.bypass'', true) = ''on'''
      '  OR "tenantId" = current_setting(''app.tenant_id'', true)'
      '  OR "tenantId" IS NULL'
      ')', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;
