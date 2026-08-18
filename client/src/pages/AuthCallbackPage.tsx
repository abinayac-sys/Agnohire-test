import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { setAccessToken } from '../services/api.js';
import { fetchMe } from '../services/auth.service.js';
import { useAuthStore } from '../store/authStore.js';
import { ROLE_HOME } from '@agnohire/shared';
import { PageSkeleton } from '../components/common/Skeleton.js';
import { withTenant } from '../utils/tenantPath.js';

/**
 * Handles the Google OAuth redirect: reads the access token from the URL
 * fragment, hydrates the session, and routes to the role home.
 */
export function AuthCallbackPage() {
  const navigate = useNavigate();
  const setUser = useAuthStore((s) => s.setUser);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get('token');
    if (!token) {
      navigate('/login?error=missing_token', { replace: true });
      return;
    }
    setAccessToken(token);
    fetchMe()
      .then((user) => {
        setUser(user);
        navigate(withTenant(ROLE_HOME[user.role], user.tenantSlug), { replace: true });
      })
      .catch(() => navigate('/login?error=session_failed', { replace: true }));
  }, [navigate, setUser]);

  return <PageSkeleton />;
}
