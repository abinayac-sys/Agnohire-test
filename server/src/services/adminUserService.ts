import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { prisma } from '../config/database.js';
import { runAsPlatform, requireTenantId, requireWorkspaceId } from '../config/tenantContext.js';
import { recordAudit } from './auditService.js';
import { hashPassword, revokeUserSessions } from './authService.js';
import { assertSectorExists } from './adminSectorService.js';
import { ensureWorkspaceMembership } from './workspaceProvisioningService.js';
import { sendMail } from './mailerService.js';
import { adminMessageEmail } from './emailTemplates.js';
import { paginate } from '../utils/response.js';
import { anonymizedUserFields } from '../utils/piiAnonymize.js';
import { NotFoundError, BadRequestError, ConflictError, ForbiddenError } from '../utils/errors.js';
import {
  ROLES,
  type UserFilters,
  type CreateUserInput,
  type UpdateUserInput,
  type AdminResetPasswordInput,
  type AdminUserItem,
  type SendUserMessageInput,
  type EmailLogFilters,
  type MessageSendResult,
  type EmailLogItem,
} from '@agnohire/shared';

const SELECT = {
  id: true, fullName: true, email: true, phone: true, isActive: true,
  lastLoginAt: true, createdAt: true, roleId: true, sectorId: true, workspaceId: true,
  role: { select: { name: true } },
  sector: { select: { name: true } },
} satisfies Prisma.UserSelect;

