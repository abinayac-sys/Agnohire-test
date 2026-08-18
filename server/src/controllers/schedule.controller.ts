import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as scheduleService from '../services/scheduleService.js';
import { computeAvailability } from '../services/availabilityService.js';
import type { InterviewContext } from '../services/questionBankService.js';

function ctx(req: Request): InterviewContext {
  return {
    userId: req.user!.sub,
    role: req.user!.role,
    sectorId: req.user!.sectorId,
    permissions: req.user!.permissions,
  };
}

export const listSchedules = asyncHandler(async (req: Request, res: Response) => {
  const { scheduleFiltersSchema } = await import('@agnohire/shared');
  const filters = scheduleFiltersSchema.parse(req.query);
  return ok(res, await scheduleService.listSchedules(filters, ctx(req)));
});

export const exportSchedules = asyncHandler(async (req: Request, res: Response) => {
  const { scheduleFiltersSchema } = await import('@agnohire/shared');
  const filters = scheduleFiltersSchema.parse(req.query);
  
  let ids: string[] | undefined = undefined;
  if (req.query.ids) {
    ids = Array.isArray(req.query.ids) ? req.query.ids as string[] : (req.query.ids as string).split(',');
  }
  
  const { buffer, filename } = await scheduleService.generateSchedulesExcel(filters, ids, ctx(req));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(buffer);
});

export const getAvailability = asyncHandler(async (req: Request, res: Response) => {
  const { availabilityQuerySchema } = await import('@agnohire/shared');
  const { interviewerIds, date, duration, excludeInterviewId, timeZone } = availabilityQuerySchema.parse(req.query);
  return ok(res, await computeAvailability(interviewerIds, date, duration, req.user!.sectorId, excludeInterviewId, timeZone));
});

export const getSchedule = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, { schedule: await scheduleService.getSchedule(req.params.id, ctx(req)) });
});

export const createSchedule = asyncHandler(async (req: Request, res: Response) => {
  const { createScheduleSchema } = await import('@agnohire/shared');
  const data = createScheduleSchema.parse(req.body);
  return ok(res, { schedule: await scheduleService.createSchedule(data, ctx(req), req) }, 201);
});

export const rescheduleInterview = asyncHandler(async (req: Request, res: Response) => {
  const { updateScheduleSchema } = await import('@agnohire/shared');
  const data = updateScheduleSchema.parse(req.body);
  return ok(res, { schedule: await scheduleService.rescheduleInterview(req.params.id, data, ctx(req), req) });
});

export const cancelSchedule = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, await scheduleService.cancelSchedule(req.params.id, ctx(req), req));
});

export const deleteSchedule = asyncHandler(async (req: Request, res: Response) => {
  await scheduleService.deleteSchedule(req.params.id, ctx(req), req);
  return ok(res, { deleted: true });
});

export const syncSchedule = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, await scheduleService.syncSchedule(req.params.id, ctx(req)));
});

export const generateMeet = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, await scheduleService.generateMeet(req.params.id, ctx(req)));
});

export const completeSchedule = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, { schedule: await scheduleService.completeSchedule(req.params.id, ctx(req), req) });
});

export const sendScheduleInvite = asyncHandler(async (req: Request, res: Response) => {
  const { selectedChannels } = req.body;
  // force=true allows re-sending the invite any number of times
  return ok(res, { result: await scheduleService.sendScheduleInvite(req.params.id, ctx(req), req, { force: true, selectedChannels }) });
});

export const listPassedCandidates = asyncHandler(async (req: Request, res: Response) => {
  const jobRequisitionId = typeof req.query.jobRequisitionId === 'string' ? req.query.jobRequisitionId : undefined;
  const roundNumber = req.query.roundNumber ? Number(req.query.roundNumber) : undefined;
  return ok(res, { candidates: await scheduleService.listPassedCandidates(ctx(req), jobRequisitionId, roundNumber) });
});

export const getCalendarStatus = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, await scheduleService.getCalendarStatus(ctx(req)));
});
