// cache invalidate
import type { Request, Response } from 'express';
import { requireTenantId } from '../config/tenantContext.js';
import { logger } from '../config/logger.js';
import { UnauthorizedError } from '../utils/errors.js';
import { getIO } from '../config/socket.js';
import { env } from '../config/env.js';
import * as commService from '../communication/services/communicationService.js';
import { createChannelSchema, sendMessageSchema, updatePresenceSchema } from '@agnohire/shared';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

/**
 * WebRTC 1:1 call rooms are the only kind of LiveKit room this app issues —
 * see useWebRTC.ts's startCall(), the sole place a roomId is minted, always
 * as `room_<callerId>_<targetId>_<timestamp>`. That naming convention IS the
 * access grant: anyone who can produce a valid token for this roomId can see
 * and hear the call, so the caller must be one of the two embedded user ids
 * or this becomes a call-eavesdropping primitive for anyone who obtains a
 * roomId (log line, browser devtools, a future leak elsewhere).
 */
export function isCallerAllowedInRoom(userId: string, roomId: string): boolean {
  const match = /^room_([0-9a-f-]{36})_([0-9a-f-]{36})_\d+$/i.exec(roomId);
  if (!match) return true; // not a 1:1 call room we recognize — nothing to gate
  return match[1] === userId || match[2] === userId;
}

function getUserAndTenant(req: Request): { userId: string; tenantId: string | null; role?: string } {
  const user = req.user as { id?: string; sub?: string; tenantId?: string | null; role?: string } | undefined;
  const userId = user?.id || user?.sub;
  if (!userId) {
    throw new UnauthorizedError('Unauthorized: User session missing or invalid');
  }
  return { userId, tenantId: user?.tenantId || null, role: user?.role };
}

/** Same as getUserAndTenant, but resolves a definite tenant id — every
 *  chat/DM/channel endpoint needs one, and threading a possibly-null
 *  tenantId into Prisma calls (which all require a real string) is exactly
 *  what broke type inference — and with it several includes — throughout
 *  this module. requireTenantId() throws cleanly for the one session shape
 *  that has none (a superadmin's own, non-impersonated login): there's no
 *  single hub for that session to chat in. getCommHubUsersByCommHubId
 *  is the deliberate exception — a superadmin browsing an explicit tenant's
 *  hub from the platform console — and uses getUserAndTenant instead. */
function getUserAndRequiredTenant(req: Request): { userId: string; tenantId: string; role?: string } {
  const { userId, tenantId, role } = getUserAndTenant(req);
  return { userId, tenantId: tenantId || requireTenantId(), role };
}

export async function getCommHubInfo(req: Request, res: Response) {
  const { userId, tenantId } = getUserAndRequiredTenant(req);
  const hub = await commService.getOrCreateCommHub(tenantId, userId);
  res.json({ success: true, data: hub });
}

export async function listChannels(req: Request, res: Response) {
  const { userId, tenantId } = getUserAndRequiredTenant(req);
  const channels = await commService.listChannels(tenantId, userId);
  res.json({ success: true, data: channels });
}

export async function createChannel(req: Request, res: Response) {
  const { userId, tenantId } = getUserAndRequiredTenant(req);
  const parsed = createChannelSchema.parse(req.body);
  const channel = await commService.createChannel(tenantId, userId, parsed);
  res.status(201).json({ success: true, data: channel });
}

export async function getChannelMessages(req: Request, res: Response) {
  const { userId, tenantId } = getUserAndRequiredTenant(req);
  const { channelId } = req.params;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
  const before = req.query.before as string | undefined;
  const messages = await commService.getChannelMessages(tenantId, userId, channelId, limit, before);
  res.json({ success: true, data: messages });
}

export async function getDMMessages(req: Request, res: Response) {
  const { userId, tenantId } = getUserAndRequiredTenant(req);
  const { targetUserId } = req.params;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
  const before = req.query.before as string | undefined;
  const messages = await commService.getDMMessages(tenantId, userId, targetUserId, limit, before);
  res.json({ success: true, data: messages });
}

