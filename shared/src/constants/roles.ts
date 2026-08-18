/**
 * Canonical role keys. Stored as Role.name in the DB and seeded on bootstrap.
 * The Navbar notification bell shows for everyone EXCEPT CANDIDATE (see spec).
 */
export const ROLES = {
  SUPERADMIN: 'SUPERADMIN',
  ADMIN: 'ADMIN',
  HR: 'HR',
  RECRUITER: 'RECRUITER',
  HIRING_MANAGER: 'HIRING_MANAGER',
  PANEL_MEMBER: 'PANEL_MEMBER',
  CANDIDATE: 'CANDIDATE',
  // SaaS tenancy role (additive): TENANT_OWNER manages billing + tenant config.
  // SUPERADMIN is the single cross-tenant operator role.
  TENANT_OWNER: 'TENANT_OWNER',
} as const;

export type RoleKey = (typeof ROLES)[keyof typeof ROLES];

export const ALL_ROLES: RoleKey[] = Object.values(ROLES);

/** Roles that receive in-app notifications (bell icon). */
export const NOTIFICATION_ROLES: RoleKey[] = ALL_ROLES.filter(
  (r) => r !== ROLES.CANDIDATE,
);

/** Staff (non-candidate) roles that use the main app shell. */
export const STAFF_ROLES: RoleKey[] = ALL_ROLES.filter(
  (r) => r !== ROLES.CANDIDATE,
);

export const ROLE_DISPLAY_NAMES: Record<RoleKey, string> = {
  SUPERADMIN: 'Super Admin',
  ADMIN: 'Admin',
  HR: 'HR',
  RECRUITER: 'Recruiter',
  HIRING_MANAGER: 'Hiring Manager',
  PANEL_MEMBER: 'Panel Member',
  CANDIDATE: 'Candidate',
  TENANT_OWNER: 'Tenant Owner',
};

/** Landing route per role after login. */
export const ROLE_HOME: Record<RoleKey, string> = {
  SUPERADMIN: '/superadmin/dashboard',
  ADMIN: '/admin/dashboard',
  HR: '/hr/dashboard',
  RECRUITER: '/recruiter/dashboard',
  HIRING_MANAGER: '/hiring-manager/dashboard',
  PANEL_MEMBER: '/panel/dashboard',
  CANDIDATE: '/candidate/dashboard',
  TENANT_OWNER: '/admin/dashboard',
};
