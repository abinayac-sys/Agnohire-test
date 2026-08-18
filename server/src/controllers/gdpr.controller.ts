import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as gdprService from '../services/gdprService.js';
import type { GdprContext } from '../services/gdprService.js';

function ctx(req: Request): GdprContext {
  return { userId: req.user!.sub, role: req.user!.role, sectorId: req.user!.sectorId };
}

// ─── SUMMARY ─────────────────────────────────────────────────────────────────

export const getSummary = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, await gdprService.getComplianceSummary(ctx(req)));
});

// ─── REQUESTS ────────────────────────────────────────────────────────────────

export const listRequests = asyncHandler(async (req: Request, res: Response) => {
  const { gdprFiltersSchema } = await import('@agnohire/shared');
  return ok(res, await gdprService.listGdprRequests(ctx(req), gdprFiltersSchema.parse(req.query)));
});

export const createRequest = asyncHandler(async (req: Request, res: Response) => {
  const { createGdprRequestSchema } = await import('@agnohire/shared');
  return ok(res, { request: await gdprService.createGdprRequest(ctx(req), createGdprRequestSchema.parse(req.body), req) }, 201);
});

export const processRequest = asyncHandler(async (req: Request, res: Response) => {
  const { processGdprRequestSchema } = await import('@agnohire/shared');
  return ok(res, await gdprService.processGdprRequest(ctx(req), req.params.id, processGdprRequestSchema.parse(req.body), req));
});

// ─── DIRECT EXPORT ───────────────────────────────────────────────────────────

export const exportCandidate = asyncHandler(async (req: Request, res: Response) => {
  // Sector boundary is enforced inside the service before assembling the bundle.
  const bundle = await gdprService.exportCandidateData(ctx(req), req.params.candidateId, req);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="agnohire-gdpr-export-${req.params.candidateId}.json"`);
  return res.status(200).send(JSON.stringify(bundle, null, 2));
});

// ─── CONSENT ─────────────────────────────────────────────────────────────────

export const listConsent = asyncHandler(async (req: Request, res: Response) => {
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 25);
  return ok(res, await gdprService.listConsent(ctx(req), page, limit));
});

export const setConsent = asyncHandler(async (req: Request, res: Response) => {
  const { setConsentSchema } = await import('@agnohire/shared');
  return ok(res, { consent: await gdprService.setConsent(ctx(req), setConsentSchema.parse(req.body), req) });
});

// ─── RETENTION ───────────────────────────────────────────────────────────────

export const listRetention = asyncHandler(async (_req: Request, res: Response) => {
  return ok(res, { policies: await gdprService.listRetentionPolicies() });
});

export const upsertRetention = asyncHandler(async (req: Request, res: Response) => {
  const { retentionPolicySchema } = await import('@agnohire/shared');
  return ok(res, { policy: await gdprService.upsertRetentionPolicy(retentionPolicySchema.parse(req.body), req) }, 201);
});

export const deleteRetention = asyncHandler(async (req: Request, res: Response) => {
  await gdprService.deleteRetentionPolicy(req.params.id, req);
  return ok(res, { deleted: true });
});
