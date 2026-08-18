import { prisma } from '../config/database.js';
import { ROLES, type WorkspaceRoleKey, type OrgRoleKey, type RoleKey, type MembershipTree, type MembershipOrganization } from '@agnohire/shared';

export interface ResolvedMembership {
  organizationId: string;
  organizationName: string;
  workspaceId: string;
  workspaceName: string;
  workspaceRole: WorkspaceRoleKey;
  /** Explicit tenant/org-admin grant — see WorkspaceMember.canManageUsers. */
  canManageUsers: boolean;
}

/**
 * The workspace a user lands in at login/refresh: their `slug: 'default'`
 * workspace if they're a member of it, else their earliest membership. Every
 * existing tenant has exactly one workspace (the default-backfill
 * migration), so for the overwhelming majority of users this is
 * unambiguous. Returns null for platform users (no tenant) and for anyone
 * with no membership row at all (pre-rollout token about to self-heal, or a
 * user created by code that hasn't been updated to grant membership yet —
 * treated as "no workspace scope resolved," never as a denial).
 */
export async function resolveDefaultMembership(userId: string, tenantId: string | null): Promise<ResolvedMembership | null> {
  if (!tenantId) return null;
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId, tenantId },
    include: { workspace: { include: { organization: true } } },
    orderBy: { createdAt: 'asc' },
  });
  if (memberships.length === 0) return null;
  const chosen = memberships.find((m) => m.workspace.slug === 'default') ?? memberships[0];
  return {
    organizationId: chosen.workspace.organizationId,
    organizationName: chosen.workspace.organization.name,
    workspaceId: chosen.workspaceId,
    workspaceName: chosen.workspace.name,
    workspaceRole: chosen.role as WorkspaceRoleKey,
    canManageUsers: chosen.canManageUsers,
  };
}

interface ScopedUser {
  sub: string;
  role: RoleKey;
  tenantId?: string | null;
}

const ADMIN_TIER_ROLES: RoleKey[] = [ROLES.SUPERADMIN, ROLES.TENANT_OWNER, ROLES.ADMIN];

function isAdminTier(role: RoleKey): boolean {
  return ADMIN_TIER_ROLES.includes(role);
}

/**
 * Mirrors the exact pattern rbac.middleware.ts already uses for SUPERADMIN
 * short-circuiting: TENANT_OWNER/ADMIN/SUPERADMIN act in every workspace of
 * their own tenant by role, without needing a WorkspaceMember row for each
 * one (avoids a membership-row explosion for admins who should just see
 * everything). Narrower roles (HR/RECRUITER/HIRING_MANAGER/PANEL_MEMBER) need
 * an actual membership row. `workspaceId`/`organizationId` supplied by a
 * caller are NEVER trusted on their own — this is the check they're always
 * verified against.
 */
export async function canAccessWorkspace(user: ScopedUser, workspaceId: string): Promise<boolean> {
  if (user.role === ROLES.SUPERADMIN) return true;
  if (!user.tenantId) return false;
  if (isAdminTier(user.role)) {
    const workspace = await prisma.workspace.findFirst({ where: { id: workspaceId, tenantId: user.tenantId }, select: { id: true } });
    return !!workspace;
  }
  // findFirst by plain fields, not findUnique-by-compound-key: the
  // tenant-scoping choke point (config/database.ts) downgrades findUnique to
  // findFirst and merges tenantId into `where`, which only composes with a
  // plain scalar key — not a compound-unique wrapper like `workspaceId_userId`.
  const member = await prisma.workspaceMember.findFirst({
    where: { workspaceId, userId: user.sub },
    select: { workspaceId: true },
  });
  return !!member;
}

/**
 * True when a tenant/org admin has explicitly granted this specific member
 * `canManageUsers` for `workspaceId` — the escape hatch that lets a
 * narrow-ATS-role user (e.g. Recruiter) manage users WITHIN that one
 * workspace even though `user.manage` itself is otherwise reserved for
 * Admin/Tenant Owner. Independent of container role (WORKSPACE_ADMIN vs
 * WORKSPACE_MEMBER) and of the global `user.manage` permission — callers
 * that already hold `user.manage` never need this check (see
 * middlewares/rbac.middleware.ts's requireUserManage).
 */
export async function canManageWorkspaceUsers(
  user: { sub: string; tenantId?: string | null },
  workspaceId: string | null | undefined,
): Promise<boolean> {
  if (!workspaceId || !user.tenantId) return false;
  const member = await prisma.workspaceMember.findFirst({
    where: { workspaceId, userId: user.sub, canManageUsers: true },
    select: { workspaceId: true },
  });
  return !!member;
}

/** Same rationale as canAccessWorkspace, one tier up. */
export async function canAccessOrganization(user: ScopedUser, organizationId: string): Promise<boolean> {
  if (user.role === ROLES.SUPERADMIN) return true;
  if (!user.tenantId) return false;
  if (isAdminTier(user.role)) {
    const organization = await prisma.organization.findFirst({ where: { id: organizationId, tenantId: user.tenantId }, select: { id: true } });
    return !!organization;
  }
  const member = await prisma.organizationMember.findFirst({
    where: { organizationId, userId: user.sub },
    select: { organizationId: true },
  });
  return !!member;
}

/**
 * The full org->workspace tree a caller can switch into — always freshly
 * read (never baked into the token), so a membership grant/revoke mid-session
 * is reflected immediately rather than waiting for token expiry. Admin-tier
 * roles see every org/workspace in their own tenant; narrower roles see only
 * what they actually have a membership row for.
 */
export async function listMemberships(user: ScopedUser): Promise<MembershipTree> {
  if (!user.tenantId) return { organizations: [] };

  if (isAdminTier(user.role)) {
    // Admin-tier roles always display as admin of every org/workspace in
    // their tenant, regardless of what any actual membership row says (they
    // act by role, per canAccessWorkspace/canAccessOrganization above, not by
    // row) — org and workspace must be treated symmetrically here, or the
    // tree shows a real-but-stale row's lesser role for one tier and not the
    // other.
    const orgs = await prisma.organization.findMany({
      where: { tenantId: user.tenantId, deletedAt: null },
      include: { workspaces: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
    return {
      organizations: orgs.map((o) => ({
        id: o.id,
        name: o.name,
        role: 'ORG_ADMIN' as OrgRoleKey,
        workspaces: o.workspaces.map((w) => ({ id: w.id, name: w.name, role: 'WORKSPACE_ADMIN' as WorkspaceRoleKey })),
      })),
    };
  }

  const [workspaceMemberships, organizationMemberships] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: { userId: user.sub, tenantId: user.tenantId },
      include: { workspace: { include: { organization: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.organizationMember.findMany({ where: { userId: user.sub, tenantId: user.tenantId } }),
  ]);
  const orgRoleById = new Map(organizationMemberships.map((m) => [m.organizationId, m.role as OrgRoleKey]));

  const byOrg = new Map<string, MembershipOrganization>();
  for (const m of workspaceMemberships) {
    const orgId = m.workspace.organizationId;
    if (!byOrg.has(orgId)) {
      byOrg.set(orgId, {
        id: orgId,
        name: m.workspace.organization.name,
        role: orgRoleById.get(orgId) ?? null,
        workspaces: [],
      });
    }
    byOrg.get(orgId)!.workspaces.push({ id: m.workspaceId, name: m.workspace.name, role: m.role as WorkspaceRoleKey });
  }
  return { organizations: [...byOrg.values()] };
}
