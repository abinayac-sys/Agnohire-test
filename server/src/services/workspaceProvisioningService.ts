import { prisma } from '../config/database.js';

export interface DefaultOrgWorkspace {
  organizationId: string;
  workspaceId: string;
}

/**
 * Idempotent find-or-create of a tenant's default Organization + Workspace —
 * the same shape the historical backfill migration
 * (20260812091000_organization_workspace_default_backfill) created for every
 * pre-existing tenant, reused here so tenants provisioned AFTER that
 * migration (i.e. through the running app, not a one-time backfill) get the
 * same guarantee: every tenant has at least one Organization/Workspace
 * before any Sector is created for it — Sector.organizationId/workspaceId
 * are NOT NULL.
 */
export async function ensureDefaultOrganizationAndWorkspace(tenantId: string): Promise<DefaultOrgWorkspace> {
  let organization = await prisma.organization.findFirst({ where: { tenantId, slug: 'default' } });
  if (!organization) {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } });
    organization = await prisma.organization.create({
      data: { tenantId, name: `${tenant.name} — Default Organization`, slug: 'default' },
    });
  }
  let workspace = await prisma.workspace.findFirst({ where: { organizationId: organization.id, slug: 'default' } });
  if (!workspace) {
    workspace = await prisma.workspace.create({
      data: { tenantId, organizationId: organization.id, name: 'Default Workspace', slug: 'default' },
    });
  }
  return { organizationId: organization.id, workspaceId: workspace.id };
}

/**
 * Idempotent membership grant: makes `userId` a member of `organizationId` +
 * `workspaceId` with the given container-role tier, unless already a member.
 * TENANT_OWNER/ADMIN/SUPERADMIN never need this called for every workspace
 * they administer — see workspaceMembershipService's admin-bypass rationale.
 */
export async function ensureWorkspaceMembership(
  userId: string,
  tenantId: string,
  organizationId: string,
  workspaceId: string,
  isAdmin: boolean,
): Promise<void> {
  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId, userId } },
    create: { organizationId, tenantId, userId, role: isAdmin ? 'ORG_ADMIN' : 'ORG_MEMBER' },
    update: {},
  });
  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId, userId } },
    create: { workspaceId, tenantId, userId, role: isAdmin ? 'WORKSPACE_ADMIN' : 'WORKSPACE_MEMBER' },
    update: {},
  });
}
