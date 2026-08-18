import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore.js';
import { ROLE_HOME } from '@agnohire/shared';
import { withTenant } from '../utils/tenantPath.js';

/** Sends '/' to the role's home, or to login if unauthenticated. */
export function RootRedirect() {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={withTenant(ROLE_HOME[user.role], user.tenantSlug)} replace />;
}
