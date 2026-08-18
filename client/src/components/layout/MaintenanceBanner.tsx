import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, X } from 'lucide-react';
import { getSocket } from '../../services/socket.js';
import { fetchActiveMaintenance } from '../../services/system.service.js';
import type { MaintenanceWindowDto } from '@agnohire/shared';

interface MaintenanceNoticePayload {
  id: string;
  title: string;
  message: string;
  startAt: string;
  endAt: string;
  phase: 'upcoming' | 'active';
}

/** App-wide warning banner for scheduled maintenance — hydrates on load, updates live via socket. */
export function MaintenanceBanner() {
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [live, setLive] = useState<MaintenanceNoticePayload | null>(null);

  const { data: hydrated } = useQuery({
    queryKey: ['maintenance-active'],
    queryFn: fetchActiveMaintenance,
    refetchInterval: 5 * 60_000,
  });

  useEffect(() => {
    const socket = getSocket();
    const onNotice = (payload: MaintenanceNoticePayload) => setLive(payload);
    socket.on('maintenance:notice', onNotice);
    return () => {
      socket.off('maintenance:notice', onNotice);
    };
  }, []);

  const window_: MaintenanceWindowDto | MaintenanceNoticePayload | null = live ?? hydrated ?? null;
  if (!window_ || window_.id === dismissedId) return null;

  return (
    <div className="flex items-center gap-3 border-b border-border bg-warning/15 px-4 py-2.5 text-sm text-warning sm:px-6">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <p className="min-w-0 flex-1">
        <span className="font-medium">Scheduled maintenance: {window_.title}.</span>{' '}
        {new Date(window_.startAt).toLocaleString()} &rarr; {new Date(window_.endAt).toLocaleString()}. {window_.message}
      </p>
      <button
        aria-label="Dismiss"
        onClick={() => setDismissedId(window_!.id)}
        className="shrink-0 rounded p-1 hover:bg-warning/20"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
