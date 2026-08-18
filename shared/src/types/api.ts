import type { RoleKey } from '../constants/roles.js';
import type { PermissionKey } from '../constants/permissions.js';

/** Standard API envelope returned by every endpoint. */
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    /** Field-level validation errors, keyed by path. */
    details?: Record<string, string[]>;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

/** Server-side pagination request (query params on every list endpoint). */
export interface PaginationQuery {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  search?: string;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  items: T[];
  meta: PaginationMeta;
}

export const DEFAULT_PAGE_SIZE = 25;

/** Container-level role for Organization membership — distinct from `role` (the ATS functional role). */
export type OrgRoleKey = 'ORG_ADMIN' | 'ORG_MEMBER';
/** Container-level role for Workspace membership — distinct from `role` (the ATS functional role). */
export type WorkspaceRoleKey = 'WORKSPACE_ADMIN' | 'WORKSPACE_MEMBER';
/** Either container-role tier — used where a claim/field may hold either. */
export type ScopeRoleKey = OrgRoleKey | WorkspaceRoleKey;

/** Decoded access-token payload. */
export interface JwtPayload {
  sub: string; // userId
  email: string;
  role: RoleKey;
  sectorId: string | null;
  /** SaaS tenant id — optional so pre-migration tokens stay valid. */
  tenantId?: string | null;
  /** Current Organization/Workspace — optional so tokens minted before this rollout stay valid; absence means "no workspace scope resolved yet," not "denied." */
  organizationId?: string | null;
  workspaceId?: string | null;
  /** This user's container role inside `workspaceId`. Null/absent when workspaceId is absent. */
  workspaceRole?: WorkspaceRoleKey | null;
  permissions: PermissionKey[];
  type: 'access';
}

/** Decoded interview-token payload (public interview route). */
export interface InterviewTokenPayload {
  candidateId: string;
  recruiterId: string;
  interviewId: string;
  type: 'interview';
}

/** The authenticated user as exposed to the client (`/auth/me`). */
export interface AuthUser {
  id: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  role: RoleKey;
  roleDisplayName: string;
  sectorId: string | null;
  permissions: PermissionKey[];
  /** Tenant slug, used to prefix authenticated URLs (e.g. /agnoshin/admin/...).
   * Null only for a platform-superadmin's own session (no tenant). */
  tenantSlug: string | null;
  /** IANA timezone of the tenant (default "UTC"). Null for a session with no
   * tenant. Used as the default for the interview-schedule timezone picker. */
  tenantTimezone: string | null;
  /** Current Organization/Workspace. Null for a session with no tenant, or a
   * token minted before this rollout that hasn't refreshed yet. */
  organizationId: string | null;
  organizationName: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  workspaceRole: WorkspaceRoleKey | null;
  /** True when a tenant/org admin granted this user user-management rights scoped to their CURRENT workspace (see WorkspaceMember.canManageUsers), even if their ATS role otherwise lacks `user.manage`. */
  canManageUsers: boolean;
  /** True when a platform operator (superadmin) set/knows this user's current
   * password — tenant provisioning or an admin-triggered reset — and the user
   * has not yet replaced it with one only they know. The client blocks on a
   * forced change-password modal until this clears (see
   * ForceChangePasswordModal and authService.changePassword). */
  mustChangePassword: boolean;
}

/** Richer self-profile (AuthUser + account/personal fields) for the profile page. */
export interface ProfileDetails extends AuthUser {
  phone: string | null;
  jobTitle: string | null;
  department: string | null;
  location: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  bio: string | null;
  address: string | null;
  sectorName: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  /** Refresh token is delivered as an httpOnly cookie; not in the body. */
}

/** One Workspace in the org->workspace tree returned by GET /api/auth/memberships. */
export interface MembershipWorkspace {
  id: string;
  name: string;
  role: WorkspaceRoleKey | null;
}

/** One Organization in the org->workspace tree, with its accessible Workspaces. */
export interface MembershipOrganization {
  id: string;
  name: string;
  role: OrgRoleKey | null;
  workspaces: MembershipWorkspace[];
}

/** The full set of Organizations/Workspaces the signed-in user can switch into. */
export interface MembershipTree {
  organizations: MembershipOrganization[];
}
