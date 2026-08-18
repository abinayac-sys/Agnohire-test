import { api, unwrap } from './api.js';
import type { ApiResponse, CreateChannelInput, SendMessageInput, UpdatePresenceInput } from '@agnohire/shared';

export interface CommChannel {
  id: string;
  name: string;
  type: string;
  isPrivate: boolean;
  description?: string | null;
  isMember: boolean;
  memberRole?: string | null;
  memberCount: number;
  messageCount: number;
  createdAt: string;
}

export interface CommUser {
  id: string;
  user_id?: string;
  name?: string;
  fullName: string;
  full_name?: string;
  email: string;
  avatarUrl?: string | null;
  profile_image?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  role?: string | null;
  status: 'ONLINE' | 'AWAY' | 'BUSY' | 'INVISIBLE' | 'OFFLINE';
  online_status?: 'ONLINE' | 'AWAY' | 'BUSY' | 'INVISIBLE' | 'OFFLINE';
  customStatus?: string | null;
  lastSeenAt?: string | null;
  last_seen?: string | null;
}

export interface CommMessageStatus {
  userId: string;
  status: 'SENT' | 'DELIVERED' | 'READ';
  readAt?: string | null;
}

export interface CommMessage {
  id: string;
  channelId?: string | null;
  dmPairId?: string | null;
  targetUserId?: string | null;
  sender: {
    id: string;
    fullName: string;
    email: string;
    avatarUrl?: string | null;
  };
  content?: string | null;
  type: 'TEXT' | 'EMOJI' | 'GIF' | 'IMAGE' | 'VIDEO' | 'FILE' | 'AUDIO' | 'VOICE_NOTE';
  mediaUrl?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  replyToId?: string | null;
  replyCount: number;
  isPinned: boolean;
  isStarred: boolean;
  reactions: Array<{ emoji: string; userId: string }>;
  statuses?: CommMessageStatus[];
  editedAt?: string | null;
  deletedAt?: string | null;
  createdAt: string;
}

/** The tenant's single communication hub (CommunicationHub model server-side). */
export interface CommHub {
  id: string;
  tenantId: string;
  name: string;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
}

export const communicationApi = {
  getHubInfo: async (): Promise<CommHub> => {
    const res = await api.get<ApiResponse<CommHub>>('/communication/hub');
    return unwrap(res.data);
  },

  listChannels: async (): Promise<CommChannel[]> => {
    const res = await api.get<ApiResponse<CommChannel[]>>('/communication/channels');
    return unwrap(res.data);
  },

  createChannel: async (data: CreateChannelInput): Promise<CommChannel> => {
    const res = await api.post<ApiResponse<CommChannel>>('/communication/channels', data);
    return unwrap(res.data);
  },

  getChannelDetails: async (channelId: string) => {
    const res = await api.get<ApiResponse<any>>(`/communication/channels/${channelId}`);
    return unwrap(res.data);
  },

  archiveChannel: async (channelId: string) => {
    const res = await api.post<ApiResponse<any>>(`/communication/channels/${channelId}/archive`);
    return unwrap(res.data);
  },

  deleteChannel: async (channelId: string) => {
    const res = await api.delete<ApiResponse<any>>(`/communication/channels/${channelId}`);
    return unwrap(res.data);
  },

  getChannelMessages: async (channelId: string, limit = 50, before?: string): Promise<CommMessage[]> => {
    let url = `/communication/channels/${channelId}/messages?limit=${limit}`;
    if (before) url += `&before=${encodeURIComponent(before)}`;
    const res = await api.get<ApiResponse<CommMessage[]>>(url);
    return unwrap(res.data);
  },

  getDMMessages: async (targetUserId: string, limit = 50, before?: string): Promise<CommMessage[]> => {
    let url = `/communication/dm/${targetUserId}/messages?limit=${limit}`;
    if (before) url += `&before=${encodeURIComponent(before)}`;
    const res = await api.get<ApiResponse<CommMessage[]>>(url);
    return unwrap(res.data);
  },

  sendMessage: async (data: SendMessageInput & { targetUserId?: string; mediaUrl?: string; fileName?: string; fileSize?: number }): Promise<CommMessage> => {
    const res = await api.post<ApiResponse<CommMessage>>('/communication/messages', data);
    return unwrap(res.data);
  },

  addReaction: async (messageId: string, emoji: string) => {
    const res = await api.post<ApiResponse<any>>(`/communication/messages/${messageId}/reactions`, { emoji });
    return unwrap(res.data);
  },

  pinMessage: async (messageId: string, isPinned = true): Promise<CommMessage> => {
    const res = await api.post<ApiResponse<CommMessage>>(`/communication/messages/${messageId}/pin`, { isPinned });
    return unwrap(res.data);
  },

  editMessage: async (messageId: string, content: string): Promise<CommMessage> => {
    const res = await api.patch<ApiResponse<CommMessage>>(`/communication/messages/${messageId}`, { content });
    return unwrap(res.data);
  },

  deleteMessage: async (messageId: string): Promise<boolean> => {
    const res = await api.delete<ApiResponse<any>>(`/communication/messages/${messageId}`);
    return res.data.success;
  },

  /** Roster for the current tenant's hub, or an explicit hub (commHubId) — e.g. platform superadmin browsing a specific tenant's hub. */
  getHubUsers: async (commHubId?: string): Promise<CommUser[]> => {
    const url = commHubId ? `/communication/hubs/${commHubId}/users` : '/communication/users';
    const res = await api.get<ApiResponse<CommUser[]>>(url);
    return unwrap(res.data);
  },

  searchCommunication: async (query: string) => {
    const res = await api.get<ApiResponse<any>>(`/communication/search?q=${encodeURIComponent(query)}`);
    return unwrap(res.data);
  },

  inviteUsers: async (emails: string[], channelId?: string) => {
    const res = await api.post<ApiResponse<any>>('/communication/invitations', { emails, channelId });
    return unwrap(res.data);
  },

  uploadFile: async (file: File): Promise<{ fileUrl: string; fileName: string; fileSize: number }> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await api.post<ApiResponse<{ fileUrl: string; fileName: string; fileSize: number }>>('/communication/files', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    return unwrap(res.data);
  },

  updatePresence: async (data: UpdatePresenceInput) => {
    const res = await api.post<ApiResponse<any>>('/communication/presence', data);
    return unwrap(res.data);
  },

  markAsRead: async (channelId?: string, targetUserId?: string) => {
    const res = await api.post<ApiResponse<any>>('/communication/read', { channelId, targetUserId });
    return unwrap(res.data);
  }
};
