import { prisma } from '../../config/database.js';
import { runAsPlatform } from '../../config/tenantContext.js';
import { NotFoundError, ForbiddenError } from '../../utils/errors.js';
import type { CreateChannelInput } from '@agnohire/shared';

/** Loads a channel scoped to the caller's tenant, throwing NotFound rather
 *  than leaking whether a channel with that id exists in another tenant. */
async function requireChannelInTenant(tenantId: string, channelId: string) {
  return runAsPlatform(async () => {
    const channel = await prisma.communicationChannel.findFirst({
      where: { id: channelId, tenantId, deletedAt: null },
    });
    if (!channel) throw new NotFoundError('Channel not found');
    return channel;
  });
}

/** True when the user is a member of the channel (private channels require
 *  this; public channels are readable/postable by any tenant member). */
async function isChannelMember(channelId: string, userId: string): Promise<boolean> {
  return runAsPlatform(async () => {
    const member = await prisma.communicationChannelMember.findUnique({
      where: { channelId_userId: { channelId, userId } },
    });
    return member != null;
  });
}

/**
 * `bootstrapUserId` is whichever real user in THIS tenant triggered the
 * lazy first-access creation — it becomes the default channels' creator and
 * sole ADMIN member, so someone can actually manage them (archive, etc.).
 * The original version fell back to `prisma.user.findFirst({isActive:true})`
 * with no tenant filter at all inside a runAsPlatform block — the "creator"
 * of a brand-new tenant's default channels could silently be an arbitrary
 * user from a completely different tenant (whichever row sorted first
 * platform-wide), and nobody was ever added as a member, so no one could
 * ever manage them once real authorization checks existed.
 */
export async function getOrCreateCommHub(tenantId: string, bootstrapUserId?: string, tenantName = 'Workspace') {
  return runAsPlatform(async () => {
    let hub = await prisma.communicationHub.findFirst({ where: { tenantId } });

    if (!hub) {
      hub = await prisma.communicationHub.create({
        data: {
          tenantId,
          name: tenantName,
          description: 'Default workspace communication environment'
        }
      });

      const creatorId = bootstrapUserId
        ?? (await prisma.user.findFirst({ where: { tenantId, isActive: true }, select: { id: true } }))?.id
        ?? null;

      if (creatorId) {
        for (const channel of [
          { name: 'general', type: 'GENERAL' as const, description: 'General workspace discussion' },
          { name: 'announcements', type: 'ANNOUNCEMENT' as const, description: 'Workspace-wide announcements' },
        ]) {
          await prisma.communicationChannel.create({
            data: {
              tenantId,
              commHubId: hub.id,
              name: channel.name,
              type: channel.type,
              isPrivate: false,
              description: channel.description,
              createdById: creatorId,
              members: { create: { tenantId, userId: creatorId, role: 'ADMIN' } },
            },
          });
        }
      }
    }

    return hub;
  });
}

export async function listChannels(tenantId: string, userId: string) {
  return runAsPlatform(async () => {
    const hub = await getOrCreateCommHub(tenantId, userId);
    const channels = await prisma.communicationChannel.findMany({
      where: {
        commHubId: hub.id,
        deletedAt: null,
        isArchived: false,
        OR: [
          { isPrivate: false },
          { members: { some: { userId } } }
        ]
      },
      include: {
        members: {
          where: { userId },
          select: { role: true, lastReadAt: true }
        },
        _count: {
          select: { messages: true, members: true }
        }
      },
      orderBy: { name: 'asc' }
    });

    return channels.map(c => ({
      id: c.id,
      name: c.name,
      type: c.type,
      isPrivate: c.isPrivate,
      description: c.description,
      isMember: c.members.length > 0,
      memberRole: c.members[0]?.role || null,
      memberCount: c._count.members,
      messageCount: c._count.messages,
      createdAt: c.createdAt
    }));
  });
}

export async function createChannel(
  tenantId: string,
  userId: string,
  data: CreateChannelInput
) {
  return runAsPlatform(async () => {
    const hub = await getOrCreateCommHub(tenantId, userId);

    const channel = await prisma.communicationChannel.create({
      data: {
        tenantId,
        commHubId: hub.id,
        name: data.name,
        type: (data.type as any) || 'GENERAL',
        description: data.description ?? null,
        isPrivate: data.isPrivate ?? false,
        createdById: userId,
        members: {
          create: {
            tenantId,
            userId,
            role: 'ADMIN'
          }
        }
      }
    });

    return {
      id: channel.id,
      name: channel.name,
      type: channel.type,
      isPrivate: channel.isPrivate,
      description: channel.description,
      isMember: true,
      memberRole: 'ADMIN',
      memberCount: 1,
      messageCount: 0,
      createdAt: channel.createdAt
    };
  });
}

