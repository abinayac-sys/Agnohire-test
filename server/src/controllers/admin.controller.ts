import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as users from '../services/adminUserService.js';
import * as roles from '../services/roleService.js';
import * as sectors from '../services/adminSectorService.js';
import * as integrations from '../services/integrationService.js';
import { getBackendProvider } from '../services/integrations/registry.js';
import * as emailTemplates from '../services/emailTemplateService.js';

// ─── USERS ───────────────────────────────────────────────────────────────────

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const { userFiltersSchema } = await import('@agnohire/shared');
  return ok(res, await users.listUsers(userFiltersSchema.parse(req.query), req));
});

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const { createUserSchema } = await import('@agnohire/shared');
  return ok(res, { user: await users.createUser(createUserSchema.parse(req.body), req) }, 201);
});

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const { updateUserSchema } = await import('@agnohire/shared');
  return ok(res, { user: await users.updateUser(req.params.id, updateUserSchema.parse(req.body), req, req.user!.sub) });
});

export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  await users.deleteUser(req.params.id, req, req.user!.sub);
  return ok(res, { deleted: true });
});

export const resetUserPassword = asyncHandler(async (req: Request, res: Response) => {
  const { adminResetPasswordSchema } = await import('@agnohire/shared');
  await users.resetPassword(req.params.id, adminResetPasswordSchema.parse(req.body), req);
  return ok(res, { reset: true });
});

export const sendUserMessage = asyncHandler(async (req: Request, res: Response) => {
  const { sendUserMessageSchema } = await import('@agnohire/shared');
  const data = sendUserMessageSchema.parse(req.body);
  return ok(res, { result: await users.sendUserMessage(req.user!.sub, data, req) });
});

export const listEmailLogs = asyncHandler(async (req: Request, res: Response) => {
  const { emailLogFiltersSchema } = await import('@agnohire/shared');
  return ok(res, await users.listEmailLogs(emailLogFiltersSchema.parse(req.query)));
});

// ─── ROLES & PERMISSIONS ─────────────────────────────────────────────────────

export const listRoles = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, { roles: await roles.listRoles(req.user?.role) });
});

export const listPermissions = asyncHandler(async (_req: Request, res: Response) => {
  return ok(res, { permissions: roles.listPermissions() });
});

export const setRolePermissions = asyncHandler(async (req: Request, res: Response) => {
  const { setRolePermissionsSchema } = await import('@agnohire/shared');
  return ok(res, { role: await roles.setRolePermissions(req.params.id, setRolePermissionsSchema.parse(req.body), req) });
});

// ─── SECTORS ─────────────────────────────────────────────────────────────────

export const listSectors = asyncHandler(async (_req: Request, res: Response) => {
  return ok(res, { sectors: await sectors.listSectors() });
});

export const createSector = asyncHandler(async (req: Request, res: Response) => {
  const { createSectorSchema } = await import('@agnohire/shared');
  return ok(res, { sector: await sectors.createSector(createSectorSchema.parse(req.body), req) }, 201);
});

export const updateSector = asyncHandler(async (req: Request, res: Response) => {
  const { updateSectorSchema } = await import('@agnohire/shared');
  return ok(res, { sector: await sectors.updateSector(req.params.id, updateSectorSchema.parse(req.body), req) });
});

export const deleteSector = asyncHandler(async (req: Request, res: Response) => {
  await sectors.deleteSector(req.params.id, req);
  return ok(res, { deleted: true });
});

// ─── DOMAINS ─────────────────────────────────────────────────────────────────

export const listDomains = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, { domains: await sectors.listDomains(typeof req.query.sectorId === 'string' ? req.query.sectorId : undefined) });
});

export const createDomain = asyncHandler(async (req: Request, res: Response) => {
  const { createDomainSchema } = await import('@agnohire/shared');
  return ok(res, { domain: await sectors.createDomain(createDomainSchema.parse(req.body), req) }, 201);
});

export const updateDomain = asyncHandler(async (req: Request, res: Response) => {
  const { updateDomainSchema } = await import('@agnohire/shared');
  return ok(res, { domain: await sectors.updateDomain(req.params.id, updateDomainSchema.parse(req.body), req) });
});

export const deleteDomain = asyncHandler(async (req: Request, res: Response) => {
  await sectors.deleteDomain(req.params.id, req);
  return ok(res, { deleted: true });
});

// ─── INTEGRATIONS ────────────────────────────────────────────────────────────

export const listIntegrations = asyncHandler(async (_req: Request, res: Response) => {
  return ok(res, { integrations: await integrations.listIntegrations() });
});

export const createIntegration = asyncHandler(async (req: Request, res: Response) => {
  const { createIntegrationSchema } = await import('@agnohire/shared');
  return ok(res, { integration: await integrations.createIntegration(createIntegrationSchema.parse(req.body), req) }, 201);
});

export const updateIntegration = asyncHandler(async (req: Request, res: Response) => {
  const { updateIntegrationSchema } = await import('@agnohire/shared');
  return ok(res, { integration: await integrations.updateIntegration(req.params.id, updateIntegrationSchema.parse(req.body), req) });
});

export const deleteIntegration = asyncHandler(async (req: Request, res: Response) => {
  await integrations.deleteIntegration(req.params.id, req);
  return ok(res, { deleted: true });
});

export const testIntegrationConnection = asyncHandler(async (req: Request, res: Response) => {
  const providerId = req.params.provider;
  const provider = getBackendProvider(providerId);
  if (!provider) {
    return ok(res, { ok: false, error: 'Provider not found' }, 404);
  }
  const result = await provider.testConnection(req.body);
  return ok(res, result);
});

export const previewEmailTemplate = asyncHandler(async (req: Request, res: Response) => {
  const { subject, body, type } = req.body;
  const { resolveTemplate } = await import('../services/emailTemplates.js');

  const resolved = await resolveTemplate(type || 'interview_invite', {}, true, { subject, body });
  return ok(res, { html: resolved.html });
});

// ─── EMAIL TEMPLATES ─────────────────────────────────────────────────────────

export const listEmailTemplates = asyncHandler(async (_req: Request, res: Response) => {
  return ok(res, { templates: await emailTemplates.listEmailTemplates() });
});

export const createEmailTemplate = asyncHandler(async (req: Request, res: Response) => {
  const { createEmailTemplateSchema } = await import('@agnohire/shared');
  return ok(res, { template: await emailTemplates.createEmailTemplate(createEmailTemplateSchema.parse(req.body), req) }, 201);
});


export const updateEmailTemplate = asyncHandler(async (req: Request, res: Response) => {
  const { updateEmailTemplateSchema } = await import('@agnohire/shared');
  return ok(res, { template: await emailTemplates.updateEmailTemplate(req.params.id, updateEmailTemplateSchema.parse(req.body), req) });
});

export const deleteEmailTemplate = asyncHandler(async (req: Request, res: Response) => {
  await emailTemplates.deleteEmailTemplate(req.params.id, req);
  return ok(res, { deleted: true });
});

export const applyLogoToAll = asyncHandler(async (req: Request, res: Response) => {
  await emailTemplates.applyLogoToAll(req.body, req);
  return ok(res, { success: true });
});
