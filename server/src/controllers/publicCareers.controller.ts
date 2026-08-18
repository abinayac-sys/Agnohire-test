import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { NotFoundError } from '../utils/errors.js';
import * as publicCareersService from '../services/publicCareersService.js';
import { publicJobFiltersSchema, publicApplySchema } from '@agnohire/shared';

/** Set by publicCareersScope.middleware's router.param('tenantSlug', ...) before any handler runs. */
function requireCareersTenant(req: Request) {
  if (!req.careersTenant) throw new NotFoundError('Careers page not found');
  return req.careersTenant;
}

export const listJobs = asyncHandler(async (req: Request, res: Response) => {
  const tenant = requireCareersTenant(req);
  const filters = publicJobFiltersSchema.parse(req.query);
  const [jobs, { showHeader }] = await Promise.all([
    publicCareersService.listPublicJobs(tenant.id, filters),
    publicCareersService.getCareersDisplaySettings(),
  ]);
  return ok(res, { jobs, tenant: { name: tenant.name, slug: tenant.slug, showHeader } });
});

export const getJob = asyncHandler(async (req: Request, res: Response) => {
  const tenant = requireCareersTenant(req);
  const [job, { showHeader }] = await Promise.all([
    publicCareersService.getPublicJob(tenant.id, req.params.jobId, tenant.name),
    publicCareersService.getCareersDisplaySettings(),
  ]);
  return ok(res, { job, tenant: { name: tenant.name, slug: tenant.slug, showHeader } });
});

export const apply = asyncHandler(async (req: Request, res: Response) => {
  const tenant = requireCareersTenant(req);
  const data = publicApplySchema.parse(req.body);
  await publicCareersService.applyToJob(tenant.id, req.params.jobId, data, req.file, req);
  return ok(res, { success: true, message: 'Application submitted successfully' });
});
