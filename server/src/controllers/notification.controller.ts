import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';
import * as notificationService from '../services/notificationService.js';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 20);
  const unreadOnly = req.query.unreadOnly === 'true';
  const data = await notificationService.listNotifications(req.user!.sub, { page, limit, unreadOnly });
  return ok(res, data);
});

export const unreadCount = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, { count: await notificationService.unreadCount(req.user!.sub) });
});

export const markRead = asyncHandler(async (req: Request, res: Response) => {
  await notificationService.markRead(req.user!.sub, req.params.id);
  return ok(res, { read: true });
});

export const markAllRead = asyncHandler(async (req: Request, res: Response) => {
  const count = await notificationService.markAllRead(req.user!.sub);
  return ok(res, { read: count });
});

export const clearAll = asyncHandler(async (req: Request, res: Response) => {
  const count = await notificationService.clearAll(req.user!.sub);
  return ok(res, { cleared: count });
});

export const listTenant = asyncHandler(async (req: Request, res: Response) => {
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 20);
  const data = await notificationService.listTenantNotifications(req.user!.sub, { page, limit });
  return ok(res, data);
});

export const tenantUnreadCount = asyncHandler(async (req: Request, res: Response) => {
  const count = await notificationService.tenantUnreadCount(req.user!.sub);
  return ok(res, { count });
});

export const markTenantAllRead = asyncHandler(async (req: Request, res: Response) => {
  const count = await notificationService.markTenantAllRead(req.user!.sub, req.user!.tenantId);
  return ok(res, { read: count });
});

export const clearTenantAll = asyncHandler(async (req: Request, res: Response) => {
  const count = await notificationService.clearTenantAll(req.user!.sub, req.user!.tenantId);
  return ok(res, { cleared: count });
});

