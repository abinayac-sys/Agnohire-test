import type { OrgRoleKey, WorkspaceRoleKey } from './api.js';

// ─── ORGANIZATIONS ───────────────────────────────────────────────────────────

export interface OrganizationItem {
  id: string;
  name: string;
  slug: string | null;
  isActive: boolean;
  workspaceCount: number;
  memberCount: number;
  createdAt: string;
}

export interface OrganizationMemberItem {
  userId: string;
  fullName: string;
  email: string;
  role: OrgRoleKey;
  createdAt: string;
}

// ─── WORKSPACES ──────────────────────────────────────────────────────────────

export interface WorkspaceItem {
  id: string;
  organizationId: string;
  name: string;
  slug: string | null;
  isActive: boolean;
  memberCount: number;
  createdAt: string;
}

export interface WorkspaceMemberItem {
  userId: string;
  fullName: string;
  email: string;
  role: WorkspaceRoleKey;
  /** Grantable, off by default: lets this member manage users scoped to this one workspace, independent of their ATS role. Settable only by a tenant/org admin. */
  canManageUsers: boolean;
  createdAt: string;
}
