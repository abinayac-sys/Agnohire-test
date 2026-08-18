import type { Request } from 'express';
import { prisma } from '../config/database.js';
import { requireTenantId } from '../config/tenantContext.js';
import { recordAudit } from './auditService.js';
import { canAccessWorkspace } from './workspaceMembershipService.js';
import { NotFoundError, ForbiddenError, ConflictError } from '../utils/errors.js';
import {
  ROLES,
  type CreateWorkspaceInput,
  type UpdateWorkspaceInput,
  type AddWorkspaceMemberInput,
  type UpdateWorkspaceMemberRoleInput,
  type WorkspaceItem,
  type WorkspaceMemberItem,
  type JwtPayload,
} from '@agnohire/shared';

const WORKSPACE_SELECT = {
  id: true,
  organizationId: true,
  name: true,
  slug: true,
  isActive: true,
  createdAt: true,
  _count: { select: { members: true } },
} as const;

type WorkspaceRow = {
  id: string;
  organizationId: string;
  name: string;
  slug: string | null;
  isActive: boolean;
  createdAt: Date;
  _count: { members: number };
};

function toItem(w: WorkspaceRow): WorkspaceItem {
  return {
    id: w.id,
    organizationId: w.organizationId,
    name: w.name,
    slug: w.slug,
    isActive: w.isActive,
    memberCount: w._count.members,
    createdAt: w.createdAt.toISOString(),
  };
}

/** Same admin-tier-by-role rationale as organizationService.listOrganizations. */
export async function listWorkspaces(caller: Pick<JwtPayload, 'sub' | 'role'>, organizationId?: string): Promise<WorkspaceItem[]> {
  const isAdminTier = caller.role === ROLES.SUPERADMIN || caller.role === ROLES.TENANT_OWNER || caller.role === ROLES.ADMIN;
  const rows = await prisma.workspace.findMany({
    where: {
      ...(organizationId ? { organizationId } : {}),
      ...(isAdminTier ? {} : { members: { some: { userId: caller.sub } } }),
    },
    select: WORKSPACE_SELECT,
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(toItem);
}

/** Same membership-gated-read rationale as organizationService.getOrganization. */
export async function getWorkspace(id: string, caller: Pick<JwtPayload, 'sub' | 'role' | 'tenantId'>): Promise<WorkspaceItem> {
  if (!(await canAccessWorkspace(caller, id))) throw new NotFoundError('Workspace not found');
  const workspace = await prisma.workspace.findUnique({ where: { id }, select: WORKSPACE_SELECT });
  if (!workspace) throw new NotFoundError('Workspace not found');
  return toItem(workspace);
}

export async function createWorkspace(data: CreateWorkspaceInput, req: Request): Promise<WorkspaceItem> {
  const tenantId = requireTenantId();
  // Plan-tier quota, same pattern as organizationService.createOrganization —
  // scoped to the whole tenant (across every Organization it owns), matching
  // how Subscription/Plan are tenant-level, not per-org.
  const { assertWithinLimit } = await import('./entitlementService.js');
  await assertWithinLimit(tenantId, 'WORKSPACES', 1);
  const org = await prisma.organization.findUnique({ where: { id: data.organizationId }, select: { id: true } });
  if (!org) throw new NotFoundError('Organization not found');
  if (data.slug) {
    const existing = await prisma.workspace.findFirst({ where: { organizationId: data.organizationId, slug: data.slug }, select: { id: true } });
    if (existing) throw new ConflictError('A workspace with that slug already exists in this organization');
  }
  const workspace = await prisma.workspace.create({
    data: { tenantId, organizationId: data.organizationId, name: data.name, slug: data.slug ?? null },
    select: WORKSPACE_SELECT,
  });
  await recordAudit(req, { action: 'CREATE', entity: 'Workspace', entityId: workspace.id, description: `Created workspace ${workspace.name}` });
  return toItem(workspace);
}

export async function updateWorkspace(id: string, data: UpdateWorkspaceInput, req: Request): Promise<WorkspaceItem> {
  const existing = await prisma.workspace.findUnique({ where: { id }, select: { id: true, organizationId: true, slug: true } });
  if (!existing) throw new NotFoundError('Workspace not found');
  if (data.slug && data.slug !== existing.slug) {
    const clash = await prisma.workspace.findFirst({ where: { organizationId: existing.organizationId, slug: data.slug, id: { not: id } }, select: { id: true } });
    if (clash) throw new ConflictError('A workspace with that slug already exists in this organization');
  }
  const workspace = await prisma.workspace.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.slug !== undefined && { slug: data.slug }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
    },
    select: WORKSPACE_SELECT,
  });
  await recordAudit(req, { action: 'UPDATE', entity: 'Workspace', entityId: id, description: `Updated workspace ${workspace.name}` });
  return toItem(workspace);
}

