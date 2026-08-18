import type { Request } from 'express';
import { prisma } from '../config/database.js';
import { requireTenantId } from '../config/tenantContext.js';
import { recordAudit } from './auditService.js';
import { canAccessOrganization } from './workspaceMembershipService.js';
import { NotFoundError, ForbiddenError, ConflictError } from '../utils/errors.js';
import {
  ROLES,
  type CreateOrganizationInput,
  type UpdateOrganizationInput,
  type AddOrganizationMemberInput,
  type UpdateOrganizationMemberRoleInput,
  type OrganizationItem,
  type OrganizationMemberItem,
  type JwtPayload,
} from '@agnohire/shared';

const ORG_SELECT = {
  id: true,
  name: true,
  slug: true,
  isActive: true,
  createdAt: true,
  _count: { select: { workspaces: true, members: true } },
} as const;

type OrgRow = {
  id: string;
  name: string;
  slug: string | null;
  isActive: boolean;
  createdAt: Date;
  _count: { workspaces: number; members: number };
};

function toItem(o: OrgRow): OrganizationItem {
  return {
    id: o.id,
    name: o.name,
    slug: o.slug,
    isActive: o.isActive,
    workspaceCount: o._count.workspaces,
    memberCount: o._count.members,
    createdAt: o.createdAt.toISOString(),
  };
}

/**
 * Admin-tier roles (ADMIN/TENANT_OWNER/SUPERADMIN) see every Organization in
 * their own tenant by role — see workspaceMembershipService.canAccessOrganization
 * for the same rationale applied to reads instead of a single-id check.
 */
export async function listOrganizations(caller: Pick<JwtPayload, 'sub' | 'role'>): Promise<OrganizationItem[]> {
  const isAdminTier = caller.role === ROLES.SUPERADMIN || caller.role === ROLES.TENANT_OWNER || caller.role === ROLES.ADMIN;
  const rows = await prisma.organization.findMany({
    where: isAdminTier ? {} : { members: { some: { userId: caller.sub } } },
    select: ORG_SELECT,
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(toItem);
}

/**
 * Row existence alone is not enough: `prisma.organization` is tenant-filtered
 * by the DB choke point, so a row belonging to another org WITHIN the same
 * tenant would otherwise be readable by any authenticated user who merely
 * knows its id, regardless of membership. canAccessOrganization is the same
 * admin-tier-or-member-row check every other org/workspace boundary in this
 * file relies on (see addOrganizationMember et al.) — a 404 here (rather than
 * 403) avoids confirming a non-member's guess that the id even exists.
 */
export async function getOrganization(id: string, caller: Pick<JwtPayload, 'sub' | 'role' | 'tenantId'>): Promise<OrganizationItem> {
  if (!(await canAccessOrganization(caller, id))) throw new NotFoundError('Organization not found');
  const org = await prisma.organization.findUnique({ where: { id }, select: ORG_SELECT });
  if (!org) throw new NotFoundError('Organization not found');
  return toItem(org);
}

export async function createOrganization(data: CreateOrganizationInput, req: Request): Promise<OrganizationItem> {
  const tenantId = requireTenantId();
  // Plan-tier quota, same pattern as every other billable resource (see
  // adminUserService's USERS check) — dynamic import avoids a circular
  // dependency with entitlementService.
  const { assertWithinLimit } = await import('./entitlementService.js');
  await assertWithinLimit(tenantId, 'ORGANIZATIONS', 1);
  if (data.slug) {
    const existing = await prisma.organization.findFirst({ where: { tenantId, slug: data.slug }, select: { id: true } });
    if (existing) throw new ConflictError('An organization with that slug already exists');
  }
  const org = await prisma.organization.create({
    data: { tenantId, name: data.name, slug: data.slug ?? null },
    select: ORG_SELECT,
  });
  await recordAudit(req, { action: 'CREATE', entity: 'Organization', entityId: org.id, description: `Created organization ${org.name}` });
  return toItem(org);
}

export async function updateOrganization(id: string, data: UpdateOrganizationInput, req: Request): Promise<OrganizationItem> {
  const existing = await prisma.organization.findUnique({ where: { id }, select: { id: true, tenantId: true, slug: true } });
  if (!existing) throw new NotFoundError('Organization not found');
  if (data.slug && data.slug !== existing.slug) {
    const clash = await prisma.organization.findFirst({ where: { tenantId: existing.tenantId, slug: data.slug, id: { not: id } }, select: { id: true } });
    if (clash) throw new ConflictError('An organization with that slug already exists');
  }
  const org = await prisma.organization.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.slug !== undefined && { slug: data.slug }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
    },
    select: ORG_SELECT,
  });
  await recordAudit(req, { action: 'UPDATE', entity: 'Organization', entityId: id, description: `Updated organization ${org.name}` });
  return toItem(org);
}

