import { z } from 'zod';

export const createChannelSchema = z.object({
  name: z.string().min(1, 'Channel name is required').max(80),
  type: z.enum(['GENERAL', 'ANNOUNCEMENT', 'DEPARTMENT', 'TEAM', 'PROJECT', 'DIRECT']).default('GENERAL'),
  isPrivate: z.boolean().default(false),
  description: z.string().optional().nullable(),
});

export const sendMessageSchema = z.object({
  channelId: z.string().optional().nullable(),
  dmPairId: z.string().optional().nullable(),
  targetUserId: z.string().optional().nullable(),
  content: z.string().optional().nullable(),
  type: z.enum(['TEXT', 'EMOJI', 'GIF', 'IMAGE', 'VIDEO', 'FILE', 'AUDIO', 'VOICE_NOTE']).default('TEXT'),
  mediaUrl: z.string().optional().nullable(),
  fileName: z.string().optional().nullable(),
  fileSize: z.number().optional().nullable(),
  replyToId: z.string().optional().nullable(),
});

export const editMessageSchema = z.object({
  content: z.string().min(1, 'Content is required'),
});

export const addReactionSchema = z.object({
  emoji: z.string().min(1, 'Emoji is required'),
});

export const initiateCallSchema = z.object({
  channelId: z.string().optional().nullable(),
  recipientId: z.string().optional().nullable(),
  type: z.enum(['AUDIO', 'VIDEO', 'SCREEN']).default('AUDIO'),
});

export const updatePresenceSchema = z.object({
  status: z.enum(['ONLINE', 'AWAY', 'BUSY', 'INVISIBLE', 'OFFLINE']),
  customStatus: z.string().optional().nullable(),
});

export type CreateChannelInput = z.infer<typeof createChannelSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type EditMessageInput = z.infer<typeof editMessageSchema>;
export type AddReactionInput = z.infer<typeof addReactionSchema>;
export type InitiateCallInput = z.infer<typeof initiateCallSchema>;
export type UpdatePresenceInput = z.infer<typeof updatePresenceSchema>;