/**
 * Soft delete, blocked while any live Sector still points at this workspace
 * (Sector.workspaceId is NOT NULL — a Sector can never be left dangling).
 * The tenant's default workspace can never be deleted: every Sector backfilled
 * from the historical migration lives there, and it's the fallback every
 * pre-rollout token resolves to.
 */
export async function deleteWorkspace(id: string, req: Request): Promise<void> {
  const workspace = await prisma.workspace.findUnique({ where: { id }, select: { id: true, name: true, slug: true } });
  if (!workspace) throw new NotFoundError('Workspace not found');
  if (workspace.slug === 'default') throw new ForbiddenError('The default workspace cannot be deleted');
  const activeSectors = await prisma.sector.count({ where: { workspaceId: id, deletedAt: null } });
  if (activeSectors > 0) throw new ForbiddenError('Move this workspace\'s sectors elsewhere before deleting it');
  const { assertAboveMinimum } = await import('./entitlementService.js');
  await assertAboveMinimum(requireTenantId(), 'WORKSPACES', 1);
  await prisma.workspace.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  await recordAudit(req, { action: 'DELETE', entity: 'Workspace', entityId: id, description: `Deleted workspace ${workspace.name}` });
}

// ─── MEMBERS ─────────────────────────────────────────────────────────────────

/** Membership-gated read — same rationale as getWorkspace above. */
export async function listWorkspaceMembers(workspaceId: string, caller: Pick<JwtPayload, 'sub' | 'role' | 'tenantId'>): Promise<WorkspaceMemberItem[]> {
  if (!(await canAccessWorkspace(caller, workspaceId))) throw new NotFoundError('Workspace not found');
  const rows = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    include: { user: { select: { fullName: true, email: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((m) => ({
    userId: m.userId,
    fullName: m.user.fullName,
    email: m.user.email,
    role: m.role as WorkspaceMemberItem['role'],
    canManageUsers: m.canManageUsers,
    createdAt: m.createdAt.toISOString(),
  }));
}

/**
 * Both the create and update branches below are reachable only via routes
 * gated on `workspace.manage` (see workspace.routes.ts's `MANAGE` middleware)
 * — a tenant/org admin — so `canManageUsers` never needs a separate
 * authorization check here: reaching this function at all IS the grant
 * described in its own doc comment on the schema/model.
 */
export async function addWorkspaceMember(workspaceId: string, data: AddWorkspaceMemberInput, req: Request): Promise<void> {
  const tenantId = requireTenantId();
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
  if (!workspace) throw new NotFoundError('Workspace not found');
  const user = await prisma.user.findFirst({ where: { id: data.userId, tenantId }, select: { id: true } });
  if (!user) throw new NotFoundError('User not found in this tenant');
  const canManageUsers = data.canManageUsers ?? false;
  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId, userId: data.userId } },
    create: { workspaceId, tenantId, userId: data.userId, role: data.role, canManageUsers },
    update: { role: data.role, canManageUsers },
  });
  await recordAudit(req, { action: 'UPDATE', entity: 'Workspace', entityId: workspaceId, description: `Added member ${data.userId} (${data.role})` });
}

export async function updateWorkspaceMemberRole(
  workspaceId: string,
  userId: string,
  data: UpdateWorkspaceMemberRoleInput,
  req: Request,
): Promise<void> {
  // findFirst + update-by-id, not findUnique/update-by-compound-key — see
  // organizationService.updateOrganizationMemberRole's comment for why.
  const member = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId } });
  if (!member) throw new NotFoundError('Membership not found');
  await prisma.workspaceMember.update({
    where: { id: member.id },
    data: {
      ...(data.role !== undefined && { role: data.role }),
      ...(data.canManageUsers !== undefined && { canManageUsers: data.canManageUsers }),
    },
  });
  await recordAudit(req, { action: 'UPDATE', entity: 'Workspace', entityId: workspaceId, description: `Updated ${userId}'s workspace membership` });
}

export async function removeWorkspaceMember(workspaceId: string, userId: string, req: Request): Promise<void> {
  const member = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId } });
  if (!member) throw new NotFoundError('Membership not found');
  await prisma.workspaceMember.delete({ where: { id: member.id } });
  await recordAudit(req, { action: 'UPDATE', entity: 'Workspace', entityId: workspaceId, description: `Removed member ${userId}` });
}
