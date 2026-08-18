import { logger } from '../../../config/logger.js';
import { env } from '../../../config/env.js';

/**
 * Delegated OAuth2 exchange against the Microsoft identity platform. Each
 * workspace brings its own Entra ID app registration (clientId/clientSecret/
 * tenantId), stored per-sector in the Integration row — same pattern as
 * Google's Calendar clientId/secret in calendarService.ts, not Google's
 * global login-OAuth app in env.google. Only the redirect URI is global
 * (AgnoHire's own fixed callback endpoint, env.microsoftRedirectUri).
 */

function authorityUrl(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId}`;
}
function tokenUrl(tenantId: string): string {
  return `${authorityUrl(tenantId)}/oauth2/v2.0/token`;
}
function authorizeUrl(tenantId: string): string {
  return `${authorityUrl(tenantId)}/oauth2/v2.0/authorize`;
}

// Delegated permissions only — no application-level/client-credentials flow.
const SCOPES = ['User.Read', 'Calendars.ReadWrite', 'OnlineMeetings.ReadWrite', 'offline_access'].join(' ');

/** Builds the delegated-consent URL for the Microsoft sign-in/consent screen. */
export function getAuthorizationUrl(args: { clientId: string; tenantId: string }, state?: string): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    response_type: 'code',
    redirect_uri: env.microsoftRedirectUri,
    response_mode: 'query',
    scope: SCOPES,
    ...(state ? { state } : {}),
  });
  return `${authorizeUrl(args.tenantId)}?${params.toString()}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/** Exchanges an authorization code (from the consent redirect) for tokens. */
export async function exchangeCodeForTokens(
  code: string,
  args: { clientId: string; clientSecret: string; tenantId: string },
): Promise<{ accessToken: string | null; refreshToken: string | null; error?: string }> {
  try {
    const body = new URLSearchParams({
      client_id: args.clientId,
      client_secret: args.clientSecret,
      redirect_uri: env.microsoftRedirectUri,
      grant_type: 'authorization_code',
      code,
      scope: SCOPES,
    });
    const res = await fetch(tokenUrl(args.tenantId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = (await res.json().catch(() => null)) as TokenResponse | null;
    if (!res.ok) {
      const detail = json?.error_description || json?.error || `HTTP ${res.status}`;
      logger.error('Microsoft auth code exchange failed', { status: res.status, detail });
      return { accessToken: null, refreshToken: null, error: `Microsoft rejected the code: ${detail}` };
    }
    return {
      accessToken: json?.access_token ?? null,
      refreshToken: json?.refresh_token ?? null,
    };
  } catch (err) {
    const message = (err as Error).message;
    logger.error('Microsoft auth code exchange threw', { err: message });
    return { accessToken: null, refreshToken: null, error: `Token request failed: ${message}` };
  }
}

/**
 * Exchanges a stored refresh token for a fresh access token. Mirrors
 * calendarService.ts:exchangeAccessToken's error-capturing shape so callers
 * can surface the precise Microsoft error to the admin.
 */
export async function refreshAccessToken(
  refreshToken: string,
  args: { clientId: string; clientSecret: string; tenantId: string },
): Promise<{ token: string | null; error?: string }> {
  if (!refreshToken) {
    return { token: null, error: 'No refresh token is configured.' };
  }
  try {
    const body = new URLSearchParams({
      client_id: args.clientId,
      client_secret: args.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: SCOPES,
    });
    const res = await fetch(tokenUrl(args.tenantId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = (await res.json().catch(() => null)) as TokenResponse | null;
    if (!res.ok) {
      const detail = json?.error_description || json?.error || `HTTP ${res.status}`;
      logger.error('Microsoft token refresh failed', { status: res.status, detail });
      return { token: null, error: `Microsoft rejected the credentials: ${detail}` };
    }
    return { token: json?.access_token ?? null };
  } catch (err) {
    const message = (err as Error).message;
    logger.error('Microsoft token refresh threw', { err: message });
    return { token: null, error: `Token request failed: ${message}` };
  }
}
