import type { Request, Response } from 'express';
import { env, passwordLoginEnabled } from '../config/env.js';
import * as authService from '../services/authService.js';
import * as attachmentService from '../services/attachmentService.js';
import { runAsPlatform } from '../config/tenantContext.js';
import { recordAudit } from '../services/auditService.js';
import { ok } from '../utils/response.js';
import { BadRequestError } from '../utils/errors.js';
import { devLoginSchema, updateProfileSchema, switchWorkspaceSchema, changePasswordSchema } from '@agnohire/shared';
import type { IssuedTokens } from '../services/authService.js';

const REFRESH_COOKIE = 'agnohire_rt';

export function setRefreshCookie(res: Response, token: string, expires: Date): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: env.isProd ? 'strict' : 'lax',
    expires,
    path: '/api/auth',
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}

function sendTokens(res: Response, tokens: IssuedTokens, status = 200): Response {
  setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt);
  return ok(res, { accessToken: tokens.accessToken, user: tokens.user }, status);
}

/** GET /api/auth/config — tells the client which auth methods are available. */
export function authConfig(_req: Request, res: Response): Response {
  return ok(res, {
    googleEnabled: env.google.enabled,
    devLoginEnabled: passwordLoginEnabled,
  });
}

/** POST /api/auth/dev-login — email/password (dev only). */
export async function devLogin(req: Request, res: Response): Promise<Response> {
  // Production SaaS path: self-registered tenants log in with email/password
  // when ALLOW_PASSWORD_LOGIN=true; legacy dev gate still applies otherwise.
  if (!passwordLoginEnabled) {
    throw new BadRequestError('Email login is disabled. Use Google sign-in.');
  }
  const { email, password } = devLoginSchema.parse(req.body);
  // Pre-auth: no tenant context yet, and login resolves a user by globally
  // unique email across all tenants, so it must bypass RLS on User.
  const tokens = await runAsPlatform(() => authService.devLogin(email, password, req));
  await recordAudit(req, {
    action: 'LOGIN',
    entity: 'User',
    entityId: tokens.user.id,
    description: `Dev login: ${email}`,
  });
  return sendTokens(res, tokens);
}

/** POST /api/auth/refresh — rotate tokens from the httpOnly cookie. */
export async function refresh(req: Request, res: Response): Promise<Response> {
  const token = req.cookies?.[REFRESH_COOKIE];
  // Pre-auth: the refresh cookie is validated and the user re-loaded before any
  // tenant context exists, so this must bypass RLS on User.
  const tokens = await runAsPlatform(() => authService.refresh(token, req));
  return sendTokens(res, tokens);
}

/** POST /api/auth/logout */
export async function logout(req: Request, res: Response): Promise<Response> {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (req.user) {
    await authService.logout(req.user.sub, token);
    await recordAudit(req, {
      action: 'LOGOUT',
      entity: 'User',
      entityId: req.user.sub,
      description: 'User logged out',
    });
  }
  clearRefreshCookie(res);
  return ok(res, { loggedOut: true });
}

/** GET /api/auth/me */
export async function me(req: Request, res: Response): Promise<Response> {
  const user = await authService.getAuthUser(req.user!.sub);
  return ok(res, { user });
}

/** GET /api/auth/memberships — the org->workspace tree the caller can switch into. */
export async function memberships(req: Request, res: Response): Promise<Response> {
  const tree = await authService.listMemberships(req.user!);
  return ok(res, tree);
}

/** POST /api/auth/switch-workspace — re-validates membership, re-issues a scoped token pair. */
export async function switchWorkspace(req: Request, res: Response): Promise<Response> {
  const { workspaceId } = switchWorkspaceSchema.parse(req.body);
  const tokens = await authService.switchWorkspace(req.user!, workspaceId, req);
  await recordAudit(req, {
    action: 'SWITCH_WORKSPACE',
    entity: 'Workspace',
    entityId: workspaceId,
    description: `Switched to workspace ${tokens.user.workspaceName ?? workspaceId}`,
  });
  return sendTokens(res, tokens);
}

export async function profile(req: Request, res: Response): Promise<Response> {
  const data = await authService.getProfile(req.user!.sub);
  return ok(res, { profile: data });
}

export async function updateProfile(req: Request, res: Response): Promise<Response> {
  const data = updateProfileSchema.parse(req.body);
  const updated = await authService.updateProfile(req.user!.sub, data);
  await recordAudit(req, {
    action: 'UPDATE',
    entity: 'User',
    entityId: req.user!.sub,
    description: 'Updated own profile',
  });
  return ok(res, { profile: updated });
}

/** POST /api/auth/change-password — self-service; also how a superadmin-set
 *  password gets replaced by one only the account holder knows. */
export async function changePassword(req: Request, res: Response): Promise<Response> {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
  await authService.changePassword(req.user!.sub, currentPassword, newPassword);
  await recordAudit(req, {
    action: 'UPDATE',
    entity: 'User',
    entityId: req.user!.sub,
    description: 'Changed password',
  });
  const user = await authService.getAuthUser(req.user!.sub);
  return ok(res, { user });
}

export async function uploadAvatar(req: Request, res: Response): Promise<Response> {
  if (!req.file) throw new BadRequestError('No image uploaded.');
  if (!req.file.mimetype.startsWith('image/')) {
    throw new BadRequestError('Avatar must be an image (PNG, JPG, or WebP).');
  }
  const meta = await attachmentService.createAttachment(req.file, req.user!.sub, req);
  const updated = await authService.setAvatarUrl(req.user!.sub, `/api/auth/avatar/${meta.id}`);
  return ok(res, { profile: updated });
}

/** Clears the signed-in user's profile photo (leaves it empty). */
export async function removeAvatar(req: Request, res: Response): Promise<Response> {
  const updated = await authService.setAvatarUrl(req.user!.sub, null);
  return ok(res, { profile: updated });
}

/** Public — serves avatar image bytes so they render in a plain <img> tag. */
export async function serveAvatar(req: Request, res: Response): Promise<void> {
  const { mimeType, buffer } = await attachmentService.getPublicAttachmentFile(req.params.id);
  if (!mimeType.startsWith('image/')) throw new BadRequestError('Not an image.');
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(buffer);
}

/** GET /api/auth/google/callback — called by passport, issues tokens + redirects. */
export async function googleCallback(req: Request, res: Response): Promise<void> {
  const result = req.user as unknown as { userId: string } | undefined;
  if (!result?.userId) {
    res.redirect(`${env.clientUrl}/login?error=oauth_failed`);
    return;
  }
  // Pre-auth (OAuth callback): no tenant context yet — bypass RLS on User.
  const tokens = await runAsPlatform(() => authService.loginByUserId(result.userId, req));
  setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt);
  await recordAudit(req, {
    action: 'LOGIN',
    entity: 'User',
    entityId: tokens.user.id,
    description: `Google OAuth login: ${tokens.user.email}`,
  });
  // Hand the short-lived access token to the SPA via URL fragment.
  res.redirect(`${env.clientUrl}/auth/callback#token=${tokens.accessToken}`);
}
