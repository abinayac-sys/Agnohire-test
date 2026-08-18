import { prisma } from '../../config/database.js';
import { listUsers as fetchAdminUsers } from '../../services/adminUserService.js';

export interface CommHubUserPresence {
  id: string;
  user_id: string;
  name: string;
  fullName: string;
  full_name: string;
  email: string;
  avatarUrl: string | null;
  profile_image: string | null;
  jobTitle: string | null;
  department: string | null;
  role: string;
  status: 'ONLINE' | 'AWAY' | 'BUSY' | 'INVISIBLE' | 'OFFLINE';
  online_status: 'ONLINE' | 'AWAY' | 'BUSY' | 'INVISIBLE' | 'OFFLINE';
  customStatus: string | null;
  lastSeenAt: Date | null;
  last_seen: Date | null;
}

// Global in-memory set of actively connected socket user IDs
const activeOnlineUsers = new Set<string>();

export function markUserOnline(userId: string) {
  if (userId) activeOnlineUsers.add(userId);
}

export function markUserOffline(userId: string) {
  if (userId) activeOnlineUsers.delete(userId);
}

export function isUserOnline(userId: string): boolean {
  return activeOnlineUsers.has(userId);
}

/**
 * Fetch ALL active users from the Users module by consuming adminUserService.listUsers directly.
 * Only users logged in / connected via Socket.IO will show as ONLINE; others show as OFFLINE.
 *
 * adminUserService.listUsers(filters, req) reads req.workspaceScopedUserManage /
 * req.user off a real Express Request for the (unrelated) Organization/
 * Workspace-scoped admin-user-management feature — this call site has no
 * inbound request to hand it (it's invoked from REST handlers scoped by
 * ambient tenant context alone, and from the presence socket handlers, which
 * have none at all), so it passes a minimal stand-in that always takes the
 * "full tenant roster" branch. Reads still come back correctly tenant-scoped
 * via the ambient tenant context already threaded through prisma's
 * TENANT_MODELS middleware (see config/database.ts), independent of this arg.
 */
export async function getCommHubUsersWithPresence(_tenantId?: string | null): Promise<CommHubUserPresence[]> {
  try {
    const paginatedUsers = await fetchAdminUsers(
      { page: 1, limit: 100, sortOrder: 'asc', isActive: true } as any,
      {} as any,
    );
    const adminUsers = paginatedUsers.items;

    if (!adminUsers || adminUsers.length === 0) return [];

    const userIds = adminUsers.map(u => u.id);
    const presences = await prisma.communicationPresence.findMany({
      where: {
        userId: { in: userIds },
      },
    }).catch(() => []);

    const presenceMap = new Map(presences.map(p => [p.userId, p]));

    return adminUsers.map(u => {
      const p = presenceMap.get(u.id);

      // A user is ONLINE if they are in activeOnlineUsers set OR DB presence updated within last 3 minutes
      let isOnline = activeOnlineUsers.has(u.id);
      if (!isOnline && p?.status === 'ONLINE' && p?.lastSeenAt) {
        const timeDiff = Date.now() - new Date(p.lastSeenAt).getTime();
        if (timeDiff < 3 * 60 * 1000) {
          isOnline = true;
        }
      }

      const dbStatus = p?.status as any;
      const status: 'ONLINE' | 'AWAY' | 'BUSY' | 'INVISIBLE' | 'OFFLINE' = isOnline
        ? (dbStatus === 'BUSY' || dbStatus === 'AWAY' ? dbStatus : 'ONLINE')
        : 'OFFLINE';

      const lastSeen = p?.lastSeenAt || null;

      return {
        id: u.id,
        user_id: u.id,
        name: u.fullName,
        fullName: u.fullName,
        full_name: u.fullName,
        email: u.email,
        avatarUrl: null,
        profile_image: null,
        jobTitle: u.roleName || 'Member',
        department: u.sectorName || 'General',
        role: u.roleName || 'Member',
        status,
        online_status: status,
        customStatus: p?.customStatus || null,
        lastSeenAt: lastSeen,
        last_seen: lastSeen,
      };
    });
  } catch (err) {
    console.error('Failed to fetch communication hub users via adminUserService:', err);
    return [];
  }
}

export async function updatePresence(
  tenantId: string,
  userId: string,
  status: string,
  customStatus?: string | null
) {
  if (status === 'ONLINE' || status === 'AWAY' || status === 'BUSY') {
    markUserOnline(userId);
  } else if (status === 'OFFLINE' || status === 'INVISIBLE') {
    markUserOffline(userId);
  }

  const presence = await prisma.communicationPresence.upsert({
    where: { userId },
    update: {
      tenantId,
      status: status as any,
      customStatus: customStatus ?? null,
      lastSeenAt: new Date(),
    },
    create: {
      tenantId,
      userId,
      status: status as any,
      customStatus: customStatus ?? null,
      lastSeenAt: new Date(),
    },
  });

  return presence;
}
