import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../utils/tokenHelper.js';
import { AppError, ForbiddenError, ServiceUnavailableError, UnauthorizedError } from '../utils/errors.js';
import { redisProxy } from '../config/redis.js';
import { runWithScope } from '../config/tenantContext.js';
import { getActiveMaintenanceWindow } from '../services/maintenanceService.js';
import { resolveDefaultMembership } from '../services/workspaceMembershipService.js';
import { ROLES } from '@agnohire/shared';

/** Redis key prefix for the access-token revocation list. */
const REVOKED_PREFIX = 'revoked:jti:';

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  if (typeof req.query.token === 'string') return req.query.token;
  return null;
}

/**
 * Resolves the request's organization/workspace scope from the verified
 * token. New tokens carry the claims already (baked in at login/refresh —
 * see authService.buildPayload), so this is a no-op read of the payload.
 * Tokens minted before the Organization/Workspace rollout have the claims
 * entirely ABSENT (not merely null) — for those, and only those, this does a
 * one-time membership lookup and mutates `req.user` so the resolved values
 * persist for the rest of the request (e.g. restoreTenantContext below,
 * re-entered after multer parses a form, never re-queries). This lookup is
 * self-limiting: it only fires until that token expires.
 */
async function resolveRequestScope(req: Request): Promise<{ organizationId: string | null; workspaceId: string | null }> {
  const payload = req.user!;
  if (payload.organizationId !== undefined) {
    return { organizationId: payload.organizationId ?? null, workspaceId: payload.workspaceId ?? null };
  }
  const membership = await resolveDefaultMembership(payload.sub, payload.tenantId ?? null);
  payload.organizationId = membership?.organizationId ?? null;
  payload.workspaceId = membership?.workspaceId ?? null;
  payload.workspaceRole = membership?.workspaceRole ?? null;
  return { organizationId: payload.organizationId, workspaceId: payload.workspaceId };
}

/** Requires a valid, non-revoked access token. Attaches `req.user`. */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractToken(req);
    if (!token) throw new UnauthorizedError('Missing access token');

    const payload = verifyAccessToken(token);

    const revoked = await redisProxy.get(`${REVOKED_PREFIX}${payload.sub}`);
    if (revoked) throw new UnauthorizedError('Session revoked');

    req.user = payload;

    // Scheduled maintenance is live: cut off every already-issued session
    // except the platform superadmin, not just new logins. Otherwise a token
    // minted before the window went ACTIVE keeps working until it naturally
    // expires (up to ACCESS_TOKEN_TTL_MIN, hours later).
    if (payload.role !== ROLES.SUPERADMIN) {
      const activeMaintenance = await getActiveMaintenanceWindow();
      if (activeMaintenance) {
        throw new ServiceUnavailableError('The platform is undergoing scheduled maintenance. Please try again shortly.');
      }
    }

    // Subdomain isolation guard: if the request arrived on a tenant subdomain
    // (<slug>.<root>), the host-resolved tenant MUST match the JWT's tenant.
    // The Host can never override the JWT, so URL/Host manipulation cannot cross
    // tenants. Platform operators (cross-tenant) are exempt. Inert unless
    // APP_ROOT_DOMAIN is configured and the request came on a subdomain.
    if (
      req.hostTenantId &&
      payload.role !== ROLES.SUPERADMIN &&
      payload.tenantId &&
      req.hostTenantId !== payload.tenantId
    ) {
      throw new ForbiddenError('Tenant host does not match your session');
    }

    const { organizationId, workspaceId } = await resolveRequestScope(req);

    // Tenant/organization/workspace isolation choke point: every downstream
    // Prisma query in this request runs inside the principal's scope
    // (fail-closed on tenant; organization/workspace filter opportunistically
    // — see config/database.ts's ORG_WORKSPACE_FILTER_MODELS comment for why
    // those two don't fail closed the way tenant does).
    //
    // No blanket bypass here, even for SUPERADMIN: a superadmin's own
    // tenant data must stay isolated from every other tenant's, same as
    // any other user — including data in a tenant they themselves created.
    // Genuine cross-tenant platform operations (billing, provisioning,
    // config — see routes/platform.routes.ts) opt into cross-tenant access
    // explicitly via runAsPlatform() at the service layer, independent of
    // this request-level context.
    void runWithScope({ tenantId: payload.tenantId ?? null, organizationId, workspaceId }, () => next());
    return;
  } catch (err) {
    if (err instanceof AppError) return next(err);
    next(new UnauthorizedError('Invalid or expired token'));
  }
}

/** Optional auth — attaches req.user if a valid token is present, else continues. */
export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = extractToken(req);
  if (!token) return next();
  try {
    req.user = verifyAccessToken(token);
  } catch {
    /* ignore */
  }
  next();
}

/**
 * Restores the AsyncLocalStorage scope context (e.g. after multer parses forms).
 */
export function restoreTenantContext(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next();
  void runWithScope(
    { tenantId: req.user.tenantId ?? null, organizationId: req.user.organizationId ?? null, workspaceId: req.user.workspaceId ?? null },
    () => next(),
  );
}
