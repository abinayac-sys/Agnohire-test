import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as auditService from '../services/auditService.js';
import type { AuditContext } from '../services/auditService.js';

function ctx(req: Request): AuditContext {
  return { userId: req.user!.sub, role: req.user!.role, sectorId: req.user!.sectorId };
}

export const listAuditLogs = asyncHandler(async (req: Request, res: Response) => {
  const { auditFiltersSchema } = await import('@agnohire/shared');
  return ok(res, await auditService.listAuditLogs(ctx(req), auditFiltersSchema.parse(req.query)));
});

export const getAuditFacets = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, await auditService.getAuditFacets(ctx(req)));
});

export const getAuditLog = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, { log: await auditService.getAuditLog(ctx(req), req.params.id) });
});

export const exportAuditLogs = asyncHandler(async (req: Request, res: Response) => {
  const { auditExportSchema } = await import('@agnohire/shared');
  const { filename, buffer } = await auditService.exportAuditLogs(ctx(req), auditExportSchema.parse(req.query));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.status(200).send(buffer);
});

export const deleteAuditLog = asyncHandler(async (req: Request, res: Response) => {
  await auditService.deleteAuditLog(ctx(req), req.params.id);
  return ok(res, { deleted: true });
});

export const deleteAuditLogsBulk = asyncHandler(async (req: Request, res: Response) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) {
    return res.status(400).json({ success: false, error: 'ids must be an array' });
  }
  await auditService.deleteAuditLogsBulk(ctx(req), ids);
  return ok(res, { deleted: true });
});
