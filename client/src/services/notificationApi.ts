import { api, unwrap } from './api.js';
import type { ApiResponse, Paginated, NotificationItem } from '@agnohire/shared';

export async function fetchNotifications(
  params: { page?: number; limit?: number; unreadOnly?: boolean } = {},
): Promise<Paginated<NotificationItem>> {
  const res = await api.get<ApiResponse<Paginated<NotificationItem>>>('/notifications', { params });
  return unwrap(res.data);
}

export async function fetchUnreadCount(): Promise<number> {
  const res = await api.get<ApiResponse<{ count: number }>>('/notifications/unread-count');
  return unwrap(res.data).count;
}

export async function markNotificationRead(id: string): Promise<void> {
  await api.post(`/notifications/${id}/read`);
}

export async function markAllNotificationsRead(): Promise<void> {
  await api.post('/notifications/read-all');
}

export async function clearAllNotifications(): Promise<void> {
  await api.delete('/notifications/clear-all');
}

export async function fetchTenantNotifications(
  params: { page?: number; limit?: number } = {},
): Promise<Paginated<NotificationItem & { recipient?: { fullName: string; email: string }, candidateName?: string }>> {
  const res = await api.get<ApiResponse<Paginated<NotificationItem & { recipient?: { fullName: string; email: string }, candidateName?: string }>>>('/notifications/tenant', { params });
  return unwrap(res.data);
}

export async function fetchTenantUnreadCount(): Promise<number> {
  const res = await api.get<ApiResponse<{ count: number }>>('/notifications/tenant/unread-count');
  return unwrap(res.data).count;
}

export async function markTenantAllRead(): Promise<void> {
  await api.post('/notifications/tenant/read-all');
}

export async function clearTenantAllNotifications(): Promise<void> {
  await api.delete('/notifications/tenant/clear-all');
}

