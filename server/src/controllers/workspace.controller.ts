import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';
import * as workspaces from '../services/workspaceService.js';
import {
  createWorkspaceSchema,
  updateWorkspaceSchema,
  addWorkspaceMemberSchema,
  updateWorkspaceMemberRoleSchema,
} from '@agnohire/shared';

export const listWorkspaces = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = typeof req.query.organizationId === 'string' ? req.query.organizationId : undefined;
  return ok(res, { workspaces: await workspaces.listWorkspaces(req.user!, organizationId) });
});

export const getWorkspace = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, { workspace: await workspaces.getWorkspace(req.params.id, req.user!) });
});

export const createWorkspace = asyncHandler(async (req: Request, res: Response) => {
  const data = createWorkspaceSchema.parse(req.body);
  return ok(res, { workspace: await workspaces.createWorkspace(data, req) }, 201);
});

export const updateWorkspace = asyncHandler(async (req: Request, res: Response) => {
  const data = updateWorkspaceSchema.parse(req.body);
  return ok(res, { workspace: await workspaces.updateWorkspace(req.params.id, data, req) });
});

export const deleteWorkspace = asyncHandler(async (req: Request, res: Response) => {
  await workspaces.deleteWorkspace(req.params.id, req);
  return ok(res, { deleted: true });
});

export const listWorkspaceMembers = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, { members: await workspaces.listWorkspaceMembers(req.params.id, req.user!) });
});

export const addWorkspaceMember = asyncHandler(async (req: Request, res: Response) => {
  const data = addWorkspaceMemberSchema.parse(req.body);
  await workspaces.addWorkspaceMember(req.params.id, data, req);
  return ok(res, { added: true }, 201);
});

export const updateWorkspaceMemberRole = asyncHandler(async (req: Request, res: Response) => {
  const data = updateWorkspaceMemberRoleSchema.parse(req.body);
  await workspaces.updateWorkspaceMemberRole(req.params.id, req.params.userId, data, req);
  return ok(res, { updated: true });
});

export const removeWorkspaceMember = asyncHandler(async (req: Request, res: Response) => {
  await workspaces.removeWorkspaceMember(req.params.id, req.params.userId, req);
  return ok(res, { removed: true });
});
