import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as hrApprovalService from '../services/hrApprovalService.js';
import type { InterviewContext } from '../services/questionBankService.js';

function ctx(req: Request): InterviewContext {
  return {
    userId: req.user!.sub,
    role: req.user!.role,
    sectorId: req.user!.sectorId,
    permissions: req.user!.permissions,
  };
}

export const getApprovalQueue = asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string || '1', 10);
  const limit = parseInt(req.query.limit as string || '25', 10);
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  return ok(res, await hrApprovalService.getApprovalQueue(page, limit, from, to, ctx(req)));
});

export const getConsolidatedReport = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, { report: await hrApprovalService.getConsolidatedReport(req.params.candidateId, ctx(req)) });
});

export const getProcessedQueue = asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string || '1', 10);
  const limit = parseInt(req.query.limit as string || '25', 10);
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  return ok(res, await hrApprovalService.getProcessedQueue(page, limit, from, to, ctx(req)));
});

export const processHrApproval = asyncHandler(async (req: Request, res: Response) => {
  const { hrApprovalSchema } = await import('@agnohire/shared');
  const data = hrApprovalSchema.parse(req.body);
  return ok(res, await hrApprovalService.processHrApproval(req.params.interviewId, data, req.user!.sub, req));
});

export const deleteHrApproval = asyncHandler(async (req: Request, res: Response) => {
  await hrApprovalService.deleteHrApproval(req.params.interviewId, req);
  return ok(res, { deleted: true });
});
