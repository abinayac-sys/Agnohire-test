import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { emitToUser } from '../config/socket.js';
import { paginate } from '../utils/response.js';
import { NotFoundError } from '../utils/errors.js';
import { SOCKET_EVENTS, ROLES, type NotificationItem } from '@agnohire/shared';

interface NotifyInput {
  recipientId: string;
  type: string;
  title: string;
  message: string;
  actorId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}

function toItem(n: {
  id: string;
  type: string;
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  isRead: boolean;
  createdAt: Date;
}): NotificationItem {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    message: n.message,
    entityType: n.entityType,
    entityId: n.entityId,
    isRead: n.isRead,
    createdAt: n.createdAt.toISOString(),
  };
}

/**
 * Creates an in-app notification and pushes it live to the recipient over
 * Socket.IO. Best-effort: a failure here never breaks the action that triggered
 * it (e.g. a panel assignment still succeeds if notifying fails).
 */
export async function notify(input: NotifyInput): Promise<void> {
  try {
    const n = await prisma.notification.create({
      data: {
        recipientId: input.recipientId,
        actorId: input.actorId ?? null,
        type: input.type,
        title: input.title,
        message: input.message,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
      },
      select: {
        id: true, type: true, title: true, message: true,
        entityType: true, entityId: true, isRead: true, createdAt: true,
        tenantId: true,
      },
    });
    emitToUser(input.recipientId, SOCKET_EVENTS.NOTIFICATION_NEW, toItem(n));

    if (n.tenantId) {
      const admins = await prisma.user.findMany({
        where: {
          tenantId: n.tenantId,
          role: { name: ROLES.ADMIN },
          deletedAt: null,
          NOT: { id: input.recipientId },
        },
        select: { id: true },
      });
      for (const admin of admins) {
        emitToUser(admin.id, SOCKET_EVENTS.TENANT_NOTIFICATION_NEW, toItem(n));
      }
    }
  } catch (err) {
    logger.error('Failed to create notification', {
      recipientId: input.recipientId,
      type: input.type,
      err: (err as Error).message,
    });
  }
}

/** Notify many recipients (deduplicated, skips falsy ids). */
export async function notifyMany(recipientIds: (string | null | undefined)[], base: Omit<NotifyInput, 'recipientId'>): Promise<void> {
  const unique = [...new Set(recipientIds.filter((id): id is string => Boolean(id)))];
  await Promise.all(unique.map((recipientId) => notify({ ...base, recipientId })));
}

export async function listNotifications(
  userId: string,
  opts: { page?: number; limit?: number; unreadOnly?: boolean } = {},
) {
  const page = opts.page ?? 1;
  const limit = opts.limit ?? 20;
  const where = { recipientId: userId, isCleared: false, ...(opts.unreadOnly ? { isRead: false } : {}) };
  const [rows, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true, type: true, title: true, message: true,
        entityType: true, entityId: true, isRead: true, createdAt: true,
      },
    }),
    prisma.notification.count({ where }),
  ]);
  return paginate(rows.map(toItem), total, page, limit);
}

export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { recipientId: userId, isRead: false, isCleared: false } });
}

export async function markRead(userId: string, id: string): Promise<void> {
  const n = await prisma.notification.findFirst({ where: { id, recipientId: userId, isCleared: false }, select: { id: true } });
  if (!n) throw new NotFoundError('Notification not found');
  await prisma.notification.update({ where: { id }, data: { isRead: true, readAt: new Date() } });
}

export async function markAllRead(userId: string): Promise<number> {
  const res = await prisma.notification.updateMany({
    where: { recipientId: userId, isRead: false, isCleared: false },
    data: { isRead: true, readAt: new Date() },
  });
  return res.count;
}

export async function clearAll(userId: string): Promise<number> {
  const res = await prisma.notification.updateMany({
    where: { recipientId: userId, isCleared: false },
    data: { isCleared: true },
  });
  return res.count;
}