// User.workspaceId is a denormalized scalar with no Prisma relation (see
// schema.prisma) — unlike sector/role, its display name needs a separate
// lookup. resolveWorkspaceNames batches that for a page of rows in one query.
async function resolveWorkspaceNames(workspaceIds: Array<string | null>): Promise<Map<string, string>> {
  const ids = [...new Set(workspaceIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();
  const rows = await prisma.workspace.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return new Map(rows.map((w) => [w.id, w.name]));
}

function toItem(u: {
  id: string; fullName: string; email: string; phone: string | null;
  isActive: boolean; lastLoginAt: Date | null; createdAt: Date;
  roleId: string; sectorId: string | null; workspaceId: string | null;
  role: { name: string }; sector: { name: string } | null;
}, workspaceName: string | null = null): AdminUserItem {
  return {
    id: u.id, fullName: u.fullName, email: u.email, phone: u.phone,
    roleId: u.roleId, roleName: u.role.name,
    sectorId: u.sectorId, sectorName: u.sector?.name ?? null,
    workspaceId: u.workspaceId, workspaceName,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

export async function listUsers(filters: UserFilters, req: Request) {
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    // A workspace-scoped-only caller (see requireUserManage) never sees the
    // full tenant roster — only the users actually stamped into their own
    // workspace, the same boundary create/update/delete enforce below.
    ...(req.workspaceScopedUserManage ? { workspaceId: req.user!.workspaceId } : {}),
    ...(filters.roleId ? { roleId: filters.roleId } : {}),
    ...(filters.sectorId ? { sectorId: filters.sectorId } : {}),
    ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
    ...(filters.search
      ? { OR: [
          { fullName: { contains: filters.search, mode: 'insensitive' } },
          { email: { contains: filters.search, mode: 'insensitive' } },
        ] }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where, select: SELECT,
      orderBy: { createdAt: filters.sortOrder },
      skip: (filters.page - 1) * filters.limit, take: filters.limit,
    }),
    prisma.user.count({ where }),
  ]);
  const workspaceNames = await resolveWorkspaceNames(rows.map((r) => r.workspaceId));
  return paginate(rows.map((r) => toItem(r, r.workspaceId ? workspaceNames.get(r.workspaceId) ?? null : null)), total, filters.page, filters.limit);
}

async function assertRoleExists(roleId: string) {
  const role = await prisma.role.findUnique({ where: { id: roleId }, select: { id: true, name: true } });
  if (!role) throw new BadRequestError('Unknown role');
  return role;
}

/**
 * Privilege-escalation guard: the SUPERADMIN role may only be assigned by a
 * SUPERADMIN. Without this, any USER_MANAGE holder (e.g. ADMIN) could mint or
 * promote superadmins and bypass the role hierarchy entirely.
 *
 * `scoped` additionally blocks EVERY admin-tier role (SUPERADMIN/ADMIN/
 * TENANT_OWNER) for a caller who only reached this route via a
 * workspace-scoped canManageUsers grant (see requireUserManage) — that grant
 * is meant to cover ordinary staff (HR/Recruiter/etc.) within one workspace,
 * not a path to mint tenant-wide admins.
 */
async function assertCanAssignRole(roleId: string, actorRole: string | undefined, scoped: boolean): Promise<void> {
  const role = await assertRoleExists(roleId);
  if (role.name === ROLES.SUPERADMIN && actorRole !== ROLES.SUPERADMIN) {
    throw new ForbiddenError('Only a superadmin can assign the superadmin role');
  }
  if (scoped && (role.name === ROLES.SUPERADMIN || role.name === ROLES.ADMIN || role.name === ROLES.TENANT_OWNER)) {
    throw new ForbiddenError('A workspace-scoped user manager cannot assign an admin-tier role');
  }
}

/** Throws NotFoundError (never 403 — don't confirm the id exists) when a workspace-scoped caller targets a user outside their own workspace. */
function assertTargetInWorkspaceScope(target: { workspaceId: string | null }, req: Request): void {
  if (req.workspaceScopedUserManage && target.workspaceId !== req.user!.workspaceId) {
    throw new NotFoundError('User not found');
  }
}

/** A sector, if given, must belong to the SAME workspace the new/restored user is being placed into. */
async function assertSectorMatchesWorkspace(sectorId: string | null | undefined, workspaceId: string): Promise<void> {
  if (!sectorId) return;
  const sector = await prisma.sector.findFirst({ where: { id: sectorId }, select: { workspaceId: true } });
  if (!sector || sector.workspaceId !== workspaceId) {
    throw new BadRequestError('That sector does not belong to the target workspace');
  }
}

interface TargetWorkspace {
  organizationId: string;
  workspaceId: string;
  workspaceName: string;
}

/**
 * Resolves which Organization/Workspace a new (or restored) user is placed
 * into. Omitting `workspaceId` preserves the historical behavior — the
 * CALLER's own current ambient workspace. Explicitly choosing one is
 * authorized against the caller's OWN authority, not just "is this a real
 * workspace": a caller who only reached /admin/users via a workspace-scoped
 * canManageUsers grant (see requireUserManage) may target ONLY their own
 * workspace; a full `user.manage` holder may target any workspace in their
 * own tenant (prisma.workspace is tenant-filtered by the DB choke point —
 * see config/database.ts — so this can never resolve another tenant's row).
 */
async function resolveTargetWorkspace(req: Request, workspaceId: string | undefined): Promise<TargetWorkspace> {
  const targetId = workspaceId ?? requireWorkspaceId();
  if (workspaceId && req.workspaceScopedUserManage && workspaceId !== req.user!.workspaceId) {
    throw new ForbiddenError('You can only create users in your own workspace');
  }
  const workspace = await prisma.workspace.findFirst({ where: { id: targetId }, select: { organizationId: true, name: true } });
  if (!workspace) throw new BadRequestError('Unknown workspace');
  return { organizationId: workspace.organizationId, workspaceId: targetId, workspaceName: workspace.name };
}

export async function createUser(data: CreateUserInput, req: Request): Promise<AdminUserItem> {
  const email = data.email;
  const tenantId = req.user?.tenantId ?? null;

  await assertCanAssignRole(data.roleId, req.user?.role, req.workspaceScopedUserManage === true);
  await assertSectorExists(data.sectorId);
  const target = await resolveTargetWorkspace(req, data.workspaceId);
  await assertSectorMatchesWorkspace(data.sectorId, target.workspaceId);

  // User.email is unique among LIVE users across ALL tenants (partial index
  // User_email_active_key), so the dedup check must see every tenant (bypass RLS)
  // — otherwise a clash with another tenant slips past and surfaces as a raw
  // P2002. Same reason the tombstone lookup below runs under bypass.
  const live = await runAsPlatform(() =>
    prisma.user.findFirst({ where: { email, deletedAt: null }, select: { id: true } }),
  );
  if (live) throw new ConflictError('A user with that email already exists');

  // Legacy path: deleteUser now anonymizes the email on delete (see
  // anonymizedUserFields), so a NEW deletion can never leave a real email
  // sitting on a tombstone — this lookup will simply find nothing for it,
  // and execution falls through to create a fresh row below. It only still
  // matches rows soft-deleted before that change shipped, where the real
  // email is what's on record; for those, restore within the same tenant
  // rather than creating a duplicate.
  //
  // Several tombstones may now share one email (the index is partial), so take the
  // most recently deleted.
  const tombstone = await runAsPlatform(() =>
    prisma.user.findFirst({
      where: { email, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      select: { id: true, tenantId: true },
    }),
  );

  // Restore ONLY within the caller's own tenant. Reviving another tenant's
  // deleted user would silently move an identity across the tenant boundary —
  // the single most important line in this function. Note the checks above ran
  // under runAsPlatform (bypassing RLS), so this comparison must be explicit in
  // code; the middleware will not do it for us.
  const isRestore = tombstone !== null && tombstone.tenantId === tenantId;

  if (tombstone && !isRestore) {
    // A tombstone in some other tenant. Don't restore it, and don't leak which
    // tenant holds it.
    throw new ConflictError(
      'That email belongs to a deleted account in another workspace and cannot be reused here.',
    );
  }

  // Quota: only a genuinely NEW row consumes a seat. A restore re-occupies the seat
  // that deleteUser already gave back, so counting it again would stop a tenant at
  // its maxUsers ceiling from restoring a user it had just deleted.
  if (!isRestore && req.user?.tenantId) {
    const { assertWithinLimit } = await import('./entitlementService.js');
    await assertWithinLimit(req.user.tenantId, 'USERS', 1);
  }

  const passwordHash = await hashPassword(data.password);

  if (isRestore) {
    const restored = await prisma.user.update({
      where: { id: tombstone!.id },
      data: {
        fullName: data.fullName,
        phone: data.phone ?? null,
        roleId: data.roleId,
        sectorId: data.sectorId ?? null,
        passwordHash,
        isActive: true,
        deletedAt: null,
        // Reset every auth-adjacent field so the restored account carries no stale
        // lockout, half-finished reset, or live verify token from its past life.
        loginAttempts: 0,
        lockedUntil: null,
        resetToken: null,
        resetTokenExp: null,
        lastLoginAt: null,
        // Explicit, not ambient-stamped: a restore targets whichever
        // workspace resolveTargetWorkspace resolved above, same as a fresh
        // create — see the comment on the create call below.
        organizationId: target.organizationId,
        workspaceId: target.workspaceId,
        // tenantId is deliberately untouched — we just proved it equals ours.
      },
      select: SELECT,
    });
    // deleteUser already revoked sessions, but a restore mints a new password and
    // may assign a new role, so kill anything that survived.
    await revokeUserSessions(restored.id);
    // Idempotent — a no-op if the restored user's old membership row survived
    // the soft-delete, otherwise grants a fresh one (see the create path below).
    await ensureWorkspaceMembership(restored.id, requireTenantId(), target.organizationId, target.workspaceId, false);
    await recordAudit(req, {
      action: 'CREATE',
      entity: 'User',
      entityId: restored.id,
      description: `Restored previously deleted user ${email}`,
      newValue: { restored: true, email },
    });
    return toItem(restored, target.workspaceName);
  }

  const user = await prisma.user.create({
    data: {
      fullName: data.fullName,
      email,
      phone: data.phone ?? null,
      roleId: data.roleId,
      sectorId: data.sectorId ?? null,
      passwordHash,
      isActive: true,
      // Explicit, not ambient-stamped: config/database.ts's STAMP_MODELS
      // middleware only fills organizationId/workspaceId when the create
      // call leaves them undefined, so passing the RESOLVED target here
      // (the caller's own ambient workspace by default, or whichever
      // workspace they explicitly chose — see resolveTargetWorkspace) is
      // what actually makes an explicit workspace selection take effect.
      organizationId: target.organizationId,
      workspaceId: target.workspaceId,
    },
    select: SELECT,
  });
  // Grants a plain WORKSPACE_MEMBER row in the TARGET workspace, so this
  // user's first login resolves a real workspace instead of null — without
  // one, once workspace_isolation RLS is enabled (see config/database.ts), a
  // non-admin-role user with no membership would be unable to see any
  // Sector/JobRequisition at all. Container-admin rights (if this person
  // should manage the workspace itself) are granted separately, later,
  // through workspace membership management.
  await ensureWorkspaceMembership(user.id, requireTenantId(), target.organizationId, target.workspaceId, false);
  await recordAudit(req, { action: 'CREATE', entity: 'User', entityId: user.id, description: `Created user ${email}` });
  return toItem(user, target.workspaceName);
}

async function load(id: string) {
  const u = await prisma.user.findUnique({ where: { id }, select: { id: true, roleId: true, email: true, workspaceId: true, role: { select: { name: true } } } });
  if (!u) throw new NotFoundError('User not found');
  return u;
}

const ADMIN_TIER_ROLE_NAMES = new Set<string>([ROLES.SUPERADMIN, ROLES.ADMIN, ROLES.TENANT_OWNER]);

export async function updateUser(id: string, data: UpdateUserInput, req: Request, actingUserId: string): Promise<AdminUserItem> {
  const target = await load(id);
  assertTargetInWorkspaceScope(target, req);
  if (req.workspaceScopedUserManage && ADMIN_TIER_ROLE_NAMES.has(target.role.name)) {
    throw new NotFoundError('User not found');
  }
  if (data.roleId) await assertCanAssignRole(data.roleId, req.user?.role, req.workspaceScopedUserManage === true);
  if (data.sectorId !== undefined) {
    await assertSectorExists(data.sectorId);
    // updateUser never moves a user to a different workspace — only their
    // sector, which must stay consistent with the workspace they're
    // ALREADY in (target.workspaceId), not the caller's.
    if (target.workspaceId) await assertSectorMatchesWorkspace(data.sectorId, target.workspaceId);
  }

  // A role change is only "real" if it actually moves to a different role.
  const roleChanged = data.roleId !== undefined && data.roleId !== target.roleId;

  // Guard rails: you cannot deactivate or change your own role (avoids locking
  // yourself out of admin), and you cannot remove the last active superadmin.
  if (id === actingUserId) {
    if (data.isActive === false) throw new BadRequestError('You cannot deactivate your own account');
    if (roleChanged) throw new BadRequestError('You cannot change your own role');
  }
  if (target.role.name === ROLES.SUPERADMIN && (data.isActive === false || roleChanged)) {
    if (await isLastActiveSuperadmin(id)) {
      throw new BadRequestError('Cannot deactivate or change the role of the last active superadmin');
    }
  }

  const user = await prisma.user.update({
    where: { id },
    data: {
      ...(data.fullName !== undefined && { fullName: data.fullName }),
      ...(data.roleId !== undefined && { roleId: data.roleId }),
      ...(data.sectorId !== undefined && { sectorId: data.sectorId }),
      ...(data.phone !== undefined && { phone: data.phone }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
    },
    select: SELECT,
  });
  // Deactivation or a role/permission change must take effect immediately —
  // kill the user's live sessions so their existing access token (with its old
  // role) can't keep working until it expires.
  if (data.isActive === false || roleChanged) {
    await revokeUserSessions(id);
  }
  await recordAudit(req, { action: 'UPDATE', entity: 'User', entityId: id, description: `Updated user ${user.email}` });
  const workspaceNames = await resolveWorkspaceNames([user.workspaceId]);
  return toItem(user, user.workspaceId ? workspaceNames.get(user.workspaceId) ?? null : null);
}

/** True when `id` is the only remaining active superadmin. */
async function isLastActiveSuperadmin(id: string): Promise<boolean> {
  const superRole = await prisma.role.findUnique({ where: { name: ROLES.SUPERADMIN }, select: { id: true } });
  if (!superRole) return false;
  const others = await prisma.user.count({ where: { roleId: superRole.id, isActive: true, id: { not: id } } });
  return others === 0;
}

export async function setUserActive(id: string, isActive: boolean, req: Request, actingUserId: string): Promise<AdminUserItem> {
  return updateUser(id, { isActive }, req, actingUserId);
}

export async function resetPassword(id: string, data: AdminResetPasswordInput, req: Request): Promise<void> {
  const target = await load(id);
  assertTargetInWorkspaceScope(target, req);
  if (req.workspaceScopedUserManage && ADMIN_TIER_ROLE_NAMES.has(target.role.name)) {
    throw new NotFoundError('User not found');
  }
  await prisma.user.update({
    where: { id },
    data: { passwordHash: await hashPassword(data.password), loginAttempts: 0, lockedUntil: null },
  });
  // A password reset invalidates existing sessions (forces re-login).
  await revokeUserSessions(id);
  // Never log the password itself.
  await recordAudit(req, { action: 'UPDATE', entity: 'User', entityId: id, description: 'Reset user password' });
}

// ─── MESSAGING + EMAIL LOG ─────────────────────────────────────────────────────

/** Sends a custom email to the selected active users (superadmin/admin → users). */
export async function sendUserMessage(
  senderId: string,
  data: SendUserMessageInput,
  req: Request,
): Promise<MessageSendResult> {
  const sender = await prisma.user.findUnique({
    where: { id: senderId },
    select: { fullName: true },
  });
  const senderName = sender?.fullName ?? 'AgnoHire Admin';
  const users = await prisma.user.findMany({
    where: {
      id: { in: data.recipientIds },
      deletedAt: null,
      isActive: true,
      // Same workspace boundary as list/create/update/delete — a
      // workspace-scoped caller can't message a user outside their own
      // workspace even if they somehow know the id.
      ...(req.workspaceScopedUserManage ? { workspaceId: req.user!.workspaceId } : {}),
    },
    select: { id: true, fullName: true, email: true },
  });
  if (users.length === 0) throw new BadRequestError('No active recipients found.');

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const u of users) {
    const { subject, html } = await adminMessageEmail({
      recipientName: u.fullName,
      senderName,
      subject: data.subject,
      message: data.message,
    });
    const r = await sendMail({ to: u.email, subject, html, templateId: 'admin-message' });
    if (r.sent) sent++;
    else if (r.skipped) skipped++;
    else failed++;
  }

  await recordAudit(req, {
    action: 'EMAIL',
    entity: 'User',
    description: `Messaged ${users.length} user(s): "${data.subject}"`,
  });

  return { total: users.length, sent, failed, skipped };
}

/** Paginated email delivery log for the Admin Console. */
export async function listEmailLogs(filters: EmailLogFilters) {
  const where: Prisma.EmailLogWhereInput = {
    ...(filters.status && { status: filters.status }),
    ...(filters.search && {
      OR: [
        { toEmail: { contains: filters.search, mode: 'insensitive' } },
        { subject: { contains: filters.search, mode: 'insensitive' } },
      ],
    }),
  };
  const [total, rows] = await Promise.all([
    prisma.emailLog.count({ where }),
    prisma.emailLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
    }),
  ]);
  const items: EmailLogItem[] = rows.map((r) => ({
    id: r.id,
    toEmail: r.toEmail,
    subject: r.subject,
    templateId: r.templateId,
    status: r.status as EmailLogItem['status'],
    errorMsg: r.errorMsg,
    sentAt: r.sentAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
  return paginate(items, total, filters.page, filters.limit);
}

export async function deleteUser(id: string, req: Request, actingUserId: string): Promise<void> {
  const target = await load(id);
  assertTargetInWorkspaceScope(target, req);
  if (req.workspaceScopedUserManage && ADMIN_TIER_ROLE_NAMES.has(target.role.name)) {
    throw new NotFoundError('User not found');
  }
  if (id === actingUserId) {
    throw new BadRequestError('You cannot delete your own account');
  }
  if (target.role.name === ROLES.SUPERADMIN) {
    if (await isLastActiveSuperadmin(id)) {
      throw new BadRequestError('Cannot delete the last active superadmin');
    }
  }
  const { assertAboveMinimum } = await import('./entitlementService.js');
  await assertAboveMinimum(requireTenantId(), 'USERS', 1);

  await prisma.user.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false, ...anonymizedUserFields(id) },
  });
  await revokeUserSessions(id);
  // The original email is captured here (from `target`, read before the
  // anonymizing update above) since the row itself no longer holds it —
  // this is the only remaining record of who was deleted.
  await recordAudit(req, { action: 'DELETE', entity: 'User', entityId: id, description: `Deleted user ${id} (${target.email})` });
}

