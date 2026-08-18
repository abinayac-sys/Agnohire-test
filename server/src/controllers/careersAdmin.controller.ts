import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as careersAdminService from '../services/careersAdminService.js';
import { updateJobSalaryVisibilitySchema } from '@agnohire/shared';

export const listJobs = asyncHandler(async (_req: Request, res: Response) => {
  return ok(res, { jobs: await careersAdminService.listCareersJobs() });
});

export const setSalaryVisibility = asyncHandler(async (req: Request, res: Response) => {
  const { showSalaryPublicly } = updateJobSalaryVisibilitySchema.parse(req.body);
  const job = await careersAdminService.setJobSalaryVisibility(req.params.jobId, showSalaryPublicly, req);
  return ok(res, { job });
});