export async function listTenantNotifications(
  adminId: string,
  opts: { page?: number; limit?: number } = {},
) {
  const page = opts.page ?? 1;
  const limit = opts.limit ?? 20;

  const where = {
    recipientId: {
      not: adminId,
    },
    adminStates: {
      none: {
        adminId,
        isCleared: true,
      },
    },
  };

  const [rows, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        recipient: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        adminStates: {
          where: {
            adminId,
          },
        },
      },
    }),
    prisma.notification.count({ where }),
  ]);

  const appIds = rows.filter(r => r.entityType === 'Application' && r.entityId).map(r => r.entityId!) as string[];
  const candidateIds = rows.filter(r => r.entityType === 'Candidate' && r.entityId).map(r => r.entityId!) as string[];
  const interviewIds = rows.filter(r => r.entityType === 'Interview' && r.entityId).map(r => r.entityId!) as string[];
  const offerIds = rows.filter(r => r.entityType === 'Offer' && r.entityId).map(r => r.entityId!) as string[];

  const [apps, candidates, interviews, offers] = await Promise.all([
    appIds.length ? prisma.jobApplication.findMany({
      where: { id: { in: appIds } },
      select: { id: true, candidate: { select: { fullName: true } } }
    }) : [],
    candidateIds.length ? prisma.candidate.findMany({
      where: { id: { in: candidateIds } },
      select: { id: true, fullName: true }
    }) : [],
    interviewIds.length ? prisma.interview.findMany({
      where: { id: { in: interviewIds } },
      select: { id: true, candidate: { select: { fullName: true } } }
    }) : [],
    offerIds.length ? prisma.offer.findMany({
      where: { id: { in: offerIds } },
      select: { id: true, application: { select: { candidate: { select: { fullName: true } } } } }
    }) : [],
  ]);

  const candidateMap = new Map<string, string>();
  for (const item of apps) {
    if (item.candidate?.fullName) candidateMap.set(item.id, item.candidate.fullName);
  }
  for (const item of candidates) {
    if (item.fullName) candidateMap.set(item.id, item.fullName);
  }
  for (const item of interviews) {
    if (item.candidate?.fullName) candidateMap.set(item.id, item.candidate.fullName);
  }
  for (const item of offers) {
    if (item.application?.candidate?.fullName) candidateMap.set(item.id, item.application.candidate.fullName);
  }

  const items = rows.map((n) => {
    const adminState = n.adminStates?.[0];
    return {
      id: n.id,
      type: n.type,
      title: n.title,
      message: n.message,
      entityType: n.entityType,
      entityId: n.entityId,
      isRead: adminState ? adminState.isRead : false,
      createdAt: n.createdAt.toISOString(),
      recipient: n.recipient,
      candidateName: n.entityId ? candidateMap.get(n.entityId) : undefined,
    };
  });

  return paginate(items, total, page, limit);
}

export async function tenantUnreadCount(adminId: string): Promise<number> {
  return prisma.notification.count({
    where: {
      recipientId: {
        not: adminId,
      },
      adminStates: {
        none: {
          adminId,
          OR: [
            { isCleared: true },
            { isRead: true },
          ],
        },
      },
    },
  });
}

export async function markTenantAllRead(adminId: string, tenantId: string | null | undefined): Promise<number> {
  const notifications = await prisma.notification.findMany({
    where: {
      recipientId: {
        not: adminId,
      },
      adminStates: {
        none: {
          adminId,
          OR: [
            { isRead: true },
            { isCleared: true },
          ],
        },
      },
    },
    select: { id: true },
  });

  const data = notifications.map(n => ({
    adminId,
    notificationId: n.id,
    isRead: true,
    tenantId: tenantId ?? null,
  }));

  if (data.length > 0) {
    await prisma.adminNotificationState.createMany({
      data,
      skipDuplicates: true,
    });
  }

  return data.length;
}

export async function clearTenantAll(adminId: string, tenantId: string | null | undefined): Promise<number> {
  await prisma.adminNotificationState.updateMany({
    where: {
      adminId,
      isCleared: false,
    },
    data: { isCleared: true },
  });

  const notifications = await prisma.notification.findMany({
    where: {
      recipientId: {
        not: adminId,
      },
      adminStates: {
        none: {
          adminId,
        },
      },
    },
    select: { id: true },
  });

  const data = notifications.map(n => ({
    adminId,
    notificationId: n.id,
    isCleared: true,
    tenantId: tenantId ?? null,
  }));

  if (data.length > 0) {
    await prisma.adminNotificationState.createMany({
      data,
      skipDuplicates: true,
    });
  }

  return data.length;
}


