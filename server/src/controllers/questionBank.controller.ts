import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { BadRequestError } from '../utils/errors.js';
import * as bankService from '../services/questionBankService.js';
import type { InterviewContext } from '../services/questionBankService.js';

function ctx(req: Request): InterviewContext {
  return {
    userId: req.user!.sub,
    role: req.user!.role,
    sectorId: req.user!.sectorId,
    permissions: req.user!.permissions,
  };
}

export const listBanks = asyncHandler(async (req: Request, res: Response) => {
  const { questionBankFiltersSchema } = await import('@agnohire/shared');
  const filters = questionBankFiltersSchema.parse(req.query);
  return ok(res, await bankService.listBanks(filters, ctx(req)));
});

export const getBank = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, { bank: await bankService.getBank(req.params.id, ctx(req)) });
});

export const createBank = asyncHandler(async (req: Request, res: Response) => {
  const { createQuestionBankSchema } = await import('@agnohire/shared');
  const data = createQuestionBankSchema.parse(req.body);
  return ok(res, { bank: await bankService.createBank(data, ctx(req), req) }, 201);
});

export const updateBank = asyncHandler(async (req: Request, res: Response) => {
  const { updateQuestionBankSchema } = await import('@agnohire/shared');
  const data = updateQuestionBankSchema.parse(req.body);
  return ok(res, { bank: await bankService.updateBank(req.params.id, data, ctx(req), req) });
});

export const deleteBank = asyncHandler(async (req: Request, res: Response) => {
  await bankService.deleteBank(req.params.id, ctx(req), req);
  return ok(res, { deleted: true });
});

export const addQuestion = asyncHandler(async (req: Request, res: Response) => {
  const { createQuestionSchema } = await import('@agnohire/shared');
  const data = createQuestionSchema.parse(req.body);
  return ok(res, { question: await bankService.addQuestion(req.params.id, data, ctx(req), req) }, 201);
});

export const updateQuestion = asyncHandler(async (req: Request, res: Response) => {
  const { updateQuestionSchema } = await import('@agnohire/shared');
  const data = updateQuestionSchema.parse(req.body);
  return ok(res, {
    question: await bankService.updateQuestion(req.params.id, req.params.qid, data, ctx(req), req),
  });
});

export const deleteQuestion = asyncHandler(async (req: Request, res: Response) => {
  await bankService.deleteQuestion(req.params.id, req.params.qid, ctx(req), req);
  return ok(res, { deleted: true });
});

export const generateQuestions = asyncHandler(async (req: Request, res: Response) => {
  const { generateQuestionsSchema } = await import('@agnohire/shared');
  const data = generateQuestionsSchema.parse(req.body);
  const questions = await bankService.generateQuestions(req.params.id, data, ctx(req), req);
  return ok(res, { questions }, 201);
});

export const importDocument = asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) throw new BadRequestError('No file uploaded. Attach a PDF, Word, or text document.');
  const questions = await bankService.importQuestionsFromDocument(
    req.params.id,
    file.buffer,
    file.mimetype,
    ctx(req),
    req,
  );
  return ok(res, { questions, imported: questions.length }, 201);
});

export const exportBanksPdf = asyncHandler(async (req: Request, res: Response) => {
  const idsStr = req.query.ids as string;
  if (!idsStr) {
    throw new BadRequestError('ids parameter is required');
  }
  const ids = idsStr.split(',').map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) {
    throw new BadRequestError('ids parameter is invalid');
  }

  const { generateQuestionBankPDF } = await import('../services/pdfReportService.js');
  const { buffer, filename } = await generateQuestionBankPDF(ids, ctx(req));

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
});
