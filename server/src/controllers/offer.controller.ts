import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as offerService from '../services/offerService.js';
import type { OfferContext } from '../services/offerService.js';

function ctx(req: Request): OfferContext {
  return {
    userId: req.user!.sub,
    role: req.user!.role,
    sectorId: req.user!.sectorId,
    permissions: req.user!.permissions,
  };
}

export const listOffers = asyncHandler(async (req: Request, res: Response) => {
  const { offerFiltersSchema } = await import('@agnohire/shared');
  return ok(res, await offerService.listOffers(offerFiltersSchema.parse(req.query), ctx(req)));
});

export const getOffer = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, { offer: await offerService.getOffer(req.params.id, ctx(req)) });
});

export const createOffer = asyncHandler(async (req: Request, res: Response) => {
  const { createOfferSchema } = await import('@agnohire/shared');
  return ok(res, { offer: await offerService.createOffer(createOfferSchema.parse(req.body), ctx(req), req) }, 201);
});

export const updateOffer = asyncHandler(async (req: Request, res: Response) => {
  const { updateOfferSchema } = await import('@agnohire/shared');
  return ok(res, { offer: await offerService.updateOffer(req.params.id, updateOfferSchema.parse(req.body), ctx(req), req) });
});

export const deleteOffer = asyncHandler(async (req: Request, res: Response) => {
  await offerService.deleteOffer(req.params.id, ctx(req), req);
  return ok(res, { deleted: true });
});

export const sendOffer = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, { offer: await offerService.sendOffer(req.params.id, ctx(req), req) });
});

export const resendTentativeOffer = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, { offer: await offerService.resendTentativeOffer(req.params.id, ctx(req), req) });
});

export const respondOffer = asyncHandler(async (req: Request, res: Response) => {
  const { respondOfferSchema } = await import('@agnohire/shared');
  return ok(res, { offer: await offerService.respondOffer(req.params.id, respondOfferSchema.parse(req.body), ctx(req), req) });
});

export const addDocument = asyncHandler(async (req: Request, res: Response) => {
  const { addOfferDocumentSchema } = await import('@agnohire/shared');
  return ok(res, { offer: await offerService.addDocument(req.params.id, addOfferDocumentSchema.parse(req.body), ctx(req), req) }, 201);
});

export const removeDocument = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, { offer: await offerService.removeDocument(req.params.id, req.params.documentId, ctx(req), req) });
});

export const updateDocument = asyncHandler(async (req: Request, res: Response) => {
  const { addOfferDocumentSchema } = await import('@agnohire/shared');
  return ok(res, { offer: await offerService.updateDocument(req.params.id, req.params.documentId, addOfferDocumentSchema.parse(req.body), ctx(req), req) });
});

export const updateOnboarding = asyncHandler(async (req: Request, res: Response) => {
  const { updateOnboardingSchema } = await import('@agnohire/shared');
  return ok(res, { offer: await offerService.updateOnboarding(req.params.id, updateOnboardingSchema.parse(req.body), ctx(req), req) });
});

export const setChecklist = asyncHandler(async (req: Request, res: Response) => {
  const { setChecklistSchema } = await import('@agnohire/shared');
  return ok(res, { offer: await offerService.setChecklist(req.params.id, setChecklistSchema.parse(req.body), ctx(req), req) });
});

export const toggleChecklistItem = asyncHandler(async (req: Request, res: Response) => {
  const { toggleChecklistItemSchema } = await import('@agnohire/shared');
  return ok(res, { offer: await offerService.toggleChecklistItem(req.params.id, toggleChecklistItemSchema.parse(req.body), ctx(req), req) });
});

export const createDocumentRequirement = asyncHandler(async (req: Request, res: Response) => {
  const { createDocumentRequirementSchema } = await import('@agnohire/shared');
  return ok(
    res,
    { offer: await offerService.createDocumentRequirement(req.params.id, createDocumentRequirementSchema.parse(req.body), ctx(req), req) },
    201
  );
});

export const verifyDocument = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, { offer: await offerService.verifyDocument(req.params.id, req.params.documentId, ctx(req), req) });
});

export const rejectDocument = asyncHandler(async (req: Request, res: Response) => {
  const { rejectDocumentSchema } = await import('@agnohire/shared');
  return ok(
    res,
    { offer: await offerService.rejectDocument(req.params.id, req.params.documentId, rejectDocumentSchema.parse(req.body), ctx(req), req) }
  );
});

export const sendDocumentRequestEmail = asyncHandler(async (req: Request, res: Response) => {
  const { documentIds, documentId } = req.body;
  const ids = documentIds || (documentId ? [documentId] : undefined);
  await offerService.sendDocumentRequestEmail(req.params.id, ids);
  return ok(res, { message: 'Document request email sent successfully' });
});

export const sendFinalOfferLetter = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, { offer: await offerService.sendFinalOfferLetter(req.params.id, ctx(req), req) });
});

export const reorderDocuments = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, { offer: await offerService.reorderDocuments(req.params.id, req.body.documentIds, ctx(req), req) });
});

export const getOnboardingDocumentsConfig = asyncHandler(async (_req: Request, res: Response) => {
  const { configService } = await import('../services/configService.js');
  const { CONFIG_KEYS } = await import('@agnohire/shared');
  const value = await configService.getString(CONFIG_KEYS.ONBOARDING_REQUIRED_DOCUMENTS, '[]');
  return ok(res, { value });
});

export const updateOnboardingDocumentsConfig = asyncHandler(async (req: Request, res: Response) => {
  const { configService } = await import('../services/configService.js');
  const { CONFIG_KEYS } = await import('@agnohire/shared');
  const { value } = req.body;
  await configService.set(CONFIG_KEYS.ONBOARDING_REQUIRED_DOCUMENTS as any, String(value ?? '[]'), { updatedById: req.user!.sub });
  return ok(res, { success: true });
});
