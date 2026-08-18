import { prisma } from '../../config/database.js';
import { runAsPlatform } from '../../config/tenantContext.js';
import { ForbiddenError, NotFoundError } from '../../utils/errors.js';
import type { SendMessageInput } from '@agnohire/shared';

export function deriveDMPairId(userId1: string, userId2: string): string {
  return [userId1, userId2].sort().join(':');
}

export function deriveDMRoomId(userId1: string, userId2: string): string {
  return `dm_${[userId1, userId2].sort().join('_')}`;
}

export async function getDMMessages(
  tenantId: string,
  userId: string,
  targetUserId: string,
  limit = 50,
  before?: string
) {
  return runAsPlatform(async () => {
    const dmPairId = deriveDMPairId(userId, targetUserId);

    const whereClause: any = { tenantId, dmPairId, deletedAt: null };
    if (before) {
      whereClause.createdAt = { lt: new Date(before) };
    }

    const messages = await prisma.communicationMessage.findMany({
      where: whereClause,
      take: limit,
      orderBy: { createdAt: 'asc' },
      include: {
        reactions: true,
        statuses: true,
        _count: { select: { replies: true } }
      }
    });

    const senderIds = [...new Set([userId, targetUserId])];
    const users = await prisma.user.findMany({
      where: { id: { in: senderIds } },
      select: { id: true, fullName: true, email: true, avatarUrl: true }
    });
    const userMap = new Map(users.map(u => [u.id, u]));

    return messages.map(m => ({
      id: m.id,
      channelId: m.channelId,
      dmPairId: m.dmPairId,
      sender: userMap.get(m.senderId) || { id: m.senderId, fullName: 'Unknown User', email: '', avatarUrl: null },
      content: m.content,
      type: m.type,
      mediaUrl: m.mediaUrl,
      fileName: m.fileName,
      fileSize: m.fileSize,
      replyToId: m.replyToId,
      replyCount: m._count.replies,
      isPinned: m.isPinned,
      isStarred: m.isStarred,
      reactions: m.reactions,
      statuses: m.statuses,
      editedAt: m.editedAt,
      createdAt: m.createdAt
    }));
  });
}

export async function sendMessage(
  tenantId: string,
  userId: string,
  data: SendMessageInput & { targetUserId?: string | null }
) {
  return runAsPlatform(async () => {
    let dmPairId: string | null = null;
    if (!data.channelId) {
      if (data.targetUserId) {
        // Same-tenant only — DMing must never reach across tenant boundaries,
        // and this also confirms targetUserId is a real user, not junk that
        // would otherwise silently create an unreachable thread.
        const target = await prisma.user.findFirst({
          where: { id: data.targetUserId, tenantId, deletedAt: null },
          select: { id: true },
        });
        if (!target) throw new NotFoundError('Recipient not found in your workspace');
        dmPairId = deriveDMPairId(userId, data.targetUserId);
      } else if (data.dmPairId) {
        const parts = data.dmPairId.split(':');
        // A raw dmPairId must name the caller as one of its two participants —
        // otherwise this is exactly how a message gets spoofed into someone
        // else's private DM thread by pairing two arbitrary victim ids.
        if (parts.length !== 2 || !parts.includes(userId)) {
          throw new ForbiddenError('Invalid conversation');
        }
        dmPairId = deriveDMPairId(parts[0], parts[1]);
      }
    } else {
      const channel = await prisma.communicationChannel.findFirst({
        where: { id: data.channelId, tenantId, deletedAt: null },
      });
      if (!channel) throw new NotFoundError('Channel not found');
      if (channel.isPrivate) {
        const member = await prisma.communicationChannelMember.findUnique({
          where: { channelId_userId: { channelId: data.channelId, userId } },
        });
        if (!member) throw new ForbiddenError('You are not a member of this channel');
      }
    }

    const message = await prisma.communicationMessage.create({
      data: {
        tenantId,
        channelId: data.channelId ?? null,
        dmPairId,
        senderId: userId,
        content: data.content ?? null,
        type: data.type || 'TEXT',
        mediaUrl: data.mediaUrl ?? null,
        fileName: data.fileName ?? null,
        fileSize: data.fileSize ?? null,
        replyToId: data.replyToId ?? null
      },
      include: {
        reactions: true,
        statuses: true
      }
    });

    let targetUserId: string | null = data.targetUserId || null;
    if (!targetUserId && dmPairId) {
      const parts = dmPairId.split(':');
      targetUserId = parts.find(id => id !== userId) || null;
    }

    if (targetUserId) {
      await prisma.communicationMessageStatus.create({
        data: {
          tenantId,
          messageId: message.id,
          userId: targetUserId,
          status: 'DELIVERED'
        }
      }).catch(() => {});
    }

    const sender = await prisma.user.findFirst({
      where: { id: userId },
      select: { id: true, fullName: true, email: true, avatarUrl: true }
    });

    return {
      id: message.id,
      channelId: message.channelId,
      dmPairId: message.dmPairId,
      targetUserId,
      sender: sender || { id: userId, fullName: 'User', email: '', avatarUrl: null },
      content: message.content,
      type: message.type,
      mediaUrl: message.mediaUrl,
      fileName: message.fileName,
      fileSize: message.fileSize,
      replyToId: message.replyToId,
      replyCount: 0,
      isPinned: false,
      isStarred: false,
      reactions: [],
      statuses: message.statuses || [],
      createdAt: message.createdAt
    };
  });
}
