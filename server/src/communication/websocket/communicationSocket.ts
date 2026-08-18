import type { Server as SocketIOServer, Socket } from 'socket.io';
import { logger } from '../../config/logger.js';
import * as commService from '../services/communicationService.js';
import { deriveDMRoomId } from '../services/directMessageService.js';
import { isCallerAllowedInRoom } from '../../controllers/communication.controller.js';

export function initCommunicationSocket(io: SocketIOServer) {
  io.on('connection', (socket: Socket) => {
    const user = socket.data.user as { id?: string; sub?: string; tenantId?: string | null } | undefined;
    const userId = user?.sub || user?.id;
    const tenantId = user?.tenantId || null;

    if (!userId) {
      logger.warn('Socket connection missing valid user ID');
      return;
    }

    // A superadmin's own (non-impersonated) session has no tenant — there's
    // no single workspace for it to chat in, so every tenant-scoped feature
    // below requires one and no-ops rather than writing bogus placeholder
    // tenant ids ('global', 'system') into tenant-scoped tables.
    function requireTenantOrWarn(action: string): boolean {
      if (tenantId) return true;
      logger.warn(`Socket ${action} skipped — no tenant on session`, { userId });
      return false;
    }

    // Room identifiers
    const workspaceRoom = tenantId ? `workspace_${tenantId}` : 'workspace_global';
    const legacyTenantRoom = tenantId ? `tenant:${tenantId}` : 'tenant:global';

    // ─── 1. AUTOMATIC WORKSPACE ROOM JOIN & PRESENCE ──────────────────────────────
    socket.join(workspaceRoom);
    socket.join(legacyTenantRoom);
    socket.join(`user:${userId}`);
    socket.join(`user_${userId}`);

    // Update in-memory and DB presence to ONLINE on connection
    commService.markUserOnline(userId);
    if (tenantId) commService.updatePresence(tenantId, userId, 'ONLINE').catch(() => {});

    // Broadcast online status to workspace
    io.to(workspaceRoom).to(legacyTenantRoom).emit('user_online', { userId, status: 'ONLINE' });
    io.to(workspaceRoom).to(legacyTenantRoom).emit('comm:presence_updated', { userId, status: 'ONLINE' });

    // Handle Socket Disconnection (use 'disconnecting' to access rooms before they are cleared)
    socket.on('disconnecting', () => {
      // Notify WebRTC rooms about user leaving
      const rooms = Array.from(socket.rooms).filter(r => r.startsWith('webrtc_'));
      rooms.forEach(roomId => {
        socket.to(roomId).emit('user-left', { userId });
      });
    });

    socket.on('disconnect', () => {
      logger.info('Socket disconnected', { userId });
      commService.markUserOffline(userId);
      if (tenantId) commService.updatePresence(tenantId, userId, 'OFFLINE').catch(() => {});
      io.to(workspaceRoom).to(legacyTenantRoom).emit('user_offline', { userId, status: 'OFFLINE' });
      io.to(workspaceRoom).to(legacyTenantRoom).emit('comm:presence_updated', { userId, status: 'OFFLINE' });
    });

    // ─── 2. WORKSPACE EVENT HANDLERS ─────────────────────────────────────────────
    socket.on('join_workspace', (targetTenantId: string) => {
      if (!targetTenantId || targetTenantId === tenantId) {
        socket.join(workspaceRoom);
      } else {
        logger.warn('Socket attempted to join unauthorized workspace', { userId, targetTenantId, tenantId });
      }
    });

    socket.on('leave_workspace', () => {
      socket.leave(workspaceRoom);
    });

    // ─── 3. CHANNEL EVENT HANDLERS ────────────────────────────────────────────────
    socket.on('join_channel', async (channelId: string) => {
      if (typeof channelId !== 'string' || !requireTenantOrWarn('join_channel')) return;
      try {
        await commService.joinChannel(tenantId as string, userId, channelId);
        socket.join(`channel_${channelId}`);
        socket.join(`comm:channel:${channelId}`);
      } catch (err) {
        logger.warn('Failed to join communication channel room', { channelId, userId });
      }
    });

    socket.on('comm:join_channel', async (channelId: string) => {
      if (typeof channelId !== 'string' || !requireTenantOrWarn('join_channel')) return;
      try {
        await commService.joinChannel(tenantId as string, userId, channelId);
        socket.join(`channel_${channelId}`);
        socket.join(`comm:channel:${channelId}`);
      } catch (err) {
        logger.warn('Failed to join communication channel room', { channelId, userId });
      }
    });

    socket.on('leave_channel', (channelId: string) => {
      if (typeof channelId === 'string') {
        socket.leave(`channel_${channelId}`);
        socket.leave(`comm:channel:${channelId}`);
      }
    });

    socket.on('comm:leave_channel', (channelId: string) => {
      if (typeof channelId === 'string') {
        socket.leave(`channel_${channelId}`);
        socket.leave(`comm:channel:${channelId}`);
      }
    });

    // ─── 4. DIRECT MESSAGE ROOM HANDLERS ──────────────────────────────────────────
    socket.on('join_dm', (data: { targetUserId: string }) => {
      if (!data || !data.targetUserId) return;
      const dmRoom = deriveDMRoomId(userId, data.targetUserId);
      socket.join(dmRoom);
    });

    socket.on('create_dm', async (data: { targetUserId: string }, ack?: Function) => {
      if (!data || !data.targetUserId) return;
      const dmRoom = deriveDMRoomId(userId, data.targetUserId);
      socket.join(dmRoom);
      if (ack) ack({ success: true, dmRoomId: dmRoom });
    });

    // ─── 5. INSTANT MESSAGING EVENT HANDLERS ─────────────────────────────────────
    const handleSendMessage = async (data: any, ack?: Function) => {
      if (!requireTenantOrWarn('send_message')) {
        if (ack) ack({ success: false, error: 'No tenant on session' });
        return;
      }
      try {
        const message = await commService.sendMessage(tenantId as string, userId, data);
        if (ack) ack({ success: true, data: message });

        if (message.channelId) {
          const channelRoom = `channel_${message.channelId}`;
          const legacyChannelRoom = `comm:channel:${message.channelId}`;
          io.to(channelRoom).to(legacyChannelRoom).emit('receive_message', message);
          io.to(channelRoom).to(legacyChannelRoom).emit('comm:message_received', message);
          io.to(channelRoom).to(legacyChannelRoom).emit('new_message', message);
        } else if (message.dmPairId || data.targetUserId) {
          const targetId = data.targetUserId || message.targetUserId || message.dmPairId?.split(':').find(id => id !== userId);
          if (targetId) {
            const dmRoom = deriveDMRoomId(userId, targetId);
            socket.join(dmRoom);

            // Broadcast instantly to DM room AND target user rooms AND sender rooms AND workspace
            io.to(dmRoom).emit('receive_message', message);
            io.to(dmRoom).emit('comm:message_received', message);
            io.to(dmRoom).emit('new_message', message);

            io.to(`user:${targetId}`).to(`user_${targetId}`).emit('receive_message', message);
            io.to(`user:${targetId}`).to(`user_${targetId}`).emit('comm:message_received', message);
            io.to(`user:${targetId}`).to(`user_${targetId}`).emit('new_message', message);

            io.to(`user:${userId}`).to(`user_${userId}`).emit('receive_message', message);
            io.to(`user:${userId}`).to(`user_${userId}`).emit('comm:message_received', message);
          }
        }
      } catch (err: any) {
        logger.error('Error handling socket send_message', { error: err.message, userId });
        if (ack) ack({ success: false, error: err.message });
      }
    };

    socket.on('send_message', handleSendMessage);
    socket.on('comm:send_message', handleSendMessage);

    // ─── 6. TYPING INDICATOR HANDLERS ─────────────────────────────────────────────
    socket.on('typing_start', (data: { channelId?: string; targetUserId?: string }) => {
      const payload = { userId, isTyping: true, channelId: data.channelId, targetUserId: data.targetUserId };
      if (data.channelId) {
        socket.to(`channel_${data.channelId}`).to(`comm:channel:${data.channelId}`).emit('typing_start', payload);
        socket.to(`channel_${data.channelId}`).to(`comm:channel:${data.channelId}`).emit('comm:user_typing', payload);
      } else if (data.targetUserId) {
        const dmRoom = deriveDMRoomId(userId, data.targetUserId);
        socket.to(dmRoom).to(`user:${data.targetUserId}`).to(`user_${data.targetUserId}`).emit('typing_start', payload);
        socket.to(dmRoom).to(`user:${data.targetUserId}`).to(`user_${data.targetUserId}`).emit('comm:user_typing', payload);
      }
    });

    socket.on('comm:typing_start', (data: { channelId?: string; targetUserId?: string }) => {
      const payload = { userId, isTyping: true, channelId: data.channelId, targetUserId: data.targetUserId };
      if (data.channelId) {
        socket.to(`channel_${data.channelId}`).to(`comm:channel:${data.channelId}`).emit('comm:user_typing', payload);
      } else if (data.targetUserId) {
        const dmRoom = deriveDMRoomId(userId, data.targetUserId);
        socket.to(dmRoom).to(`user:${data.targetUserId}`).to(`user_${data.targetUserId}`).emit('comm:user_typing', payload);
      }
    });

    socket.on('typing_stop', (data: { channelId?: string; targetUserId?: string }) => {
      const payload = { userId, isTyping: false, channelId: data.channelId, targetUserId: data.targetUserId };
      if (data.channelId) {
        socket.to(`channel_${data.channelId}`).to(`comm:channel:${data.channelId}`).emit('typing_stop', payload);
        socket.to(`channel_${data.channelId}`).to(`comm:channel:${data.channelId}`).emit('comm:user_typing', payload);
      } else if (data.targetUserId) {
        const dmRoom = deriveDMRoomId(userId, data.targetUserId);
        socket.to(dmRoom).to(`user:${data.targetUserId}`).to(`user_${data.targetUserId}`).emit('typing_stop', payload);
        socket.to(dmRoom).to(`user:${data.targetUserId}`).to(`user_${data.targetUserId}`).emit('comm:user_typing', payload);
      }
    });

    socket.on('comm:typing_stop', (data: { channelId?: string; targetUserId?: string }) => {
      const payload = { userId, isTyping: false, channelId: data.channelId, targetUserId: data.targetUserId };
      if (data.channelId) {
        socket.to(`channel_${data.channelId}`).to(`comm:channel:${data.channelId}`).emit('comm:user_typing', payload);
      } else if (data.targetUserId) {
        const dmRoom = deriveDMRoomId(userId, data.targetUserId);
        socket.to(dmRoom).to(`user:${data.targetUserId}`).to(`user_${data.targetUserId}`).emit('comm:user_typing', payload);
      }
    });

    // ─── 7. READ RECEIPTS & STATUS HANDLERS ───────────────────────────────────────
    socket.on('message_read', async (data: { messageId: string; channelId?: string; targetUserId?: string }) => {
      if (!tenantId) return;
      try {
        await commService.markMessageAsRead(tenantId, data.messageId, userId);
        const payload = { messageId: data.messageId, readByUserId: userId, status: 'READ' };
        if (data.channelId) {
          io.to(`channel_${data.channelId}`).emit('message_read', payload);
        } else if (data.targetUserId) {
          const dmRoom = deriveDMRoomId(userId, data.targetUserId);
          io.to(dmRoom).to(`user:${data.targetUserId}`).to(`user_${data.targetUserId}`).emit('message_read', payload);
        }
      } catch {}
    });

    socket.on('message_delivered', (data: { messageId: string; targetUserId?: string }) => {
      if (data.targetUserId) {
        const dmRoom = deriveDMRoomId(userId, data.targetUserId);
        io.to(dmRoom).to(`user:${data.targetUserId}`).to(`user_${data.targetUserId}`).emit('message_delivered', { messageId: data.messageId, userId, status: 'DELIVERED' });
      }
    });

    // ─── 8. PRESENCE CHANGE EVENTS ────────────────────────────────────────────────
    socket.on('comm:presence_change', async (data: { status: string; customStatus?: string }) => {
      if (!tenantId) return;
      try {
        await commService.updatePresence(tenantId, userId, data.status, data.customStatus);
        io.to(workspaceRoom).to(legacyTenantRoom).emit('comm:presence_updated', {
          userId,
          status: data.status,
          customStatus: data.customStatus
        });
      } catch {}
    });

    // ─── 9. WEBRTC SIGNALING HANDLERS (PRODUCTION-READY) ────────────────────────
    socket.on('join-room', (data: { roomId: string }) => {
      if (!data.roomId) return;
      if (!isCallerAllowedInRoom(userId, data.roomId)) {
        logger.warn(`[WebRTC] [Trace] userId ${userId} denied join-room for a call they are not a participant of: ${data.roomId}`);
        return;
      }
      logger.info(`[WebRTC] [Trace] userId ${userId} joining socket room: webrtc_${data.roomId}`);
      socket.join(`webrtc_${data.roomId}`);
      socket.to(`webrtc_${data.roomId}`).emit('user-joined', { userId });
    });

    socket.on('call-request', (data: { targetUserId: string; type: string; roomId: string }) => {
      logger.info(`[WebRTC] [Trace] 'call-request' received from userId: ${userId} to targetUserId: ${data.targetUserId}, roomId: ${data.roomId}, type: ${data.type}`);
      io.to(`user:${data.targetUserId}`).to(`user_${data.targetUserId}`).emit('call-request', {
        callerId: userId,
        type: data.type,
        roomId: data.roomId
      });
      logger.debug(`[WebRTC] [Trace] 'call-request' emitted to user:${data.targetUserId}`);
    });

    socket.on('call-accepted', (data: { callerId: string; roomId: string }) => {
      logger.info(`[WebRTC] [Trace] 'call-accepted' received from responder (userId: ${userId}) for callerId: ${data.callerId}, roomId: ${data.roomId}`);
      io.to(`user:${data.callerId}`).to(`user_${data.callerId}`).emit('call-accepted', {
        responderId: userId,
        roomId: data.roomId
      });
      logger.debug(`[WebRTC] [Trace] 'call-accepted' emitted to caller user:${data.callerId}`);
    });

    socket.on('call-rejected', (data: { callerId: string }) => {
      logger.info(`[WebRTC] [Trace] 'call-rejected' received from responder (userId: ${userId}) for callerId: ${data.callerId}`);
      io.to(`user:${data.callerId}`).to(`user_${data.callerId}`).emit('call-rejected', {
        responderId: userId
      });
    });

    socket.on('call-ended', (data: { roomId: string; targetUserId?: string }) => {
      logger.info(`[WebRTC] [Trace] 'call-ended' received from userId: ${userId}, roomId: ${data.roomId || 'N/A'}, targetUserId: ${data.targetUserId || 'N/A'}`);
      if (data.roomId) {
        socket.to(`webrtc_${data.roomId}`).emit('call-ended', { senderId: userId });
        logger.debug(`[WebRTC] [Trace] 'call-ended' emitted to room webrtc_${data.roomId}. Leaving room.`);
        socket.leave(`webrtc_${data.roomId}`);
      }
      if (data.targetUserId) {
        io.to(`user:${data.targetUserId}`).to(`user_${data.targetUserId}`).emit('call-ended', { senderId: userId });
        logger.debug(`[WebRTC] [Trace] 'call-ended' emitted to user:${data.targetUserId}`);
      }
    });
    // ─── 10. PHASE 2 - SHARED NOTES & MEETINGS SYNC ──────────────────────────────
    socket.on('join_meeting', (data: { meetingId: string }) => {
      if (data.meetingId) {
        socket.join(`meeting_${data.meetingId}`);
      }
    });

    socket.on('leave_meeting', (data: { meetingId: string }) => {
      if (data.meetingId) {
        socket.leave(`meeting_${data.meetingId}`);
      }
    });

    socket.on('note_update', (data: { noteId: string; meetingId?: string; channelId?: string; content: string }) => {
      const room = data.meetingId ? `meeting_${data.meetingId}` : data.channelId ? `channel_${data.channelId}` : null;
      if (room) {
        socket.to(room).emit('note_updated', {
          noteId: data.noteId,
          content: data.content,
          editedBy: userId
        });
      }
    });

    socket.on('task_update', (data: { taskId: string; status: string }) => {
      io.to(workspaceRoom).emit('task_updated', {
        taskId: data.taskId,
        status: data.status,
        updatedBy: userId
      });
    });
  });
}
