import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as publicService from '../services/publicInterviewService.js';

export const getInterview = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, { interview: await publicService.getPublicInterview(req.params.token) });
});

export const start = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, await publicService.startInterview(req.params.token));
});

export const answer = asyncHandler(async (req: Request, res: Response) => {
  const { submitAnswerSchema } = await import('@agnohire/shared');
  const data = submitAnswerSchema.parse(req.body);
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
  return ok(res, await publicService.submitInterview(req.params.token));
});

export const biometricEnroll = asyncHandler(async (req: Request, res: Response) => {
  const { biometricEnrollSchema } = await import('@agnohire/shared');
  const data = biometricEnrollSchema.parse(req.body);
  return ok(res, await publicService.biometricEnroll(req.params.token, data));
});

export const biometricVerify = asyncHandler(async (req: Request, res: Response) => {
  const { biometricVerifySchema } = await import('@agnohire/shared');
  const data = biometricVerifySchema.parse(req.body);
  return ok(res, await publicService.biometricVerify(req.params.token, data));
});

export const executeCodeHandler = asyncHandler(async (req: Request, res: Response) => {
  const { questionId, language, code, stdin } = req.body;
  const result = await publicService.executeCandidateCode(
    req.params.token,
    questionId,
    language,
    code,
    stdin ?? '',
  );
  return ok(res, result);
});

export const runTestsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { questionId, language, code } = req.body;
  const results = await publicService.runSampleTests(req.params.token, questionId, language, code);
  return ok(res, { results });
});

