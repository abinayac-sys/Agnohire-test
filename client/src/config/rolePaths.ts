import { ROLES, type RoleKey } from '@agnohire/shared';

/** Base path segment for each role's authenticated area. */
export const ROLE_BASE: Record<RoleKey, string> = {
  [ROLES.SUPERADMIN]: '/superadmin',
  [ROLES.ADMIN]: '/admin',
  [ROLES.HR]: '/hr',
  [ROLES.RECRUITER]: '/recruiter',
  [ROLES.HIRING_MANAGER]: '/hiring-manager',
  [ROLES.PANEL_MEMBER]: '/panel',
  [ROLES.CANDIDATE]: '/candidate',
  // SaaS role reuses the existing admin area (no new UI).
  [ROLES.TENANT_OWNER]: '/admin',
};
