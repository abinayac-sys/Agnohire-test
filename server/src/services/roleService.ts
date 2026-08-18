import type { Request } from 'express';
import { prisma, tenantTransaction } from '../config/database.js';
import { getTenantContext } from '../config/tenantContext.js';
import { recordAudit } from './auditService.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';
import {
  ROLES,
  PERMISSION_DEFS,
  type SetRolePermissionsInput,
  type RoleItem,
  type PermissionDef,
} from '@agnohire/shared';

const VALID_KEYS = new Set<string>(PERMISSION_DEFS.map((p) => p.key));

/**
 * Platform-tier role. Only the super operator may see or edit this; a
 * tenant admin manages every OTHER role but never this one, and it is
 * hidden entirely from non-super logins in the Roles & Permissions screen.
 */
const SUPER_TIER = new Set<string>([ROLES.SUPERADMIN]);
const isSuperTierRequester = (role?: string): boolean => !!role && SUPER_TIER.has(role);

/**
 * The tenant whose role customizations apply to this request, or null for a
 * platform operator (bypass context) who works against the global defaults.
 */
function currentTenantId(): string | null {
  const ctx = getTenantContext();
  return ctx && !ctx.bypass ? ctx.tenantId : null;
}

export async function listRoles(requesterRole?: string): Promise<RoleItem[]> {
  const tenantId = currentTenantId();
  // Internal callers (no requesterRole passed) see everything; a request-scoped
  // call hides the platform-tier roles from anyone who isn't a platform operator.
  const showSuperTier = requesterRole === undefined || isSuperTierRequester(requesterRole);

  const roles = await prisma.role.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true, name: true, displayName: true,
      permissions: { select: { permission: { select: { key: true } } } },
    },
  });

  // Per-tenant overrides (if any) fully replace the global defaults for this
  // tenant, so one tenant's edits never surface in another's.
  const overrides = tenantId
    ? await prisma.tenantRolePermission.findMany({
        where: { tenantId },
        select: { roleId: true, permissionKeys: true },
      })
    : [];
  const overrideByRole = new Map(overrides.map((o) => [o.roleId, o.permissionKeys]));

  // User counts scoped to the active tenant. `user` is a tenant-choked model,
  // so within a tenant request this groupBy is filtered to that tenant
  // automatically (and stays global for platform operators).
  const counts = await prisma.user.groupBy({
    by: ['roleId'],
    where: { deletedAt: null },
    _count: { _all: true },
  });
  const countByRole = new Map(counts.map((c) => [c.roleId, c._count._all]));

  return roles
    .filter((r) => showSuperTier || !SUPER_TIER.has(r.name))
    .map((r) => ({
      id: r.id,
      name: r.name,
      displayName: r.displayName,
      userCount: countByRole.get(r.id) ?? 0,
      // Drop any stale keys for permissions that no longer exist (e.g. a
      // removed feature's keys still sitting in old RolePermission /
      // TenantRolePermission rows) — otherwise the UI can never uncheck them
      // and every Save gets rejected as an "unknown permission".
      permissionKeys: (overrideByRole.get(r.id) ?? r.permissions.map((p) => p.permission.key)).filter((k) => VALID_KEYS.has(k)),
      isSuperadmin: r.name === ROLES.SUPERADMIN,
    }));
}

/** The full catalogue of assignable permissions, grouped by area. */
export function listPermissions(): PermissionDef[] {
  return PERMISSION_DEFS;
}

/**
 * Replaces a role's permission grants. The superadmin role is immutable (it
 * always holds every permission), so editing it is rejected.
 */
export async function setRolePermissions(roleId: string, data: SetRolePermissionsInput, req: Request): Promise<RoleItem> {
  const role = await prisma.role.findUnique({ where: { id: roleId }, select: { id: true, name: true } });
  if (!role) throw new NotFoundError('Role not found');
  if (role.name === ROLES.SUPERADMIN) throw new BadRequestError('The superadmin role always holds every permission and cannot be edited');

  // Platform-tier roles are off-limits to tenant admins: only a platform
  // operator may edit them, and to non-super callers they don't exist (they're
  // filtered out of listRoles), so mirror that with a 404 rather than leaking.
  if (SUPER_TIER.has(role.name) && !isSuperTierRequester(req.user?.role)) {
    throw new NotFoundError('Role not found');
  }

  // Silently drop keys for permissions that no longer exist (e.g. a removed
  // feature) rather than rejecting the whole save — this endpoint replaces
  // the full set each time, so pruning stale keys here is what lets a role
  // self-heal instead of getting stuck unable to save at all.
  const keys = [...new Set(data.permissionKeys)].filter((k) => VALID_KEYS.has(k));

  // A tenant admin (ROLE_MANAGE holder) may configure ANY non-super permission
  // on any non-super role in their tenant, even permissions they don't
  // personally hold — the previous "can't grant what you don't hold" guard is
  // intentionally lifted. Escalation to the platform tier stays impossible: the
  // SUPERADMIN role is immutable and both super-tier roles are blocked above.

  const tenantId = currentTenantId();

  if (tenantId) {
    // Tenant admin: persist a per-tenant override. The global Role.permissions
    // defaults are left untouched, so the change is scoped to this tenant.
    await prisma.tenantRolePermission.upsert({
      where: { tenantId_roleId: { tenantId, roleId } },
      create: { tenantId, roleId, permissionKeys: keys },
      update: { permissionKeys: keys },
    });
  } else {
    // Platform operator (no tenant context): edit the global default set that
    // seeds every tenant which hasn't customized this role.
    const perms = await prisma.permission.findMany({ where: { key: { in: keys } }, select: { id: true } });
    await tenantTransaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId, permissionId: p.id })) });
    });
  }
  await recordAudit(req, { action: 'UPDATE', entity: 'Role', entityId: roleId, description: `Set ${keys.length} permission(s) on role ${role.name}` });

  return (await listRoles()).find((r) => r.id === roleId)!;
}