export async function getChannelMessages(
  tenantId: string,
  userId: string,
  channelId: string,
  limit = 50,
  before?: string
) {
  const channel = await requireChannelInTenant(tenantId, channelId);
  if (channel.isPrivate && !(await isChannelMember(channelId, userId))) {
    throw new ForbiddenError('You are not a member of this channel');
  }
  return runAsPlatform(async () => {
    const whereClause: any = { channelId, deletedAt: null };
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

    const senderIds = [...new Set(messages.map(m => m.senderId))];
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

export async function searchCommunication(tenantId: string, userId: string, q: string) {
  return runAsPlatform(async () => {
    if (!q || !q.trim()) {
      return { channels: [], users: [], messages: [] };
    }
    const searchTerm = q.trim();
    // Private channels the caller isn't in must stay invisible to search,
    // exactly like they're invisible to listChannels.
    const visibleChannelIds = (
      await prisma.communicationChannel.findMany({
        where: {
          tenantId,
          deletedAt: null,
          OR: [{ isPrivate: false }, { members: { some: { userId } } }],
        },
        select: { id: true },
      })
    ).map((c) => c.id);

    const [channels, users, messages] = await Promise.all([
      prisma.communicationChannel.findMany({
        where: {
          tenantId,
          id: { in: visibleChannelIds },
          deletedAt: null,
          OR: [
            { name: { contains: searchTerm, mode: 'insensitive' } },
            { description: { contains: searchTerm, mode: 'insensitive' } }
          ]
        },
        take: 10
      }),
      prisma.user.findMany({
        where: {
          tenantId,
          isActive: true,
          deletedAt: null,
          OR: [
            { fullName: { contains: searchTerm, mode: 'insensitive' } },
            { email: { contains: searchTerm, mode: 'insensitive' } }
          ]
        },
        select: { id: true, fullName: true, email: true, avatarUrl: true, role: { select: { name: true } } },
        take: 10
      }),
      prisma.communicationMessage.findMany({
        where: {
          tenantId,
          deletedAt: null,
          // Channel messages only, and only from channels the caller can see —
          // DMs are private 1:1 and must never surface in workspace search.
          channelId: { in: visibleChannelIds },
          content: { contains: searchTerm, mode: 'insensitive' }
        },
        take: 15,
        orderBy: { createdAt: 'desc' },
        include: {
          sender: { select: { id: true, fullName: true, avatarUrl: true } }
        }
      })
    ]);

    return {
      channels: channels.map(c => ({ id: c.id, name: c.name, type: c.type, description: c.description })),
      users: users.map(u => ({ id: u.id, fullName: u.fullName, email: u.email, avatarUrl: u.avatarUrl, role: u.role?.name || 'Member' })),
      messages: messages.map(m => ({ id: m.id, content: m.content, channelId: m.channelId, dmPairId: m.dmPairId, createdAt: m.createdAt, sender: m.sender }))
    };
  });
}

export async function inviteUsers(tenantId: string, _invitedByUserId: string, emails: string[], channelId?: string) {
  if (channelId) await requireChannelInTenant(tenantId, channelId);
  return runAsPlatform(async () => {
    const existingUsers = await prisma.user.findMany({
      // Scoped to the caller's own tenant — inviting must never resolve (and
      // thereby leak the existence of) an account in another tenant.
      where: { email: { in: emails }, tenantId, deletedAt: null },
      select: { id: true, email: true, fullName: true }
    });

    if (channelId) {
      for (const u of existingUsers) {
        await prisma.communicationChannelMember.upsert({
          where: { channelId_userId: { channelId, userId: u.id } },
          update: { role: 'MEMBER' },
          create: { tenantId, channelId, userId: u.id, role: 'MEMBER' }
        }).catch(() => {});
      }
    }

    return {
      success: true,
      invitedCount: emails.length,
      existingUsersCount: existingUsers.length
    };
  });
}

export async function joinChannel(tenantId: string, userId: string, channelId: string) {
  const channel = await requireChannelInTenant(tenantId, channelId);
  return runAsPlatform(async () => {
    // Public channels: anyone in the tenant can self-join, matching
    // listChannels' visibility rule. Private channels only accept members an
    // admin already added via inviteUsers — joinChannel just reaffirms an
    // existing membership row (e.g. reconnecting a socket), it never creates
    // one, so a private channelId leaking to a non-member can't be used to
    // self-add into it.
    if (channel.isPrivate) {
      const existing = await prisma.communicationChannelMember.findUnique({
        where: { channelId_userId: { channelId, userId } },
      });
      if (!existing) throw new ForbiddenError('This channel is private');
      return existing;
    }
    return prisma.communicationChannelMember.upsert({
      where: { channelId_userId: { channelId, userId } },
      update: { role: 'MEMBER' },
      create: { tenantId, channelId, userId, role: 'MEMBER' }
    });
  });
}

export async function getChannelDetails(tenantId: string, userId: string, channelId: string) {
  const gate = await requireChannelInTenant(tenantId, channelId);
  if (gate.isPrivate && !(await isChannelMember(channelId, userId))) {
    throw new ForbiddenError('You are not a member of this channel');
  }
  return runAsPlatform(async () => {
    const channel = await prisma.communicationChannel.findUnique({
      where: { id: channelId },
      include: {
        members: true,
        _count: { select: { messages: true, members: true } }
      }
    });

    if (!channel) throw new NotFoundError('Channel not found');

    const files = await prisma.communicationMessage.findMany({
      where: { channelId, mediaUrl: { not: null }, deletedAt: null },
      select: { id: true, mediaUrl: true, fileName: true, fileSize: true, createdAt: true, senderId: true },
      orderBy: { createdAt: 'desc' },
      take: 20
    });

    const userIds = new Set<string>();
    channel.members.forEach(m => userIds.add(m.userId));
    files.forEach(f => userIds.add(f.senderId));

    const users = await prisma.user.findMany({
      where: { id: { in: Array.from(userIds) } },
      select: { id: true, fullName: true, email: true, avatarUrl: true }
    });

    const userMap = new Map(users.map(u => [u.id, u]));

    return {
      channel: {
        id: channel.id,
        name: channel.name,
        description: channel.description,
        isPrivate: channel.isPrivate,
        type: channel.type,
        createdAt: channel.createdAt,
        memberCount: channel._count.members,
        messageCount: channel._count.messages,
        members: channel.members.map(m => {
          const u = userMap.get(m.userId);
          return { id: m.userId, fullName: u?.fullName || 'Unknown User', email: u?.email || '', avatarUrl: u?.avatarUrl || null, role: m.role };
        })
      },
      sharedFiles: files.map(f => ({
        id: f.id,
        mediaUrl: f.mediaUrl,
        fileName: f.fileName,
        fileSize: f.fileSize,
        createdAt: f.createdAt,
        sender: { fullName: userMap.get(f.senderId)?.fullName || 'Unknown User' }
      }))
    };
  });
}

/** Only the channel's creator or a member with the ADMIN channel role may
 *  archive/delete it — same rule for both, factored out to avoid drift. */
async function requireChannelAdmin(tenantId: string, userId: string, channelId: string) {
  const channel = await requireChannelInTenant(tenantId, channelId);
  if (channel.createdById === userId) return channel;
  return runAsPlatform(async () => {
    const member = await prisma.communicationChannelMember.findUnique({
      where: { channelId_userId: { channelId, userId } },
    });
    if (!member || member.role !== 'ADMIN') {
      throw new ForbiddenError('Only a channel admin can do this');
    }
    return channel;
  });
}

export async function archiveChannel(tenantId: string, userId: string, channelId: string) {
  await requireChannelAdmin(tenantId, userId, channelId);
  return runAsPlatform(async () => {
    await prisma.communicationChannel.update({
      where: { id: channelId },
      data: { isArchived: true }
    });
    return { success: true };
  });
}

export async function deleteChannel(tenantId: string, userId: string, channelId: string) {
  await requireChannelAdmin(tenantId, userId, channelId);
  return runAsPlatform(async () => {
    await prisma.communicationChannel.update({
      where: { id: channelId },
      data: { deletedAt: new Date() }
    });
    return { success: true };
  });
}
