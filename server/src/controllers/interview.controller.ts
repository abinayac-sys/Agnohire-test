import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as interviewService from '../services/interviewService.js';
import type { InterviewContext } from '../services/questionBankService.js';
import type { InterviewStatus, Decision } from '@agnohire/shared';

function ctx(req: Request): InterviewContext {
  return {
    userId: req.user!.sub,
    role: req.user!.role,
    sectorId: req.user!.sectorId,
    permissions: req.user!.permissions,
  };
}

export const listInterviews = asyncHandler(async (req: Request, res: Response) => {
  const { interviewFiltersSchema } = await import('@agnohire/shared');
  const filters = interviewFiltersSchema.parse(req.query);
  return ok(res, await interviewService.listInterviews(filters, ctx(req)));
});

export const getInterview = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, { interview: await interviewService.getInterview(req.params.id, ctx(req)) });
});

export const createInterview = asyncHandler(async (req: Request, res: Response) => {
  const { createInterviewSchema } = await import('@agnohire/shared');
  const data = createInterviewSchema.parse(req.body);
  return ok(res, { interview: await interviewService.createInterview(data, ctx(req), req) }, 201);
});

export const cancelInterview = asyncHandler(async (req: Request, res: Response) => {
  await interviewService.cancelInterview(req.params.id, ctx(req), req);
  return ok(res, { cancelled: true });
});

export const deleteInterview = asyncHandler(async (req: Request, res: Response) => {
  await interviewService.deleteInterview(req.params.id, ctx(req), req);
  return ok(res, { deleted: true });
});

export const decideInterview = asyncHandler(async (req: Request, res: Response) => {
  const { interviewDecisionSchema } = await import('@agnohire/shared');
  const data = interviewDecisionSchema.parse(req.body);
  return ok(res, { interview: await interviewService.decideInterview(req.params.id, data, ctx(req), req) });
});

export const submitDecision = asyncHandler(async (req: Request, res: Response) => {
  const { submitDecisionSchema } = await import('@agnohire/shared');
  const data = submitDecisionSchema.parse(req.body);
  return ok(res, { interview: await interviewService.submitDecision(req.params.id, data, ctx(req), req) });
});

export const getProctorShot = asyncHandler(async (req: Request, res: Response) => {
  const { mimeType, data } = await interviewService.getProctorShot(
    req.params.id,
    req.params.shotId,
    ctx(req),
  );
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Cache-Control', 'private, max-age=300');
  return res.send(data);
});

export const sendInvite = asyncHandler(async (req: Request, res: Response) => {
  const { selectedChannels } = req.body;
  // force=true allows re-sending the invite any number of times
  return ok(res, { result: await interviewService.sendInterviewInvite(req.params.id, ctx(req), req, { force: true, selectedChannels }) });
});

export const sendResult = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, { result: await interviewService.sendInterviewResult(req.params.id, ctx(req), req) });
});

export const exportReport = asyncHandler(async (req: Request, res: Response) => {
  const interview = await interviewService.getInterview(req.params.id, ctx(req));
  const { generateInterviewReportPDF } = await import('../services/pdfReportService.js');
  const buffer = await generateInterviewReportPDF(req.params.id, ctx(req));
  const filename = `${interview.candidate.fullName.trim().replace(/\s+/g, '_')}_Interview_Report.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(buffer);
});

export const exportBulkReports = asyncHandler(async (req: Request, res: Response) => {
  const idsParam = req.query.ids as string | undefined;
  const ids = idsParam
    ? idsParam.split(',').map((id) => id.trim()).filter(Boolean)
    : await interviewService.listReportableInterviewIds(
        {
          search: (req.query.search as string) || undefined,
          status: (req.query.status as InterviewStatus) || undefined,
          decision: (req.query.decision as Decision) || undefined,
          jobRequisitionId: (req.query.jobRequisitionId as string) || undefined,
          from: (req.query.from as string) || undefined,
          to: (req.query.to as string) || undefined,
        },
        ctx(req),
      );

  const { buffer, filename } = await interviewService.generateInterviewsExcel(ids, ctx(req));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(buffer);
});

export const listResultCandidates = asyncHandler(async (req: Request, res: Response) => {
  const outcome = req.query.outcome === 'PASS' || req.query.outcome === 'FAIL' ? req.query.outcome : undefined;
  const source = req.query.source === 'SCHEDULED' ? 'SCHEDULED' : 'AI';
  return ok(res, { items: await interviewService.listResultCandidates(ctx(req), outcome, source) });
});

export const sendBulkResults = asyncHandler(async (req: Request, res: Response) => {
  const { sendBulkResultsSchema } = await import('@agnohire/shared');
  const { interviewIds, force } = sendBulkResultsSchema.parse(req.body);
  return ok(res, { result: await interviewService.sendBulkResults(ctx(req), req, interviewIds, force) });
});

export const sendBulkInvites = asyncHandler(async (req: Request, res: Response) => {
  const { sendBulkResultsSchema } = await import('@agnohire/shared');
  const { interviewIds } = sendBulkResultsSchema.parse(req.body);
  const selectedChannels = Array.isArray(req.body.selectedChannels) ? req.body.selectedChannels.map(String) : undefined;
  return ok(res, { result: await interviewService.sendBulkInvites(ctx(req), req, interviewIds, selectedChannels) });
});
