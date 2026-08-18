import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { env } from './env.js';
import { logger } from './logger.js';
import { verifyAccessToken } from '../utils/tokenHelper.js';

let io: SocketIOServer | null = null;

/** Per-user and per-role rooms let us target broadcasts precisely. */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}
/** Role rooms are tenant-qualified so a role broadcast can never cross tenants. */
export function roleRoom(role: string, tenantId?: string | null): string {
  return tenantId ? `tenant:${tenantId}:role:${role}` : `role:${role}`;
}
export function tenantRoom(tenantId: string): string {
  return `tenant:${tenantId}`;
}
export function pipelineRoom(jobRequisitionId: string): string {
  return `pipeline:${jobRequisitionId}`;
}

export function initSocket(server: HttpServer): SocketIOServer {
  io = new SocketIOServer(server, {
    cors: { origin: env.clientUrl, credentials: true },
  });

  // Authenticate sockets via the access token (handshake auth or query).
  io.use((socket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      (socket.handshake.query?.token as string | undefined);
    if (!token) return next(); // allow anonymous (e.g. public theme updates)
    try {
      const payload = verifyAccessToken(token);
      socket.data.user = payload;
    } catch {
      // Invalid token → treat as anonymous rather than refusing the socket.
    }
    next();
  });

  io.on('connection', (socket: Socket) => {
    const user = socket.data.user as
      | { sub: string; role: string; sectorId?: string | null; tenantId?: string | null; exp?: number }
      | undefined;
    if (user) {
      socket.join(userRoom(user.sub));
      socket.join(roleRoom(user.role, user.tenantId));
      if (user.tenantId) socket.join(tenantRoom(user.tenantId));

      // Enforce the access-token TTL on the live socket: a handshake-authed
      // connection must not outlive its token. Disconnect at expiry so the
      // client is forced to reconnect with a fresh (or no) token.
      if (typeof user.exp === 'number') {
        const ms = user.exp * 1000 - Date.now();
        if (ms <= 0) {
          socket.disconnect(true);
          return;
        }
        const timer = setTimeout(() => socket.disconnect(true), ms);
        timer.unref();
        socket.on('disconnect', () => clearTimeout(timer));
      }
    }
    // Clients viewing a Kanban board subscribe to that job's room for live moves.
    // AUTHORIZED: must be an authenticated user who can access that job's sector,
    // otherwise the websocket would leak cross-sector pipeline activity (bypassing
    // the REST fail-closed scoping). Dynamic import avoids a socket↔pipeline cycle.
    socket.on('pipeline:subscribe', async (jobRequisitionId: string) => {
      if (typeof jobRequisitionId !== 'string' || !user) return;
      try {
        const { canAccessJobPipeline } = await import('../services/pipelineService.js');
        const { runWithTenant } = await import('./tenantContext.js');
        // Tenant-scope the authorization lookup so an admin of tenant B can
        // never subscribe to tenant A's board (sector checks alone would let
        // cross-sector admins through).
        // SUPERADMIN is the cross-tenant operator role (mirrors auth.middleware).
        const isPlatformOperator = user.role === 'SUPERADMIN';
        const allowed = await runWithTenant(
          user.tenantId ?? null,
          () => canAccessJobPipeline({ role: user.role, sectorId: user.sectorId }, jobRequisitionId),
          isPlatformOperator,
        );
        if (allowed) socket.join(pipelineRoom(jobRequisitionId));
      } catch {
        /* deny on error — fail closed */
      }
    });
    socket.on('pipeline:unsubscribe', (jobRequisitionId: string) => {
      if (typeof jobRequisitionId === 'string') socket.leave(pipelineRoom(jobRequisitionId));
    });
    socket.on('disconnect', () => {
      /* rooms auto-cleaned */
    });
  });

  // Team communication module's own socket namespace (channels/DMs/presence/
  // calls) — registered on this same Socket.IO server rather than a separate
  // one, so it shares the auth handshake above. Dynamic import + try/catch
  // mirrors the rest of this file's pattern of not letting an optional
  // subsystem block core socket init.
  try {
    import('../communication/websocket/communicationSocket.js').then(({ initCommunicationSocket }) => {
      if (io) initCommunicationSocket(io);
    });
  } catch {
    /* communication module socket handler unavailable — core sockets still work */
  }

  logger.info('Socket.IO initialized');
  return io;
}

export function getIO(): SocketIOServer {
  if (!io) throw new Error('Socket.IO not initialized');
  return io;
}

/** Broadcast a theme change to every connected client (applied without reload). */
export function broadcastThemeUpdate(tokens: Record<string, string>): void {
  io?.emit('theme:updated', { tokens });
}

/** Push a notification to a single user's room. */
export function emitToUser(userId: string, event: string, payload: unknown): void {
  io?.to(userRoom(userId)).emit(event, payload);
}

export interface MaintenanceNoticePayload {
  id: string;
  title: string;
  message: string;
  startAt: string;
  endAt: string;
  phase: 'upcoming' | 'active';
}

/** Broadcast a maintenance warning to every connected client, regardless of role. */
export function broadcastMaintenanceNotice(payload: MaintenanceNoticePayload): void {
  io?.emit('maintenance:notice', payload);
}

/** Broadcast a pipeline move to everyone viewing that job's board. */
export function emitPipelineMove(jobRequisitionId: string, payload: unknown): void {
  io?.to(pipelineRoom(jobRequisitionId)).emit('pipeline:moved', payload);
}

/**
 * Broadcast an interview status change to everyone in that tenant, so the
 * Interviews list updates live (candidate starts/submits, scoring completes)
 * instead of requiring a manual refresh. No-op without a resolvable tenant —
 * public/candidate-side transitions always have one via Interview.tenantId.
 */
export function emitInterviewUpdate(tenantId: string | null | undefined, interviewId: string, status: string): void {
  if (!tenantId) return;
  io?.to(tenantRoom(tenantId)).emit('interview:updated', { interviewId, status });
}
