import { prisma } from '../../config/database.js';

export async function markMessageAsRead(tenantId: string, messageId: string, userId: string) {
  const status = await prisma.communicationMessageStatus.upsert({
    where: { messageId_userId: { messageId, userId } },
    update: {
      status: 'READ',
      readAt: new Date()
    },
    create: {
      tenantId,
      messageId,
      userId,
      status: 'READ',
      readAt: new Date()
    }
  });

  return status;
}

export async function markConversationAsRead(
  tenantId: string,
  userId: string,
  channelId?: string,
  targetUserId?: string
) {
  if (channelId) {
    await prisma.communicationChannelMember.upsert({
      where: { channelId_userId: { channelId, userId } },
      update: { lastReadAt: new Date() },
      create: {
        tenantId,
        channelId,
        userId,
        lastReadAt: new Date()
      }
    }).catch(() => {});
  }

  if (targetUserId) {
    const dmPairId = [userId, targetUserId].sort().join(':');
    const unreadMsgs = await prisma.communicationMessage.findMany({
      where: {
        tenantId,
        dmPairId,
        senderId: targetUserId,
        deletedAt: null
      },
      select: { id: true }
    });

    for (const msg of unreadMsgs) {
      await markMessageAsRead(tenantId, msg.id, userId).catch(() => {});
    }
  }

  return { success: true };
}

export async function getUnreadCounts(tenantId: string, userId: string) {
  // Get unread counts per channel & DM for user
  const channelMemberships = await prisma.communicationChannelMember.findMany({
    where: { tenantId, userId },
    select: { channelId: true, lastReadAt: true }
  });

  const channelUnreads: Record<string, number> = {};
  for (const cm of channelMemberships) {
    const count = await prisma.communicationMessage.count({
      where: {
        tenantId,
        channelId: cm.channelId,
        senderId: { not: userId },
        createdAt: { gt: cm.lastReadAt },
        deletedAt: null
      }
    });
    channelUnreads[cm.channelId] = count;
  }

  return { channelUnreads };
}
