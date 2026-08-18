import {
  LayoutDashboard,
  Briefcase,
  Users,
  CalendarClock,
  FileText,
  GitBranch,
  ClipboardList,
  UserCheck,
  BarChart3,
  Settings,
  ShieldCheck,
  Building2,
  MessageSquare,
  Radar,
  Video,
  Library,
  ClipboardCheck,
  KeyRound,
  Plug,
  Mail,
  CreditCard,
  AlertTriangle,
  Sparkles,
  Boxes,
  Gauge,
  type LucideIcon,
} from 'lucide-react';
import type { AuthUser, PermissionKey, RoleKey } from '@agnohire/shared';
import { PERMISSIONS, ROLES } from '@agnohire/shared';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Visible only if the user holds this permission (omit = always). */
  permission?: PermissionKey;
  /** Visible only for these roles (omit = all staff). */
  roles?: RoleKey[];
  /**
   * Extra visibility check evaluated alongside `permission`/`roles` (OR'd
   * in, not required) — e.g. `permission` alone can't express "OR a
   * workspace-scoped canManageUsers grant," since that's a capability on the
   * user object, not a permission key.
   */
  alsoVisibleIf?: (user: AuthUser) => boolean;
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

/**
 * Builds the sidebar for a role. Routes are prefixed per-role base path.
 * Items filter by permission at render time. Modules wire their real pages in
 * later; for now most route to a placeholder dashboard section.
 */
export function navForRole(base: string): NavSection[] {
  return [
    {
      items: [
        { label: 'Dashboard', to: `${base}/dashboard`, icon: LayoutDashboard },
      ],
    },
    {
      title: 'Collaboration',
      items: [
        { label: 'Team Chat', to: `${base}/communication`, icon: MessageSquare },
      ],
    },
    {
      title: 'Recruitment',
      items: [
        { label: 'Jobs', to: `${base}/jobs`, icon: Briefcase, permission: PERMISSIONS.JOB_VIEW },
        { label: 'Candidates', to: `${base}/candidates`, icon: Users, permission: PERMISSIONS.CANDIDATE_VIEW },
        { label: 'Sourcing', to: `${base}/sourcing`, icon: Radar, permission: PERMISSIONS.SOURCING_VIEW },
        { label: 'Screening', to: `${base}/screening`, icon: ClipboardList, permission: PERMISSIONS.CANDIDATE_VIEW },
        { label: 'Pipeline', to: `${base}/pipeline`, icon: GitBranch, permission: PERMISSIONS.PIPELINE_VIEW },
      ],
    },
    {
      title: 'Interviews',
      items: [
        { label: 'Interviews', to: `${base}/interviews`, icon: Video, permission: PERMISSIONS.INTERVIEW_VIEW },
        { label: 'Schedule', to: `${base}/schedule`, icon: CalendarClock, permission: PERMISSIONS.INTERVIEW_SCHEDULE },
        { label: 'Reviews', to: `${base}/reviews`, icon: FileText, permission: PERMISSIONS.INTERVIEW_REVIEW },
        { label: 'Question Bank', to: `${base}/question-bank`, icon: Library, permission: PERMISSIONS.QUESTION_BANK_VIEW },
      ],
    },
    {
      title: 'Hiring',
      items: [
        { label: 'HR Approval', to: `${base}/hr-approval`, icon: ClipboardCheck, permission: PERMISSIONS.OFFER_MANAGE },
        { label: 'Offers', to: `${base}/offers`, icon: FileText, permission: PERMISSIONS.OFFER_VIEW },
        { label: 'Onboarding', to: `${base}/onboarding`, icon: UserCheck, permission: PERMISSIONS.ONBOARDING_MANAGE },
      ],
    },
    {
      title: 'Insights',
      items: [
        { label: 'Analytics', to: `${base}/analytics`, icon: BarChart3, permission: PERMISSIONS.ANALYTICS_VIEW },
      ],
    },

    {
      title: 'Administration',
      items: [
        // SaaS platform console — SUPERADMIN only (role-gated; backend
        // enforces via requireRole on /platform routes).
        { label: 'Workspace Accounts', to: `${base}/tenants`, icon: Building2, roles: [ROLES.SUPERADMIN] },
        { label: 'Usage Monitor', to: `${base}/usage-monitor`, icon: Gauge, roles: [ROLES.SUPERADMIN] },
        { label: 'Billing & Plans', to: `${base}/plans`, icon: CreditCard, roles: [ROLES.SUPERADMIN] },
        { label: 'Scheduled Maintenance', to: `${base}/maintenance`, icon: AlertTriangle, roles: [ROLES.SUPERADMIN] },
        { label: 'Users', to: `${base}/users`, icon: Users, permission: PERMISSIONS.USER_MANAGE, alsoVisibleIf: (u) => u.canManageUsers },
        { label: 'Roles & Permissions', to: `${base}/roles`, icon: KeyRound, permission: PERMISSIONS.ROLE_MANAGE },
        { label: 'Sectors', to: `${base}/sectors`, icon: Building2, permission: PERMISSIONS.SECTOR_MANAGE },
        { label: 'Organizations & Workspaces', to: `${base}/organizations`, icon: Boxes, permission: PERMISSIONS.ORG_VIEW, alsoVisibleIf: (u) => u.permissions.includes(PERMISSIONS.WORKSPACE_VIEW) },
        { label: 'Audit Logs', to: `${base}/audit-logs`, icon: ShieldCheck, permission: PERMISSIONS.AUDIT_LOG_VIEW },
        { label: 'Compliance', to: `${base}/compliance`, icon: ShieldCheck, permission: PERMISSIONS.GDPR_MANAGE },
        { label: 'Integrations', to: `${base}/integrations`, icon: Plug, permission: PERMISSIONS.INTEGRATION_MANAGE },
        { label: 'Templates', to: `${base}/email-templates`, icon: Mail, permission: PERMISSIONS.SYSTEM_CONFIG_MANAGE },
        { label: 'Email Log', to: `${base}/email-log`, icon: Mail, permission: PERMISSIONS.SYSTEM_CONFIG_MANAGE },
        { label: 'System Config', to: `${base}/system-config`, icon: Settings, permission: PERMISSIONS.SYSTEM_CONFIG_MANAGE },
        { label: 'AI Playground', to: `${base}/ai-playground`, icon: Sparkles, permission: PERMISSIONS.SYSTEM_CONFIG_MANAGE },
        // SaaS: subscription plan, usage meters, invoices. Admins/owners only —
        // role-gated (not SYSTEM_CONFIG_MANAGE, which all staff now hold) to
        // match the backend billing routes (requireRole ADMIN/TENANT_OWNER).
        { label: 'Billing & Plan', to: `${base}/billing`, icon: CreditCard, roles: [ROLES.ADMIN, ROLES.TENANT_OWNER, ROLES.SUPERADMIN] },
      ],
    },
  ];
}

/** Candidate portal has its own slim navigation. */
export const candidateNav: NavSection[] = [
  {
    items: [
      { label: 'Dashboard', to: '/candidate/dashboard', icon: LayoutDashboard, roles: [ROLES.CANDIDATE] },
      { label: 'My Interviews', to: '/candidate/interviews', icon: CalendarClock, roles: [ROLES.CANDIDATE] },
      { label: 'My Offers', to: '/candidate/offers', icon: FileText, roles: [ROLES.CANDIDATE] },
      { label: 'My Profile', to: '/candidate/profile', icon: Users, roles: [ROLES.CANDIDATE] },
      { label: 'Support', to: '/candidate/support', icon: MessageSquare, roles: [ROLES.CANDIDATE] },
    ],
  },
];
