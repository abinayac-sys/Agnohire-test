import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as analyticsService from '../services/analyticsService.js';
import type { InterviewContext } from '../services/questionBankService.js';

function ctx(req: Request): InterviewContext {
  return {
    userId: req.user!.sub,
    role: req.user!.role,
    sectorId: req.user!.sectorId,
    permissions: req.user!.permissions,
  };
}

export const getDashboard = asyncHandler(async (req: Request, res: Response) => {
  const { analyticsFiltersSchema } = await import('@agnohire/shared');
  const filters = analyticsFiltersSchema.parse(req.query);
  return ok(res, { dashboard: await analyticsService.getDashboard(filters, ctx(req)) });
});

export const getInsights = asyncHandler(async (req: Request, res: Response) => {
  const { analyticsFiltersSchema } = await import('@agnohire/shared');
  const filters = analyticsFiltersSchema.parse(req.query);
  return ok(res, { insights: await analyticsService.getInsights(filters, ctx(req)) });
});

export const exportReport = asyncHandler(async (req: Request, res: Response) => {
  const { exportReportSchema } = await import('@agnohire/shared');
  const input = exportReportSchema.parse(req.query);
  const { filename, buffer } = await analyticsService.exportReport(input, ctx(req), req);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.status(200).send(buffer);
});

export const listSnapshots = asyncHandler(async (req: Request, res: Response) => {
  const { snapshotFiltersSchema } = await import('@agnohire/shared');
  const filters = snapshotFiltersSchema.parse(req.query);
  return ok(res, await analyticsService.listSnapshots(filters, ctx(req)));
});

export const saveSnapshot = asyncHandler(async (req: Request, res: Response) => {
  const { analyticsFiltersSchema } = await import('@agnohire/shared');
  const filters = analyticsFiltersSchema.parse(req.body ?? {});
  return ok(res, { snapshot: await analyticsService.saveSnapshot(filters, ctx(req), req) }, 201);
});

export const deleteSnapshot = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, await analyticsService.deleteSnapshot(req.params.id, ctx(req), req));
});

export const exportSnapshotPDF = asyncHandler(async (req: Request, res: Response) => {
  const { buffer, filename } = await analyticsService.exportSnapshotPDF(req.params.id, ctx(req));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.status(200).send(buffer);
});
