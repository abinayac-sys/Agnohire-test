import { z } from 'zod';

const slugField = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and hyphens only')
  .max(60)
  .optional();

// ─── ORGANIZATIONS ───────────────────────────────────────────────────────────

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: slugField,
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  slug: slugField,
  isActive: z.boolean().optional(),
});
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

export const orgRoleSchema = z.enum(['ORG_ADMIN', 'ORG_MEMBER']);

export const addOrganizationMemberSchema = z.object({
  userId: z.string().uuid(),
  role: orgRoleSchema.default('ORG_MEMBER'),
});
export type AddOrganizationMemberInput = z.infer<typeof addOrganizationMemberSchema>;

export const updateOrganizationMemberRoleSchema = z.object({
  role: orgRoleSchema,
});
export type UpdateOrganizationMemberRoleInput = z.infer<typeof updateOrganizationMemberRoleSchema>;

// ─── WORKSPACES ──────────────────────────────────────────────────────────────

export const createWorkspaceSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  slug: slugField,
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

export const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  slug: slugField,
  isActive: z.boolean().optional(),
});
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;

export const workspaceRoleSchema = z.enum(['WORKSPACE_ADMIN', 'WORKSPACE_MEMBER']);

export const addWorkspaceMemberSchema = z.object({
  userId: z.string().uuid(),
  role: workspaceRoleSchema.default('WORKSPACE_MEMBER'),
  // Only honored server-side when the CALLER holds workspace.manage
  // (tenant/org admin) — see workspaceService.addWorkspaceMember.
  canManageUsers: z.boolean().optional(),
});
export type AddWorkspaceMemberInput = z.infer<typeof addWorkspaceMemberSchema>;

export const updateWorkspaceMemberRoleSchema = z.object({
  role: workspaceRoleSchema.optional(),
  canManageUsers: z.boolean().optional(),
});
export type UpdateWorkspaceMemberRoleInput = z.infer<typeof updateWorkspaceMemberRoleSchema>;
