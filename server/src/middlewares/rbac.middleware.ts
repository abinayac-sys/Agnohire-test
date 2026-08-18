import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError, UnauthorizedError } from '../utils/errors.js';
import type { PermissionKey, RoleKey } from '@agnohire/shared';
import { PERMISSIONS, ROLES } from '@agnohire/shared';
import { canManageWorkspaceUsers } from '../services/workspaceMembershipService.js';

/** Requires the authenticated user to hold ALL of the given permissions. */
export function requirePermission(...required: PermissionKey[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new UnauthorizedError());
    // Superadmin bypasses granular checks.
    if (req.user.role === ROLES.SUPERADMIN) return next();
    const held = new Set(req.user.permissions);
    const missing = required.filter((p) => !held.has(p));
    if (missing.length) {
      return next(new ForbiddenError(`Missing permission: ${missing.join(', ')}`));
    }
    next();
  };
}

/** Requires the authenticated user to hold AT LEAST ONE of the given permissions. */
export function requireAnyPermission(...allowed: PermissionKey[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new UnauthorizedError());
    if (req.user.role === ROLES.SUPERADMIN) return next();
    const held = new Set(req.user.permissions);
    if (!allowed.some((p) => held.has(p))) {
      return next(new ForbiddenError(`Missing one of: ${allowed.join(', ')}`));
    }
    next();
  };
}

/**
 * Gate for /api/admin/users: passes for the normal global `user.manage`
 * holder (Admin/Tenant Owner/Superadmin) exactly like requirePermission
 * would, but ALSO passes a narrower-role user (e.g. Recruiter) who lacks
 * `user.manage` tenant-wide if a tenant/org admin has explicitly granted
 * them `canManageUsers` on their CURRENT workspace (see
 * WorkspaceMember.canManageUsers). In that second case, sets
 * `req.workspaceScopedUserManage = true` so adminUserService confines every
 * operation to that one workspace — this middleware only decides "can they
 * reach the route at all," not "which users can they touch."
 */
export function requireUserManage() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) return next(new UnauthorizedError());
    if (req.user.role === ROLES.SUPERADMIN) return next();
    if (new Set(req.user.permissions).has(PERMISSIONS.USER_MANAGE)) return next();
    try {
      const granted = await canManageWorkspaceUsers(
        { sub: req.user.sub, tenantId: req.user.tenantId },
        req.user.workspaceId,
      );
      if (!granted) return next(new ForbiddenError(`Missing permission: ${PERMISSIONS.USER_MANAGE}`));
      req.workspaceScopedUserManage = true;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Requires the authenticated user to have one of the given roles. */
export function requireRole(...roles: RoleKey[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new UnauthorizedError());
    if (req.user.role === ROLES.SUPERADMIN) return next();
    if (!roles.includes(req.user.role)) {
      return next(new ForbiddenError('Insufficient role'));
    }
    next();
  };
}
