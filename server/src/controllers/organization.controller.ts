import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';
import * as organizations from '../services/organizationService.js';
import {
  createOrganizationSchema,
  updateOrganizationSchema,
  addOrganizationMemberSchema,
  updateOrganizationMemberRoleSchema,
} from '@agnohire/shared';

export const listOrganizations = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, { organizations: await organizations.listOrganizations(req.user!) });
});

export const getOrganization = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, { organization: await organizations.getOrganization(req.params.id, req.user!) });
});

export const createOrganization = asyncHandler(async (req: Request, res: Response) => {
  const data = createOrganizationSchema.parse(req.body);
  return ok(res, { organization: await organizations.createOrganization(data, req) }, 201);
});

export const updateOrganization = asyncHandler(async (req: Request, res: Response) => {
  const data = updateOrganizationSchema.parse(req.body);
  return ok(res, { organization: await organizations.updateOrganization(req.params.id, data, req) });
});

export const deleteOrganization = asyncHandler(async (req: Request, res: Response) => {
  await organizations.deleteOrganization(req.params.id, req);
  return ok(res, { deleted: true });
});

export const listOrganizationMembers = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, { members: await organizations.listOrganizationMembers(req.params.id, req.user!) });
});

export const addOrganizationMember = asyncHandler(async (req: Request, res: Response) => {
  const data = addOrganizationMemberSchema.parse(req.body);
  await organizations.addOrganizationMember(req.params.id, data, req);
  return ok(res, { added: true }, 201);
});

export const updateOrganizationMemberRole = asyncHandler(async (req: Request, res: Response) => {
  const data = updateOrganizationMemberRoleSchema.parse(req.body);
  await organizations.updateOrganizationMemberRole(req.params.id, req.params.userId, data, req);
  return ok(res, { updated: true });
});

export const removeOrganizationMember = asyncHandler(async (req: Request, res: Response) => {
  await organizations.removeOrganizationMember(req.params.id, req.params.userId, req);
  return ok(res, { removed: true });
});
