import { ROLES, type RoleKey } from './roles.js';

/**
 * Permission keys grouped by domain. Seeded into the Permission table and
 * mapped to roles via RolePermission. RBAC middleware checks these keys.
 */
export const PERMISSIONS = {
  // System / admin
  SYSTEM_CONFIG_MANAGE: 'system.config.manage',
  SYSTEM_THEME_MANAGE: 'system.theme.manage',
  INTEGRATION_MANAGE: 'integration.manage',
  AUDIT_LOG_VIEW: 'audit.log.view',
  SECTOR_MANAGE: 'sector.manage',
  USER_MANAGE: 'user.manage',
  ROLE_MANAGE: 'role.manage',

  // Jobs
  JOB_VIEW: 'job.view',
  JOB_CREATE: 'job.create',
  JOB_EDIT: 'job.edit',
  JOB_APPROVE: 'job.approve',
  JOB_DELETE: 'job.delete',

  // Candidates
  CANDIDATE_VIEW: 'candidate.view',
  CANDIDATE_CREATE: 'candidate.create',
  CANDIDATE_EDIT: 'candidate.edit',
  CANDIDATE_UPLOAD: 'candidate.upload',
  CANDIDATE_ASSIGN: 'candidate.assign',

  // Sourcing
  SOURCING_VIEW: 'sourcing.view',
  SOURCING_MANAGE: 'sourcing.manage',
  REFERRAL_MANAGE: 'referral.manage',

  // Interviews
  INTERVIEW_VIEW: 'interview.view',
  INTERVIEW_SCHEDULE: 'interview.schedule',
  INTERVIEW_REVIEW: 'interview.review',
  INTERVIEW_DECIDE: 'interview.decide',

  // Question bank
  QUESTION_BANK_VIEW: 'questionbank.view',
  QUESTION_BANK_MANAGE: 'questionbank.manage',

  // Skill assessments
  ASSESSMENT_VIEW: 'assessment.view',
  ASSESSMENT_MANAGE: 'assessment.manage',
  ASSESSMENT_ASSIGN: 'assessment.assign',

  // Pipeline / ATS
  PIPELINE_VIEW: 'pipeline.view',
  PIPELINE_MANAGE: 'pipeline.manage',

  // Offers / onboarding
  OFFER_VIEW: 'offer.view',
  OFFER_MANAGE: 'offer.manage',
  ONBOARDING_MANAGE: 'onboarding.manage',

  // Panel
  PANEL_MANAGE: 'panel.manage',
  PANEL_FEEDBACK: 'panel.feedback',

  // Analytics
  ANALYTICS_VIEW: 'analytics.view',
  ANALYTICS_GLOBAL: 'analytics.global',

  // Compliance
  GDPR_MANAGE: 'gdpr.manage',

  // Tenant Notifications
  TENANT_NOTIFICATIONS_VIEW: 'tenant.notifications.view',

  // Organization / Workspace management — CRUD-granular, same convention as
  // Jobs above, so a role can be given e.g. view-only without also being
  // able to create/edit/delete.
  ORG_VIEW: 'org.view',
  ORG_CREATE: 'org.create',
  ORG_EDIT: 'org.edit',
  ORG_DELETE: 'org.delete',
  WORKSPACE_VIEW: 'workspace.view',
  WORKSPACE_CREATE: 'workspace.create',
  WORKSPACE_EDIT: 'workspace.edit',
  WORKSPACE_DELETE: 'workspace.delete',
  WORKSPACE_CREDENTIAL_MANAGE: 'workspace.credential.manage',

  // AI Assistant
  AI_ASSISTANT_USE: 'ai.assistant.use',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export interface PermissionDef {
  key: PermissionKey;
  label: string;
  group: string;
}

export const PERMISSION_DEFS: PermissionDef[] = [
  { key: PERMISSIONS.SYSTEM_CONFIG_MANAGE, label: 'Manage system configuration', group: 'System' },
  { key: PERMISSIONS.SYSTEM_THEME_MANAGE, label: 'Manage themes', group: 'System' },
  { key: PERMISSIONS.INTEGRATION_MANAGE, label: 'Manage integrations', group: 'System' },
  { key: PERMISSIONS.AUDIT_LOG_VIEW, label: 'View audit logs', group: 'System' },
  { key: PERMISSIONS.SECTOR_MANAGE, label: 'Manage sectors', group: 'System' },
  { key: PERMISSIONS.USER_MANAGE, label: 'Manage users', group: 'System' },
  { key: PERMISSIONS.ROLE_MANAGE, label: 'Manage roles & permissions', group: 'System' },
  { key: PERMISSIONS.JOB_VIEW, label: 'View jobs', group: 'Jobs' },
  { key: PERMISSIONS.JOB_CREATE, label: 'Create jobs', group: 'Jobs' },
  { key: PERMISSIONS.JOB_EDIT, label: 'Edit jobs', group: 'Jobs' },
  { key: PERMISSIONS.JOB_APPROVE, label: 'Approve jobs', group: 'Jobs' },
  { key: PERMISSIONS.JOB_DELETE, label: 'Delete jobs', group: 'Jobs' },
  { key: PERMISSIONS.CANDIDATE_VIEW, label: 'View candidates', group: 'Candidates' },
  { key: PERMISSIONS.CANDIDATE_CREATE, label: 'Create candidates', group: 'Candidates' },
  { key: PERMISSIONS.CANDIDATE_EDIT, label: 'Edit candidates', group: 'Candidates' },
  { key: PERMISSIONS.CANDIDATE_UPLOAD, label: 'Bulk upload candidates', group: 'Candidates' },
  { key: PERMISSIONS.CANDIDATE_ASSIGN, label: 'Assign candidates', group: 'Candidates' },
  { key: PERMISSIONS.SOURCING_VIEW, label: 'View sourcing & talent search', group: 'Sourcing' },
  { key: PERMISSIONS.SOURCING_MANAGE, label: 'Manage channels & candidate lists', group: 'Sourcing' },
  { key: PERMISSIONS.REFERRAL_MANAGE, label: 'Manage referrals & bonuses', group: 'Sourcing' },
  { key: PERMISSIONS.INTERVIEW_VIEW, label: 'View interviews', group: 'Interviews' },
  { key: PERMISSIONS.INTERVIEW_SCHEDULE, label: 'Schedule interviews', group: 'Interviews' },
  { key: PERMISSIONS.INTERVIEW_REVIEW, label: 'Review interviews', group: 'Interviews' },
  { key: PERMISSIONS.INTERVIEW_DECIDE, label: 'Decide interview outcomes', group: 'Interviews' },
  { key: PERMISSIONS.QUESTION_BANK_VIEW, label: 'View question banks', group: 'Question Bank' },
  { key: PERMISSIONS.QUESTION_BANK_MANAGE, label: 'Manage question banks', group: 'Question Bank' },
  { key: PERMISSIONS.ASSESSMENT_VIEW, label: 'View skill assessments', group: 'Assessments' },
  { key: PERMISSIONS.ASSESSMENT_MANAGE, label: 'Build & manage assessments', group: 'Assessments' },
  { key: PERMISSIONS.ASSESSMENT_ASSIGN, label: 'Assign assessments to candidates', group: 'Assessments' },
  { key: PERMISSIONS.PIPELINE_VIEW, label: 'View pipeline', group: 'Pipeline' },
  { key: PERMISSIONS.PIPELINE_MANAGE, label: 'Manage pipeline', group: 'Pipeline' },
  { key: PERMISSIONS.OFFER_VIEW, label: 'View offers', group: 'Offers' },
  { key: PERMISSIONS.OFFER_MANAGE, label: 'Manage offers', group: 'Offers' },
  { key: PERMISSIONS.ONBOARDING_MANAGE, label: 'Manage onboarding', group: 'Offers' },
  { key: PERMISSIONS.PANEL_MANAGE, label: 'Manage hiring panels', group: 'Panel' },
  { key: PERMISSIONS.PANEL_FEEDBACK, label: 'Submit panel feedback', group: 'Panel' },
  { key: PERMISSIONS.ANALYTICS_VIEW, label: 'View analytics', group: 'Analytics' },
  { key: PERMISSIONS.ANALYTICS_GLOBAL, label: 'View global analytics', group: 'Analytics' },
  { key: PERMISSIONS.GDPR_MANAGE, label: 'Manage GDPR requests', group: 'Compliance' },
  { key: PERMISSIONS.TENANT_NOTIFICATIONS_VIEW, label: 'View tenant notifications', group: 'System' },
  { key: PERMISSIONS.ORG_VIEW, label: 'View organizations', group: 'Organizations & Workspaces' },
  { key: PERMISSIONS.ORG_CREATE, label: 'Create organizations', group: 'Organizations & Workspaces' },
  { key: PERMISSIONS.ORG_EDIT, label: 'Edit organizations (incl. members)', group: 'Organizations & Workspaces' },
  { key: PERMISSIONS.ORG_DELETE, label: 'Delete organizations', group: 'Organizations & Workspaces' },
  { key: PERMISSIONS.WORKSPACE_VIEW, label: 'View workspaces', group: 'Organizations & Workspaces' },
  { key: PERMISSIONS.WORKSPACE_CREATE, label: 'Create workspaces', group: 'Organizations & Workspaces' },
  { key: PERMISSIONS.WORKSPACE_EDIT, label: 'Edit workspaces (incl. members)', group: 'Organizations & Workspaces' },
  { key: PERMISSIONS.WORKSPACE_DELETE, label: 'Delete workspaces', group: 'Organizations & Workspaces' },
  { key: PERMISSIONS.WORKSPACE_CREDENTIAL_MANAGE, label: 'Manage workspace credentials & integrations', group: 'Organizations & Workspaces' },
  { key: PERMISSIONS.AI_ASSISTANT_USE, label: 'Use the AI assistant', group: 'System' },
];

const P = PERMISSIONS;

/**
 * Default role → permission mapping, applied by the seed script.
 *
 * SYSTEM_CONFIG_MANAGE (system config + email templates/logs) and
 * AI_ASSISTANT_USE (the /ai/run AI agent) are held by every staff role — only
 * CANDIDATE is excluded. Billing is NOT gated by this
 * permission; it is role-gated to ADMIN/TENANT_OWNER/SUPERADMIN
 * separately (see billing.routes.ts + the Billing nav item's `roles`).
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleKey, PermissionKey[]> = {
  // SUPERADMIN is the single cross-tenant operator role; holds every
  // permission unconditionally. Tenant owner gets the full ADMIN set
  // (billing endpoints are role-gated separately).
  [ROLES.SUPERADMIN]: PERMISSION_DEFS.map((p) => p.key), // all
  [ROLES.TENANT_OWNER]: [
    P.SYSTEM_CONFIG_MANAGE, P.SYSTEM_THEME_MANAGE, P.INTEGRATION_MANAGE, P.AUDIT_LOG_VIEW, P.AI_ASSISTANT_USE,
    P.SECTOR_MANAGE, P.USER_MANAGE, P.ROLE_MANAGE,
    P.JOB_VIEW, P.JOB_CREATE, P.JOB_EDIT, P.JOB_APPROVE, P.JOB_DELETE,
    P.CANDIDATE_VIEW, P.CANDIDATE_CREATE, P.CANDIDATE_EDIT, P.CANDIDATE_UPLOAD, P.CANDIDATE_ASSIGN,
    P.SOURCING_VIEW, P.SOURCING_MANAGE, P.REFERRAL_MANAGE,
    P.INTERVIEW_VIEW, P.INTERVIEW_SCHEDULE, P.INTERVIEW_REVIEW, P.INTERVIEW_DECIDE,
    P.QUESTION_BANK_VIEW, P.QUESTION_BANK_MANAGE,
    P.ASSESSMENT_VIEW, P.ASSESSMENT_MANAGE, P.ASSESSMENT_ASSIGN,
    P.PIPELINE_VIEW, P.PIPELINE_MANAGE,
    P.OFFER_VIEW, P.OFFER_MANAGE, P.ONBOARDING_MANAGE,
    P.PANEL_MANAGE, P.PANEL_FEEDBACK,
    P.ANALYTICS_VIEW, P.GDPR_MANAGE, P.TENANT_NOTIFICATIONS_VIEW,
    P.ORG_VIEW, P.ORG_CREATE, P.ORG_EDIT, P.ORG_DELETE,
    P.WORKSPACE_VIEW, P.WORKSPACE_CREATE, P.WORKSPACE_EDIT, P.WORKSPACE_DELETE, P.WORKSPACE_CREDENTIAL_MANAGE,
  ],
  [ROLES.ADMIN]: [
    P.SYSTEM_CONFIG_MANAGE, P.SYSTEM_THEME_MANAGE, P.INTEGRATION_MANAGE, P.AUDIT_LOG_VIEW, P.AI_ASSISTANT_USE,
    P.SECTOR_MANAGE, P.USER_MANAGE, P.ROLE_MANAGE,
    P.JOB_VIEW, P.JOB_CREATE, P.JOB_EDIT, P.JOB_APPROVE, P.JOB_DELETE,
    P.CANDIDATE_VIEW, P.CANDIDATE_CREATE, P.CANDIDATE_EDIT, P.CANDIDATE_UPLOAD, P.CANDIDATE_ASSIGN,
    P.SOURCING_VIEW, P.SOURCING_MANAGE, P.REFERRAL_MANAGE,
    P.INTERVIEW_VIEW, P.INTERVIEW_SCHEDULE, P.INTERVIEW_REVIEW, P.INTERVIEW_DECIDE,
    P.QUESTION_BANK_VIEW, P.QUESTION_BANK_MANAGE,
    P.ASSESSMENT_VIEW, P.ASSESSMENT_MANAGE, P.ASSESSMENT_ASSIGN,
    P.PIPELINE_VIEW, P.PIPELINE_MANAGE,
    P.OFFER_VIEW, P.OFFER_MANAGE, P.ONBOARDING_MANAGE,
    P.PANEL_MANAGE, P.PANEL_FEEDBACK,
    P.ANALYTICS_VIEW, P.GDPR_MANAGE, P.TENANT_NOTIFICATIONS_VIEW,
    P.ORG_VIEW, P.ORG_CREATE, P.ORG_EDIT, P.ORG_DELETE,
    P.WORKSPACE_VIEW, P.WORKSPACE_CREATE, P.WORKSPACE_EDIT, P.WORKSPACE_DELETE, P.WORKSPACE_CREDENTIAL_MANAGE,
  ],
  [ROLES.HR]: [
    P.SYSTEM_CONFIG_MANAGE, P.AI_ASSISTANT_USE,
    P.JOB_VIEW, P.JOB_CREATE, P.JOB_EDIT,
    P.CANDIDATE_VIEW, P.CANDIDATE_CREATE, P.CANDIDATE_EDIT, P.CANDIDATE_UPLOAD, P.CANDIDATE_ASSIGN,
    P.SOURCING_VIEW, P.SOURCING_MANAGE, P.REFERRAL_MANAGE,
    P.INTERVIEW_VIEW, P.INTERVIEW_SCHEDULE,
    P.QUESTION_BANK_VIEW,
    P.ASSESSMENT_VIEW, P.ASSESSMENT_MANAGE, P.ASSESSMENT_ASSIGN,
    P.PIPELINE_VIEW, P.PIPELINE_MANAGE,
    P.OFFER_VIEW, P.OFFER_MANAGE, P.ONBOARDING_MANAGE,
    P.PANEL_MANAGE, P.PANEL_FEEDBACK,
    P.ANALYTICS_VIEW, P.GDPR_MANAGE,
  ],
  [ROLES.RECRUITER]: [
    P.SYSTEM_CONFIG_MANAGE, P.AI_ASSISTANT_USE,
    P.JOB_VIEW,
    P.CANDIDATE_VIEW, P.CANDIDATE_CREATE, P.CANDIDATE_EDIT, P.CANDIDATE_ASSIGN,
    P.SOURCING_VIEW, P.SOURCING_MANAGE, P.REFERRAL_MANAGE,
    P.INTERVIEW_VIEW, P.INTERVIEW_SCHEDULE, P.INTERVIEW_REVIEW,
    P.QUESTION_BANK_VIEW, P.QUESTION_BANK_MANAGE,
    P.ASSESSMENT_VIEW, P.ASSESSMENT_MANAGE, P.ASSESSMENT_ASSIGN,
    P.PIPELINE_VIEW, P.PIPELINE_MANAGE,
    P.PANEL_MANAGE, P.PANEL_FEEDBACK,
    P.ANALYTICS_VIEW,
  ],
  [ROLES.HIRING_MANAGER]: [
    P.SYSTEM_CONFIG_MANAGE, P.AI_ASSISTANT_USE,
    P.JOB_VIEW, P.JOB_APPROVE,
    P.CANDIDATE_VIEW,
    P.SOURCING_VIEW,
    P.INTERVIEW_VIEW, P.INTERVIEW_REVIEW, P.INTERVIEW_DECIDE,
    P.ASSESSMENT_VIEW,
    P.PIPELINE_VIEW,
    P.OFFER_VIEW, P.OFFER_MANAGE,
    P.PANEL_MANAGE, P.PANEL_FEEDBACK,
    P.ANALYTICS_VIEW,
  ],
  [ROLES.PANEL_MEMBER]: [
    P.SYSTEM_CONFIG_MANAGE, P.AI_ASSISTANT_USE,
    P.INTERVIEW_VIEW, P.PANEL_FEEDBACK, P.CANDIDATE_VIEW,
  ],
  [ROLES.CANDIDATE]: [],
};
