import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as assessmentService from '../services/assessmentService.js';
import type { InterviewContext } from '../services/questionBankService.js';

function ctx(req: Request): InterviewContext {
  return {
    userId: req.user!.sub,
    role: req.user!.role,
    sectorId: req.user!.sectorId,
    permissions: req.user!.permissions,
  };
}

// ─── TEMPLATES ────────────────────────────────────────────────────────────────

export const listAssessments = asyncHandler(async (req: Request, res: Response) => {
  const { assessmentFiltersSchema } = await import('@agnohire/shared');
  const filters = assessmentFiltersSchema.parse(req.query);
  return ok(res, await assessmentService.listAssessments(filters, ctx(req)));
});

export const getAssessment = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, { assessment: await assessmentService.getAssessment(req.params.id, ctx(req)) });
});

export const createAssessment = asyncHandler(async (req: Request, res: Response) => {
  const { createAssessmentSchema } = await import('@agnohire/shared');
  const data = createAssessmentSchema.parse(req.body);
  return ok(res, { assessment: await assessmentService.createAssessment(data, ctx(req), req) }, 201);
});

export const updateAssessment = asyncHandler(async (req: Request, res: Response) => {
  const { updateAssessmentSchema } = await import('@agnohire/shared');
  const data = updateAssessmentSchema.parse(req.body);
  return ok(res, { assessment: await assessmentService.updateAssessment(req.params.id, data, ctx(req), req) });
});

export const deleteAssessment = asyncHandler(async (req: Request, res: Response) => {
  await assessmentService.deleteAssessment(req.params.id, ctx(req), req);
  return ok(res, { deleted: true });
});

// ─── ASSIGNMENTS ──────────────────────────────────────────────────────────────

export const assignAssessment = asyncHandler(async (req: Request, res: Response) => {
  const { assignAssessmentSchema } = await import('@agnohire/shared');
  const data = assignAssessmentSchema.parse(req.body);
  return ok(res, await assessmentService.assignAssessment(req.params.id, data, ctx(req), req), 201);
});

export const listAssignments = asyncHandler(async (req: Request, res: Response) => {
  const { assignmentFiltersSchema } = await import('@agnohire/shared');
  const filters = assignmentFiltersSchema.parse(req.query);
  return ok(res, await assessmentService.listAssignments(filters, ctx(req)));
});

export const getAssignment = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, { assignment: await assessmentService.getAssignment(req.params.id, ctx(req)) });
});

export const cancelAssignment = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, await assessmentService.cancelAssignment(req.params.id, ctx(req), req));
});

export const getAssignmentProctorShot = asyncHandler(async (req: Request, res: Response) => {
  const { mimeType, data } = await assessmentService.getAssignmentProctorShot(req.params.id, req.params.shotId, ctx(req));
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Cache-Control', 'private, max-age=300');
  return res.send(data);
});

export const sendResultEmail = asyncHandler(async (req: Request, res: Response) => {
  const { sendAssessmentResultSchema } = await import('@agnohire/shared');
  const data = sendAssessmentResultSchema.parse(req.body);
  return ok(res, { result: await assessmentService.sendAssessmentResultEmail(req.params.id, data, ctx(req), req) });
});

export const bulkSendResultEmail = asyncHandler(async (req: Request, res: Response) => {
  const { bulkSendAssessmentResultSchema } = await import('@agnohire/shared');
  const data = bulkSendAssessmentResultSchema.parse(req.body);
  return ok(res, await assessmentService.bulkSendAssessmentResultEmail(data, ctx(req), req));
});
