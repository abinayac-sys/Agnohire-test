import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as offerService from '../services/offerService.js';
import * as attachmentService from '../services/attachmentService.js';
import { prisma } from '../config/database.js';
import { runWithTenant } from '../config/tenantContext.js';

export const getOfferInfo = asyncHandler(async (req: Request, res: Response) => {
  const info = await offerService.getPublicOfferByToken(req.params.token);
  return ok(res, info);
});

export const acceptOffer = asyncHandler(async (req: Request, res: Response) => {
  const result = await offerService.acceptPublicOfferByToken(req.params.token, req);
  return ok(res, result);
});

export const acceptTentativeOffer = asyncHandler(async (req: Request, res: Response) => {
  const result = await offerService.acceptTentativeOfferByToken(req.params.token, req);
  return ok(res, result);
});

export const getCandidateDocuments = asyncHandler(async (req: Request, res: Response) => {
  const info = await offerService.getCandidateDocumentsPortal(req.params.token);
  return ok(res, info);
});

export const uploadCandidateDocument = asyncHandler(async (req: Request, res: Response) => {
  const { uploadDocumentSchema } = await import('@agnohire/shared');
  const result = await offerService.uploadCandidateDocument(
    req.params.token,
    req.params.documentId,
    uploadDocumentSchema.parse(req.body),
    req
  );
  return ok(res, result);
});

export const uploadCandidateFile = asyncHandler(async (req: Request, res: Response) => {
  // Validate token
  await offerService.getCandidateDocumentsPortal(req.params.token);
  const offer = await prisma.offer.findUnique({
    where: { acceptanceToken: req.params.token },
    select: { tenantId: true },
  });

  const tenantId = offer?.tenantId;
  const meta = tenantId
    ? await runWithTenant(tenantId, () => attachmentService.createAttachment(req.file, undefined, req))
    : await attachmentService.createAttachment(req.file, undefined, req);

  return ok(res, { attachment: meta }, 201);
});
