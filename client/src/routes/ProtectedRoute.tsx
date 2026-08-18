import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore.js';
import { PLATFORM_TENANT_SLUG } from '../utils/tenantPath.js';

/**
 * Gate for any authenticated area. Redirects to /login, preserving intent.
 * When nested under /:tenantSlug, also corrects a stale/wrong/missing
 * slug in the URL (bookmark, typo, another tenant's slug) to the signed-in
 * user's real tenant instead of rendering under the wrong one.
 */
export function ProtectedRoute() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const { tenantSlug } = useParams<{ tenantSlug?: string }>();

  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (tenantSlug !== undefined && user) {
    const realSlug = user.tenantSlug ?? PLATFORM_TENANT_SLUG;
    if (tenantSlug !== realSlug) {
      const rest = location.pathname.split('/').slice(2).join('/');
      return <Navigate to={`/${realSlug}/${rest}${location.search}`} replace />;
    }
  }

  return <Outlet />;
}
