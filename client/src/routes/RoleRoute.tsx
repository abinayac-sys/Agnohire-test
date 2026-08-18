import { Navigate, Outlet } from 'react-router-dom';
import type { RoleKey } from '@agnohire/shared';
import { useAuthStore } from '../store/authStore.js';

/** Restricts a branch of the tree to specific roles. */
export function RoleRoute({ roles }: { roles: RoleKey[] }) {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  const allowed = useAuthStore.getState().hasRole(...roles);
  if (!allowed) return <Navigate to="/unauthorized" replace />;
  return <Outlet />;
}
