import { useEffect, type ReactNode } from 'react';
import { useAuthStore } from '../store/authStore.js';
import { connectSocket, disconnectSocket } from '../services/socket.js';
import { PageSkeleton } from '../components/common/Skeleton.js';

/**
 * Restores the session from the refresh cookie on first load and manages the
 * authenticated Socket.IO connection. Renders a skeleton until the session
 * state is resolved so guarded routes don't flash.
 */
export function AuthBootstrap({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const bootstrap = useAuthStore((s) => s.bootstrap);

  useEffect(() => {
    if (status === 'idle') void bootstrap();
  }, [status, bootstrap]);

  useEffect(() => {
    if (status === 'authenticated') {
      connectSocket();
      return () => disconnectSocket();
    }
  }, [status]);

  if (status === 'idle' || status === 'loading') {
    return <PageSkeleton />;
  }
  return <>{children}</>;
}