export async function sendMessage(req: Request, res: Response) {
  const { userId, tenantId } = getUserAndRequiredTenant(req);
  const parsed = sendMessageSchema.parse(req.body);
  const message = await commService.sendMessage(tenantId, userId, parsed);

  // Broadcast instantly via Socket.IO
  try {
    const io = getIO();
    if (message.channelId) {
      io.to(`channel_${message.channelId}`).to(`comm:channel:${message.channelId}`).emit('receive_message', message);
      io.to(`channel_${message.channelId}`).to(`comm:channel:${message.channelId}`).emit('comm:message_received', message);
      io.to(`channel_${message.channelId}`).to(`comm:channel:${message.channelId}`).emit('new_message', message);
    } else if (message.dmPairId || (parsed as any).targetUserId) {
      const targetId = (parsed as any).targetUserId || message.targetUserId || message.dmPairId?.split(':').find(id => id !== userId);
      if (targetId) {
        const dmRoom = `dm_${[userId, targetId].sort().join('_')}`;
        io.to(dmRoom).to(`user:${targetId}`).to(`user_${targetId}`).emit('receive_message', message);
        io.to(dmRoom).to(`user:${targetId}`).to(`user_${targetId}`).emit('comm:message_received', message);
        io.to(dmRoom).to(`user:${targetId}`).to(`user_${targetId}`).emit('new_message', message);
      }
    }
  } catch (err) {
    logger.warn('Socket emission failed in REST sendMessage:', err);
  }

  res.status(201).json({ success: true, data: message });
}

export async function addReaction(req: Request, res: Response) {
  const { userId, tenantId } = getUserAndRequiredTenant(req);
  const { messageId } = req.params;
  const { emoji } = req.body;
  const reaction = await commService.addReaction(tenantId, userId, messageId, emoji);
  res.json({ success: true, data: reaction });
}

export async function getCommHubUsers(req: Request, res: Response) {
  const { userId, tenantId } = getUserAndTenant(req);
  logger.info('Executing GET /communication/users', { userId, tenantId });
  const users = await commService.getCommHubUsersWithPresence(tenantId);
  logger.info('GET /communication/users result count', { count: users.length, tenantId });
  res.json({ success: true, data: users });
}

export async function getCommHubUsersByCommHubId(req: Request, res: Response) {
  const { tenantId: userTenantId, role } = getUserAndTenant(req);
  const requestedCommHubId = req.params.commHubId;

  if (role !== 'SUPERADMIN' && userTenantId !== requestedCommHubId) {
    res.status(403).json({ success: false, error: 'Forbidden: Cannot access users outside your workspace' });
    return;
  }

  logger.info('Executing GET /communication/hubs/:commHubId/users', { requestedCommHubId });
  const users = await commService.getCommHubUsersWithPresence(requestedCommHubId);
  logger.info('GET /communication/hubs/:commHubId/users result count', { count: users.length, requestedCommHubId });
  res.json({ success: true, data: users });
}

export async function updatePresence(req: Request, res: Response) {
  const { userId, tenantId } = getUserAndRequiredTenant(req);
  const parsed = updatePresenceSchema.parse(req.body);
  const presence = await commService.updatePresence(tenantId, userId, parsed.status, parsed.customStatus);
  res.json({ success: true, data: presence });
}

export async function markAsRead(req: Request, res: Response) {
  const { userId, tenantId } = getUserAndRequiredTenant(req);
  const { channelId, targetUserId } = req.body;
  const result = await commService.markConversationAsRead(tenantId, userId, channelId, targetUserId);
  res.json({ success: true, data: result });
}

export async function searchCommunication(req: Request, res: Response) {
  const { userId, tenantId } = getUserAndRequiredTenant(req);
  const q = (req.query.q as string) || '';
  const results = await commService.searchCommunication(tenantId, userId, q);
  res.json({ success: true, data: results });
}

export async function inviteUsers(req: Request, res: Response) {
  const { userId, tenantId } = getUserAndRequiredTenant(req);
  const { emails, channelId } = req.body;
  const result = await commService.inviteUsers(tenantId, userId, Array.isArray(emails) ? emails : [emails], channelId);
  res.json({ success: true, data: result });
}

export async function uploadFile(req: Request, res: Response) {
  if (!req.file) {
    res.status(400).json({ success: false, error: 'No file uploaded' });
    return;
  }
  const fileUrl = `/uploads/communication/${req.file.filename}`;
  res.json({
    success: true,
    data: {
      fileUrl,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype
    }
  });
}

export async function getChannelDetails(req: Request, res: Response) {
  const { userId, tenantId } = getUserAndRequiredTenant(req);
  const { channelId } = req.params;
  const details = await commService.getChannelDetails(tenantId, userId, channelId);
  res.json({ success: true, data: details });
}

export async function archiveChannel(req: Request, res: Response) {
  const { userId, tenantId } = getUserAndRequiredTenant(req);
  const { channelId } = req.params;
  const result = await commService.archiveChannel(tenantId, userId, channelId);
  res.json({ success: true, data: result });
}

export async function deleteChannel(req: Request, res: Response) {
  const { userId, tenantId } = getUserAndRequiredTenant(req);
  const { channelId } = req.params;
  const result = await commService.deleteChannel(tenantId, userId, channelId);
  res.json({ success: true, data: result });
}

