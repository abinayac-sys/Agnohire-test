import { useEffect, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Bell, Check, CheckCheck } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { getSocket } from '../../services/socket.js';
import {
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  clearAllNotifications,
  fetchTenantNotifications,
  fetchTenantUnreadCount,
  markTenantAllRead,
  clearTenantAllNotifications,
} from '../../services/notificationApi.js';
import { SOCKET_EVENTS, type NotificationItem, PERMISSIONS } from '@agnohire/shared';
import { cn } from '../../utils/cn.js';
import { useConfirm } from '../../providers/ConfirmProvider.js';
import { useAuthStore } from '../../store/authStore.js';

/** Bell + dropdown notification center with live Socket.IO updates. */
export function NotificationCenter() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(15);
  const [tab, setTab] = useState<'personal' | 'tenant'>('personal');

  const hasTenantPermission = useAuthStore((s) => s.hasPermission(PERMISSIONS.TENANT_NOTIFICATIONS_VIEW));

  const countQuery = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: fetchUnreadCount,
    refetchInterval: 60_000, // safety net; socket keeps it fresh
  });

  const listQuery = useQuery({
    queryKey: ['notifications', 'list', limit],
    queryFn: () => fetchNotifications({ limit }),
    enabled: open && tab === 'personal',
  });

  const wsCountQuery = useQuery({
    queryKey: ['notifications', 'tenant', 'unread-count'],
    queryFn: fetchTenantUnreadCount,
    enabled: hasTenantPermission,
    refetchInterval: 60_000,
  });

  const wsListQuery = useQuery({
    queryKey: ['notifications', 'tenant', 'list', limit],
    queryFn: () => fetchTenantNotifications({ limit }),
    enabled: open && hasTenantPermission && tab === 'tenant',
  });

  // Reset limit and tab to default when closing the dropdown
  useEffect(() => {
    if (!open) {
      setLimit(15);
      setTab('personal');
    }
  }, [open]);

  // Live: a new notification bumps the count and refreshes the open list.
  useEffect(() => {
    const socket = getSocket();
    const onNew = (_n: NotificationItem) => {
      qc.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
      qc.invalidateQueries({ queryKey: ['notifications', 'list'] });
      if (hasTenantPermission) {
        qc.invalidateQueries({ queryKey: ['notifications', 'tenant'] });
      }
    };
    const onTenantNew = (_n: NotificationItem) => {
      qc.invalidateQueries({ queryKey: ['notifications', 'tenant'] });
    };

    socket.on(SOCKET_EVENTS.NOTIFICATION_NEW, onNew);
    socket.on(SOCKET_EVENTS.TENANT_NOTIFICATION_NEW, onTenantNew);

    return () => {
      socket.off(SOCKET_EVENTS.NOTIFICATION_NEW, onNew);
      socket.off(SOCKET_EVENTS.TENANT_NOTIFICATION_NEW, onTenantNew);
    };
  }, [qc, hasTenantPermission]);

  const readAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
      qc.invalidateQueries({ queryKey: ['notifications', 'list'] });
    },
  });
  const clearAllMutation = useMutation({
    mutationFn: clearAllNotifications,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
      qc.invalidateQueries({ queryKey: ['notifications', 'list'] });
    },
  });

  const markTenantRead = useMutation({
    mutationFn: markTenantAllRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications', 'tenant'] });
    },
  });

  const clearTenantMutation = useMutation({
    mutationFn: clearTenantAllNotifications,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications', 'tenant'] });
    },
  });

  const handleClearAll = async () => {
    const confirmed = await confirm({
      title: 'Clear all notifications?',
      message: 'This action permanently deletes all notifications for your account. This cannot be undone.',
      confirmText: 'Clear All',
      cancelText: 'Cancel',
      variant: 'danger',
    });
    if (confirmed) {
      clearAllMutation.mutate();
    }
  };

  const handleClearTenantAll = async () => {
    const confirmed = await confirm({
      title: 'Clear all workspace notifications?',
      message: 'This action permanently clears all workspace notifications from your view. This cannot be undone.',
      confirmText: 'Clear All',
      cancelText: 'Cancel',
      variant: 'danger',
    });
    if (confirmed) {
      clearTenantMutation.mutate();
    }
  };

  const count = countQuery.data ?? 0;
  const items = listQuery.data?.items ?? [];
  const total = listQuery.data?.meta?.total ?? 0;
  const hasMore = items.length < total;

  const wsCount = wsCountQuery.data ?? 0;
  const wsItems = wsListQuery.data?.items ?? [];
  const wsTotal = wsListQuery.data?.meta?.total ?? 0;
  const wsHasMore = wsItems.length < wsTotal;

  const badgeCount = hasTenantPermission ? count + wsCount : count;

  return (
    <div className="relative">
      <button
        aria-label="Notifications"
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-md p-2 text-text-muted hover:bg-surface-raised hover:text-text-primary"
      >
        <Bell className="h-5 w-5" />
        {badgeCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
            {badgeCount > 99 ? '99+' : badgeCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-12 z-50 w-80 overflow-hidden rounded-lg border border-border bg-surface-raised shadow-elev-2">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <span className="text-sm font-semibold text-text-primary">Notifications</span>
              <div className="flex items-center gap-3">
                {tab === 'personal' ? (
                  <>
                    {count > 0 && (
                      <button
                        onClick={() => readAll.mutate()}
                        className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                      >
                        <CheckCheck className="h-3.5 w-3.5" /> Mark all read
                      </button>
                    )}
                    {items.length > 0 && (
                      <button
                        onClick={handleClearAll}
                        disabled={clearAllMutation.isPending}
                        className="inline-flex items-center gap-1 text-xs text-danger hover:underline disabled:opacity-50"
                      >
                        Clear all
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    {wsCount > 0 && (
                      <button
                        onClick={() => markTenantRead.mutate()}
                        className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                      >
                        <CheckCheck className="h-3.5 w-3.5" /> Mark all read
                      </button>
                    )}
                    {wsItems.length > 0 && (
                      <button
                        onClick={handleClearTenantAll}
                        disabled={clearTenantMutation.isPending}
                        className="inline-flex items-center gap-1 text-xs text-danger hover:underline disabled:opacity-50"
                      >
                        Clear all
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {hasTenantPermission && (
              <div className="flex border-b border-border bg-surface-raised/50 px-2 py-1 text-xs gap-1">
                <button
                  onClick={() => setTab('personal')}
                  className={cn(
                    'pb-1 pt-0.5 border-b-2 px-2 font-medium transition-colors',
                    tab === 'personal'
                      ? 'border-accent text-accent'
                      : 'border-transparent text-text-muted hover:text-text-primary'
                  )}
                >
                  My Notifications {count > 0 && `(${count})`}
                </button>
                <button
                  onClick={() => setTab('tenant')}
                  className={cn(
                    'pb-1 pt-0.5 border-b-2 px-2 font-medium transition-colors',
                    tab === 'tenant'
                      ? 'border-accent text-accent'
                      : 'border-transparent text-text-muted hover:text-text-primary'
                  )}
                >
                  Workspace {wsCount > 0 && `(${wsCount})`}
                </button>
              </div>
            )}

            <div className="max-h-96 overflow-y-auto">
              {tab === 'personal' ? (
                listQuery.isLoading ? (
                  <p className="px-4 py-6 text-center text-sm text-text-muted">Loading…</p>
                ) : items.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-text-muted">You're all caught up.</p>
                ) : (
                  <>
                    <ul>
                      {items.map((n) => (
                        <li
                          key={n.id}
                          className={cn(
                            'flex items-start gap-2 border-b border-border px-4 py-3 last:border-0',
                            !n.isRead && 'bg-accent-muted/30',
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-text-primary">{n.title}</p>
                            <p className="mt-0.5 text-xs text-text-secondary">{n.message}</p>
                            <p className="mt-1 text-[11px] text-text-muted">
                              {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                            </p>
                          </div>
                          {n.isRead && (
                            <div className="p-1 text-text-primary">
                              <Check className="h-4 w-4" />
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                    {hasMore && (
                      <div className="border-t border-border bg-surface-raised p-2 text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setLimit((l) => l + 15);
                          }}
                          className="text-xs text-accent font-semibold hover:underline w-full py-1"
                        >
                          Load more
                        </button>
                      </div>
                    )}
                  </>
                )
              ) : (
                wsListQuery.isLoading ? (
                  <p className="px-4 py-6 text-center text-sm text-text-muted">Loading…</p>
                ) : wsItems.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-text-muted">No workspace notifications.</p>
                ) : (
                  <>
                    <ul>
                      {wsItems.map((n) => (
                        <li
                          key={n.id}
                          className={cn(
                            'flex items-start gap-2 border-b border-border px-4 py-3 last:border-0',
                            !n.isRead && 'bg-accent-muted/30',
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-text-primary">{n.title}</p>
                            <p className="mt-0.5 text-xs text-text-secondary">{n.message}</p>
                            
                            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-text-muted bg-surface-raised p-1 rounded border border-border/50">
                              {n.recipient && (
                                <span>
                                  <span className="font-semibold text-text-secondary">To:</span> {n.recipient.fullName}
                                </span>
                              )}
                              {n.candidateName && (
                                <span>
                                  <span className="font-semibold text-text-secondary">Candidate:</span> {n.candidateName}
                                </span>
                              )}
                              <span>
                                <span className="font-semibold text-text-secondary">Type:</span> {n.type}
                              </span>
                            </div>

                            <p className="mt-1 text-[11px] text-text-muted">
                              {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                            </p>
                          </div>
                          {n.isRead && (
                            <div className="p-1 text-text-primary">
                              <Check className="h-4 w-4" />
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                    {wsHasMore && (
                      <div className="border-t border-border bg-surface-raised p-2 text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setLimit((l) => l + 15);
                          }}
                          className="text-xs text-accent font-semibold hover:underline w-full py-1"
                        >
                          Load more
                        </button>
                      </div>
                    )}
                  </>
                )
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
