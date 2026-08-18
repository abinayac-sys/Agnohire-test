import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as reviewService from '../services/reviewService.js';
import type { InterviewContext } from '../services/questionBankService.js';

function ctx(req: Request): InterviewContext {
  return {
    userId: req.user!.sub,
    role: req.user!.role,
    sectorId: req.user!.sectorId,
    permissions: req.user!.permissions,
  };
}

export const listReviews = asyncHandler(async (req: Request, res: Response) => {
  const { reviewFiltersSchema } = await import('@agnohire/shared');
  const filters = reviewFiltersSchema.parse(req.query);
  return ok(res, await reviewService.listReviews(filters, ctx(req)));
});

export const getReview = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, { review: await reviewService.getReview(req.params.id, ctx(req)) });
});

export const setMedia = asyncHandler(async (req: Request, res: Response) => {
  const { setMediaSchema } = await import('@agnohire/shared');
  const data = setMediaSchema.parse(req.body);
  return ok(res, { review: await reviewService.setMedia(req.params.id, data, ctx(req), req) });
});

export const transcribe = asyncHandler(async (req: Request, res: Response) => {
  const review = await reviewService.transcribe(req.params.id, ctx(req), req);
  return ok(res, { transcribed: true, review });
});

export const reanalyze = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, await reviewService.reanalyze(req.params.id, ctx(req), req));
});

export const submitReview = asyncHandler(async (req: Request, res: Response) => {
  const { submitReviewSchema } = await import('@agnohire/shared');
  const data = submitReviewSchema.parse(req.body);
  return ok(res, { review: await reviewService.submitReview(req.params.id, data, ctx(req), req) });
});

export const deleteReview = asyncHandler(async (req: Request, res: Response) => {
  await reviewService.deleteReview(req.params.id, ctx(req), req);
  return ok(res, { deleted: true });
});

export const downloadReport = asyncHandler(async (req: Request, res: Response) => {
  const fs = await import('fs');
  const path = await import('path');
  const review = await reviewService.getReview(req.params.id, ctx(req));

  // Always regenerate so the report reflects the current template and
  // interview data, rather than serving a stale cached PDF from disk.
  let filePath: string | null = null;
  try {
    const { generateInterviewReportPDF } = await import('../services/pdfReportService.js');
    const pdfBuffer = await generateInterviewReportPDF(req.params.id);

    const reportsDir = path.join(process.cwd(), 'uploads', 'reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    const fileName = `report_${req.params.id}.pdf`;
    const newFilePath = path.join(reportsDir, fileName);
    fs.writeFileSync(newFilePath, pdfBuffer);

    const { prisma } = await import('../config/database.js');
    const feedbackPdfPath = `/uploads/reports/${fileName}`;
    await prisma.interviewResult.update({
      where: { interviewId: req.params.id },
      data: { feedbackPdfPath }
    });

    filePath = newFilePath;
  } catch (err) {
    const fallbackPath = review.feedbackPdfPath ? path.join(process.cwd(), review.feedbackPdfPath) : null;
    if (fallbackPath && fs.existsSync(fallbackPath)) {
      filePath = fallbackPath;
    }
  }

  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: 'Report not found or could not be generated' });
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=Performance_Report_${review.candidate.fullName.replace(/\s+/g, '_')}.pdf`);
  
  const fileStream = fs.createReadStream(filePath);
  fileStream.pipe(res);
});