export async function pinMessage(req: Request, res: Response) {
  const { userId, tenantId } = getUserAndRequiredTenant(req);
  const { messageId } = req.params;
  const { isPinned } = req.body;
  const updated = await commService.pinMessage(tenantId, userId, messageId, isPinned ?? true);
  res.json({ success: true, data: updated });
}

export async function editMessage(req: Request, res: Response) {
  const { userId, tenantId } = getUserAndRequiredTenant(req);
  const { messageId } = req.params;
  const { content } = req.body;
  const message = await commService.editMessage(tenantId, userId, messageId, content);
  res.json({ success: true, data: message });
}

export async function deleteMessage(req: Request, res: Response) {
  const { userId, tenantId } = getUserAndRequiredTenant(req);
  const { messageId } = req.params;
  await commService.deleteMessage(tenantId, userId, messageId);
  res.json({ success: true });
}

/** LiveKit's own host:port is a SECOND TLS origin the browser has never
 *  visited, so a self-signed dev cert accepted for the app itself doesn't
 *  cover it — the LiveKit connection just silently fails ("Failed to
 *  fetch"). Vite proxies /rtc back to LiveKit on the app's own origin (see
 *  client/vite.config.ts), so mirroring the browser's own Origin/Referer
 *  back as the LiveKit url keeps everything same-origin — one certificate,
 *  works identically over localhost or a LAN IP, no manual trust step. */
function resolvePublicLiveKitUrl(req: Request): string {
  const originHeader = req.headers.origin || req.headers.referer;
  if (originHeader) {
    try {
      const origin = new URL(originHeader);
      const wsProtocol = origin.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${wsProtocol}//${origin.host}`;
    } catch {
      // fall through to server-side default below
    }
  }
  return env.livekit.publicUrl || env.livekit.url;
}

export async function getLiveKitToken(req: Request, res: Response) {
  const user = req.user as { id?: string; fullName?: string; sub?: string };
  const userId = user?.id || user?.sub;
  const userName = user?.fullName || 'Workspace Member';

  if (!userId) {
    logger.warn(`[WebRTC] [Trace] Token requested without authentication`);
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  const { roomId } = req.query;

  if (!roomId || typeof roomId !== 'string') {
    logger.warn(`[WebRTC] [Trace] Token requested without valid roomId by userId: ${userId}`);
    res.status(400).json({ success: false, error: 'Room ID is required' });
    return;
  }

  if (!isCallerAllowedInRoom(userId, roomId)) {
    logger.warn(`[WebRTC] [Trace] userId ${userId} denied token for roomId they are not a participant of: ${roomId}`);
    res.status(403).json({ success: false, error: 'You are not a participant in this call' });
    return;
  }

  if (!env.livekit.enabled) {
    logger.error(`[WebRTC] [Trace] LiveKit token requested but LiveKit is disabled in server environment. roomId: ${roomId}, userId: ${userId}`);
    res.status(500).json({ success: false, error: 'LiveKit is not configured on the server' });
    return;
  }

  logger.info(`[WebRTC] [Trace] Generating LiveKit token for userId: ${userId}, roomId: ${roomId}`);
  try {
    // 1. Explicitly create room first to eliminate connection delay
    const roomService = new RoomServiceClient(env.livekit.url, env.livekit.apiKey, env.livekit.apiSecret);
    try {
      await roomService.createRoom({
        name: roomId,
        emptyTimeout: 10 * 60, // 10 minutes timeout if empty
        maxParticipants: 10,
      });
      logger.debug(`[WebRTC] [Trace] Room ${roomId} explicitly created or already exists.`);
    } catch (roomErr: any) {
      logger.warn(`[WebRTC] [Trace] Room creation skipped or failed (might already exist): ${roomErr.message}`);
    }

    const at = new AccessToken(env.livekit.apiKey, env.livekit.apiSecret, {
      identity: userId,
      name: userName,
    });

    at.addGrant({
      roomJoin: true,
      room: roomId,
      canPublish: true,
      canSubscribe: true,
    });

    const token = await at.toJwt();
    logger.debug(`[WebRTC] [Trace] LiveKit token successfully generated for userId: ${userId}, roomId: ${roomId}`);

    res.json({
      success: true,
      data: {
        token,
        url: resolvePublicLiveKitUrl(req),
      },
    });
  } catch (error: any) {
    logger.error(`[WebRTC] [Trace] Failed to generate LiveKit token for userId: ${userId}, roomId: ${roomId}. Error: ${error.message}`);
    res.status(500).json({ success: false, error: 'Failed to generate token' });
  }
}
