import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as publicService from '../services/publicAssessmentService.js';

export const getAssessment = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, { assessment: await publicService.getPublicAssessment(req.params.token) });
});

export const start = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, await publicService.startAssessment(req.params.token));
});

export const answer = asyncHandler(async (req: Request, res: Response) => {
  const { submitAssessmentAnswerSchema } = await import('@agnohire/shared');
  const data = submitAssessmentAnswerSchema.parse(req.body);
  await publicService.saveAnswer(req.params.token, data);
  return ok(res, { saved: true });
});

export const violation = asyncHandler(async (req: Request, res: Response) => {
  const { recordViolationSchema } = await import('@agnohire/shared');
  const data = recordViolationSchema.parse(req.body);
  return ok(res, await publicService.recordViolation(req.params.token, data));
});

export const snapshot = asyncHandler(async (req: Request, res: Response) => {
  const { proctorSnapshotSchema } = await import('@agnohire/shared');
  const data = proctorSnapshotSchema.parse(req.body);
  return ok(res, await publicService.saveSnapshot(req.params.token, data));
});

export const recording = asyncHandler(async (req: Request, res: Response) => {
  const { interviewRecordingSchema } = await import('@agnohire/shared');
  const data = interviewRecordingSchema.parse(req.body);
  return ok(res, await publicService.saveRecording(req.params.token, data));
});

export const submit = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, await publicService.submitAssessment(req.params.token));
});
