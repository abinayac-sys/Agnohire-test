import { api, setAccessToken, unwrap } from './api.js';
import type { ApiResponse, AuthUser, ProfileDetails, UpdateProfileInput } from '@agnohire/shared';

interface LoginResult {
  accessToken: string;
  user: AuthUser;
}

/**
 * Local hint that a refresh cookie probably exists. The cookie is httpOnly, so
 * this flag is how we avoid firing a guaranteed-401 /auth/refresh on every
 * cold load for logged-out visitors (the browser logs those as console errors).
 */
const SESSION_HINT_KEY = 'agnohire.hasSession';
const hasSessionHint = () => localStorage.getItem(SESSION_HINT_KEY) === '1';
const setSessionHint = (on: boolean) => {
  if (on) localStorage.setItem(SESSION_HINT_KEY, '1');
  else localStorage.removeItem(SESSION_HINT_KEY);
};

export interface AuthMethods {
  googleEnabled: boolean;
  devLoginEnabled: boolean;
}

export async function fetchAuthMethods(): Promise<AuthMethods> {
  const res = await api.get<ApiResponse<AuthMethods>>('/auth/config');
  return unwrap(res.data);
}

export async function devLogin(email: string, password: string): Promise<AuthUser> {
  const res = await api.post<ApiResponse<LoginResult>>('/auth/dev-login', {
    email,
    password,
  });
  const data = unwrap(res.data);
  setAccessToken(data.accessToken);
  setSessionHint(true);
  return data.user;
}

export async function fetchMe(): Promise<AuthUser> {
  const res = await api.get<ApiResponse<{ user: AuthUser }>>('/auth/me');
  return unwrap(res.data).user;
}

export async function fetchProfile(): Promise<ProfileDetails> {
  const res = await api.get<ApiResponse<{ profile: ProfileDetails }>>('/auth/profile');
  return unwrap(res.data).profile;
}

export async function updateProfile(data: UpdateProfileInput): Promise<ProfileDetails> {
  const res = await api.patch<ApiResponse<{ profile: ProfileDetails }>>('/auth/profile', data);
  return unwrap(res.data).profile;
}

export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<AuthUser> {
  const res = await api.post<ApiResponse<{ user: AuthUser }>>('/auth/change-password', input);
  return unwrap(res.data).user;
}

export async function uploadAvatar(file: File): Promise<ProfileDetails> {
  const form = new FormData();
  form.append('file', file);
  const res = await api.post<ApiResponse<{ profile: ProfileDetails }>>(
    '/auth/profile/avatar',
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return unwrap(res.data).profile;
}

export async function removeAvatar(): Promise<ProfileDetails> {
  const res = await api.delete<ApiResponse<{ profile: ProfileDetails }>>('/auth/profile/avatar');
  return unwrap(res.data).profile;
}

// Single-flight guard: two callers racing to restore the session (e.g. React
// StrictMode's dev-only double mount, or any other double-invoke) share one
// in-flight request instead of firing two POST /auth/refresh calls.
let refreshInFlight: Promise<AuthUser | null> | null = null;

export function refreshSession(): Promise<AuthUser | null> {
  if (!hasSessionHint()) return Promise.resolve(null);
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const res = await api.post<ApiResponse<LoginResult>>('/auth/refresh', {});
      const data = unwrap(res.data);
      setAccessToken(data.accessToken);
      setSessionHint(true);
      return data.user;
    } catch {
      setSessionHint(false);
      return null;
    }
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout', {});
  } finally {
    setAccessToken(null);
    setSessionHint(false);
  }
}
