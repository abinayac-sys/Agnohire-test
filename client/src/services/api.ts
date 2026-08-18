import axios, {
  AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios';
import type { ApiError, ApiResponse } from '@agnohire/shared';

/**
 * Axios instance with:
 *  - in-memory access token injection
 *  - automatic refresh on 401 (single-flight, queued retries)
 *  - response unwrapping to the ApiResponse envelope
 */
let accessToken: string | null = null;
const tokenListeners = new Set<(t: string | null) => void>();

export function setAccessToken(token: string | null): void {
  accessToken = token;
  // Keep the "probably has a session" hint in step so cold loads only call
  // /auth/refresh when a refresh cookie plausibly exists (avoids 401 noise).
  if (token) localStorage.setItem('agnohire.hasSession', '1');
  else localStorage.removeItem('agnohire.hasSession');
  tokenListeners.forEach((fn) => fn(token));
}
export function getAccessToken(): string | null {
  return accessToken;
}
export function onTokenChange(fn: (t: string | null) => void): () => void {
  tokenListeners.add(fn);
  return () => tokenListeners.delete(fn);
}

/**
 * Fired specifically when a background refresh (triggered by a 401 on some
 * other request) comes back invalid/expired — NOT on an explicit user
 * logout, which never goes through refreshAccessToken(). The auth store uses
 * this to drop the stale session so ProtectedRoute redirects to /login
 * immediately instead of the app silently re-401ing on every request until
 * the user manually reloads.
 */
let refreshFailureHandler: (() => void) | null = null;
export function onRefreshFailure(fn: () => void): void {
  refreshFailureHandler = fn;
}

export const api: AxiosInstance = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) {
    config.headers.set('Authorization', `Bearer ${accessToken}`);
  }
  return config;
});

let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  try {
    const res = await axios.post<ApiResponse<{ accessToken: string }>>(
      '/api/auth/refresh',
      {},
      { withCredentials: true },
    );
    if (res.data.success) {
      setAccessToken(res.data.data.accessToken);
      return res.data.data.accessToken;
    }
  } catch {
    /* fall through */
  }
  setAccessToken(null);
  refreshFailureHandler?.();
  return null;
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    const status = error.response?.status;
    const url = original?.url ?? '';

    // Don't try to refresh the refresh/login endpoints themselves.
    const isAuthEndpoint = url.includes('/auth/refresh') || url.includes('/auth/dev-login');

    if (status === 401 && !original._retry && !isAuthEndpoint) {
      original._retry = true;
      refreshing ??= refreshAccessToken().finally(() => {
        refreshing = null;
      });
      const token = await refreshing;
      if (token) {
        original.headers.set('Authorization', `Bearer ${token}`);
        return api(original);
      }
    }
    return Promise.reject(error);
  },
);

/**
 * Extracts a human-readable message from an axios error. Every call site in
 * the app funnels error display through here, so this is the one place that
 * decides what the user actually sees — never axios's own technical strings
 * ("Request failed with status code 400", "Network Error", "timeout of
 * 20000ms exceeded") and never a bare "Validation failed" when the response
 * actually told us which field(s) failed.
 */
export function apiErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(error)) {
    // No response reached the client at all — dropped connection, DNS
    // failure, CORS rejection, or a timeout. Distinguish the timeout case
    // (transient, worth a retry) from a plain connectivity problem.
    if (!error.response) {
      if (error.code === 'ECONNABORTED' || /timeout/i.test(error.message)) {
        return 'The request took too long to respond. Please check your connection and try again.';
      }
      return 'Unable to reach the server. Please check your internet connection and try again.';
    }

    const data = error.response.data as ApiError | undefined;
    if (data && !data.success) {
      // Field-level validation errors (400s from validate.middleware) carry a
      // details map the generic `error.message` ("Validation failed") never
      // surfaces — show the actual per-field reasons instead.
      const fieldMessages = data.error.details ? Object.values(data.error.details).flat() : [];
      if (fieldMessages.length > 0) return fieldMessages.join(' ');
      return data.error.message;
    }
    // A response came back but not in our API envelope shape — fall back to
    // the caller's friendly default rather than axios's raw status-code text.
    return fallback;
  }
  return fallback;
}

/** Unwrap a successful ApiResponse, throwing the error envelope otherwise. */
export function unwrap<T>(res: ApiResponse<T>): T {
  if (res.success) return res.data;
  throw new Error(res.error.message);
}
