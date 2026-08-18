import { z } from 'zod';

// ─── USERS ───────────────────────────────────────────────────────────────────

export const userFiltersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(1000).default(25),
  search: z.string().trim().optional(),
  roleId: z.string().uuid().optional(),
  sectorId: z.string().uuid().optional(),
  isActive: z.coerce.boolean().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type UserFilters = z.infer<typeof userFiltersSchema>;

/** Superadmin/admin broadcasts a message to one or more users by email. */
export const sendUserMessageSchema = z.object({
  recipientIds: z.array(z.string().uuid()).min(1, 'Select at least one recipient'),
  subject: z.string().trim().min(1, 'Subject is required').max(200),
  message: z.string().trim().min(1, 'Message is required').max(5000),
});
export type SendUserMessageInput = z.infer<typeof sendUserMessageSchema>;

export const emailLogFiltersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(1000).default(25),
  status: z.enum(['SENT', 'FAILED', 'SKIPPED']).optional(),
  search: z.string().trim().optional(),
});
export type EmailLogFilters = z.infer<typeof emailLogFiltersSchema>;

export const createUserSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(160),
  roleId: z.string().uuid(),
  sectorId: z.string().uuid().optional(),
  phone: z.string().trim().min(1).max(40),
  password: z.string().min(8).max(1000),
  // Explicit target Workspace for the new user. Omitting it falls back to the
  // CALLER's own current workspace (the historical behavior) — see
  // adminUserService.resolveTargetWorkspace. A workspace-scoped caller (see
  // WorkspaceMember.canManageUsers) may only target their own workspace; a
  // full user.manage holder may target any workspace in their tenant.
  workspaceId: z.string().uuid().optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  roleId: z.string().uuid().optional(),
  sectorId: z.string().uuid().optional(),
  phone: z.string().trim().min(1).max(40).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const adminResetPasswordSchema = z.object({
  password: z.string().min(8).max(1000),
});
export type AdminResetPasswordInput = z.infer<typeof adminResetPasswordSchema>;

// ─── ROLES & PERMISSIONS ─────────────────────────────────────────────────────

export const setRolePermissionsSchema = z.object({
  permissionKeys: z.array(z.string().min(1)).max(200),
});
export type SetRolePermissionsInput = z.infer<typeof setRolePermissionsSchema>;

// ─── SECTORS & DOMAINS ───────────────────────────────────────────────────────

export const createSectorSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.string().trim().min(1).max(60),
  isActive: z.boolean().optional(),
});
export type CreateSectorInput = z.infer<typeof createSectorSchema>;

export const updateSectorSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  type: z.string().trim().min(1).max(60).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateSectorInput = z.infer<typeof updateSectorSchema>;

export const createDomainSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sectorId: z.string().uuid().nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});
export type CreateDomainInput = z.infer<typeof createDomainSchema>;

export const updateDomainSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  sectorId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateDomainInput = z.infer<typeof updateDomainSchema>;

// ─── INTEGRATIONS ────────────────────────────────────────────────────────────

export const createIntegrationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.string().trim().min(1).max(60),
  isEnabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  webhookUrl: z.string().trim().url().max(500).nullable().optional(),
  sectorId: z.string().uuid().nullable().optional(),
});
export type CreateIntegrationInput = z.infer<typeof createIntegrationSchema>;

export const updateIntegrationSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  isEnabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  webhookUrl: z.string().trim().url().max(500).nullable().optional(),
  sectorId: z.string().uuid().nullable().optional(),
});
export type UpdateIntegrationInput = z.infer<typeof updateIntegrationSchema>;

// ─── EMAIL TEMPLATES ─────────────────────────────────────────────────────────

export const createEmailTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.string().trim().min(1).max(60),
  subject: z.string().trim().min(1).max(300),
  body: z.string().min(1).max(20000),
  sectorId: z.string().uuid().nullable().optional(),
  isDefault: z.boolean().optional(),
});
export type CreateEmailTemplateInput = z.infer<typeof createEmailTemplateSchema>;

export const updateEmailTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  subject: z.string().trim().min(1).max(300).optional(),
  body: z.string().min(1).max(20000).optional(),
  isDefault: z.boolean().optional(),
});
export type UpdateEmailTemplateInput = z.infer<typeof updateEmailTemplateSchema>;