/**
 * Soft delete. Its Workspaces are NOT cascade-deleted — they'd become
 * orphaned from a UX standpoint (still reachable by id, no visible parent) —
 * so the default ("has active workspaces") organization must be emptied
 * first, same defensive pattern as adminSectorService.deleteSector guarding
 * on live dependents.
 */
export async function deleteOrganization(id: string, req: Request): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { id }, select: { id: true, name: true, slug: true } });
  if (!org) throw new NotFoundError('Organization not found');
  if (org.slug === 'default') throw new ForbiddenError('The default organization cannot be deleted');
  const activeWorkspaces = await prisma.workspace.count({ where: { organizationId: id, deletedAt: null } });
  if (activeWorkspaces > 0) throw new ForbiddenError('Remove or move this organization\'s workspaces before deleting it');
  const { assertAboveMinimum } = await import('./entitlementService.js');
  await assertAboveMinimum(requireTenantId(), 'ORGANIZATIONS', 1);
  await prisma.organization.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  await recordAudit(req, { action: 'DELETE', entity: 'Organization', entityId: id, description: `Deleted organization ${org.name}` });
}

// ─── MEMBERS ─────────────────────────────────────────────────────────────────

/** Membership-gated read — same rationale as getOrganization above. */
export async function listOrganizationMembers(organizationId: string, caller: Pick<JwtPayload, 'sub' | 'role' | 'tenantId'>): Promise<OrganizationMemberItem[]> {
  if (!(await canAccessOrganization(caller, organizationId))) throw new NotFoundError('Organization not found');
  const rows = await prisma.organizationMember.findMany({
    where: { organizationId },
    include: { user: { select: { fullName: true, email: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((m) => ({
    userId: m.userId,
    fullName: m.user.fullName,
    email: m.user.email,
    role: m.role as OrganizationMemberItem['role'],
    createdAt: m.createdAt.toISOString(),
  }));
}

export async function addOrganizationMember(organizationId: string, data: AddOrganizationMemberInput, req: Request): Promise<void> {
  const tenantId = requireTenantId();
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!org) throw new NotFoundError('Organization not found');
  const user = await prisma.user.findFirst({ where: { id: data.userId, tenantId }, select: { id: true } });
  if (!user) throw new NotFoundError('User not found in this tenant');
  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId, userId: data.userId } },
    create: { organizationId, tenantId, userId: data.userId, role: data.role },
    update: { role: data.role },
  });
  await recordAudit(req, { action: 'UPDATE', entity: 'Organization', entityId: organizationId, description: `Added member ${data.userId} (${data.role})` });
}

export async function updateOrganizationMemberRole(
  organizationId: string,
  userId: string,
  data: UpdateOrganizationMemberRoleInput,
  req: Request,
): Promise<void> {
  // findFirst + update-by-id, not findUnique/update-by-compound-key: the
  // tenant-scoping choke point (config/database.ts) merges tenantId into
  // `where` on read/update/delete, which only composes with a PLAIN scalar
  // key (e.g. `id`) — merging it alongside a compound-unique wrapper like
  // `organizationId_userId: {...}` produces a shape Prisma's `findFirst`/
  // `update` where-input rejects.
  const member = await prisma.organizationMember.findFirst({ where: { organizationId, userId } });
  if (!member) throw new NotFoundError('Membership not found');
  await prisma.organizationMember.update({ where: { id: member.id }, data: { role: data.role } });
  await recordAudit(req, { action: 'UPDATE', entity: 'Organization', entityId: organizationId, description: `Changed ${userId}'s role to ${data.role}` });
}

export async function removeOrganizationMember(organizationId: string, userId: string, req: Request): Promise<void> {
  const member = await prisma.organizationMember.findFirst({ where: { organizationId, userId } });
  if (!member) throw new NotFoundError('Membership not found');
  await prisma.organizationMember.delete({ where: { id: member.id } });
  await recordAudit(req, { action: 'UPDATE', entity: 'Organization', entityId: organizationId, description: `Removed member ${userId}` });
}
