import { prisma } from '../../config/database.js';
import { ForbiddenError, NotFoundError } from '../../utils/errors.js';
import type { InitiateCallInput } from '@agnohire/shared';

// Re-export independent services
export * from './presenceService.js';
export * from './channelService.js';
export * from './directMessageService.js';
export * from './notificationService.js';

import { getOrCreateCommHub } from './channelService.js';

export async function addReaction(tenantId: string, userId: string, messageId: string, emoji: string) {
  const message = await prisma.communicationMessage.findFirst({
    where: { id: messageId, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!message) throw new NotFoundError('Message not found');
  const reaction = await prisma.communicationReaction.upsert({
    where: {
      messageId_userId_emoji: { messageId, userId, emoji }
    },
    update: {},
    create: {
      tenantId,
      messageId,
      userId,
      emoji
    }
  });
  return reaction;
}

/** Loads a message scoped to the caller's tenant — every mutation below
 *  needs this before touching a row, so a bare `where: { id }` never becomes
 *  the only gate on someone else's message again. */
async function requireOwnMessage(tenantId: string, userId: string, messageId: string) {
  const message = await prisma.communicationMessage.findFirst({
    where: { id: messageId, tenantId, deletedAt: null },
  });
  if (!message) throw new NotFoundError('Message not found');
  if (message.senderId !== userId) {
    throw new ForbiddenError('You can only modify your own messages');
  }
  return message;
}

/** Pinning is a moderation action, not authorship — any member of the
 *  message's channel may do it (matches the channel-admin model used for
 *  archive/delete), unlike edit/delete which are sender-only. DMs can't be
 *  pinned (no "channel" to moderate), so require a channelId. */
export async function pinMessage(tenantId: string, userId: string, messageId: string, isPinned: boolean) {
  const message = await prisma.communicationMessage.findFirst({
    where: { id: messageId, tenantId, deletedAt: null },
  });
  if (!message) throw new NotFoundError('Message not found');
  if (!message.channelId) throw new ForbiddenError('Only channel messages can be pinned');
  const member = await prisma.communicationChannelMember.findUnique({
    where: { channelId_userId: { channelId: message.channelId, userId } },
  });
  if (!member) throw new ForbiddenError('You are not a member of this channel');
  return prisma.communicationMessage.update({
    where: { id: messageId },
    data: { isPinned }
  });
}

export async function editMessage(tenantId: string, userId: string, messageId: string, content: string) {
  await requireOwnMessage(tenantId, userId, messageId);
  return prisma.communicationMessage.update({
    where: { id: messageId },
    data: { content, editedAt: new Date() }
  });
}

export async function deleteMessage(tenantId: string, userId: string, messageId: string) {
  await requireOwnMessage(tenantId, userId, messageId);
  return prisma.communicationMessage.update({
    where: { id: messageId },
    data: { deletedAt: new Date(), content: 'This message was deleted' }
  });
}

export async function initiateCall(tenantId: string, callerId: string, data: InitiateCallInput) {
  const hub = await getOrCreateCommHub(tenantId, callerId);
  const call = await prisma.communicationCall.create({
    data: {
      tenantId,
      commHubId: hub.id,
      channelId: data.channelId ?? null,
      callerId,
      type: data.type || 'AUDIO',
      status: 'INITIATED',
      participants: {
        create: {
          tenantId,
          userId: callerId,
          status: 'JOINED'
        }
      }
    },
    include: {
      participants: true
    }
  });
  return call;
}
