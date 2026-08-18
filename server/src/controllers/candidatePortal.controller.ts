import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as portal from '../services/candidatePortalService.js';

function principal(req: Request): { sub: string; email: string } {
  return { sub: req.user!.sub, email: req.user!.email };
}

export const listMyInterviews = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, { interviews: await portal.listMyInterviews(principal(req)) });
});

export const listMyApplications = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, { applications: await portal.listMyApplications(principal(req)) });
});

export const listMyOffers = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, { offers: await portal.listMyOffers(principal(req)) });
});

export const downloadMyReport = asyncHandler(async (req: Request, res: Response) => {
  const { filePath, fileName } = await portal.getMyReportPath(req.params.id, principal(req));
  const fs = await import('fs');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
  const fileStream = fs.createReadStream(filePath);
  fileStream.pipe(res);
});
