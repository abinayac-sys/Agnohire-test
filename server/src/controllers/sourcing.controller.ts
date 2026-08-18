import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as referralService from '../services/referralService.js';
import * as sourcingService from '../services/sourcingService.js';
import type { CandidateContext } from '../services/candidateService.js';

function ctx(req: Request): CandidateContext {
  return {
    userId: req.user!.sub,
    role: req.user!.role,
    sectorId: req.user!.sectorId,
    permissions: req.user!.permissions,
  };
}

// ─── REFERRALS ────────────────────────────────────────────────────────────────

export const listReferrals = asyncHandler(async (req: Request, res: Response) => {
  const { referralFiltersSchema } = await import('@agnohire/shared');
  const filters = referralFiltersSchema.parse(req.query);
  const result = await referralService.listReferrals(filters, ctx(req));
  return ok(res, result);
});

export const createReferral = asyncHandler(async (req: Request, res: Response) => {
  const { createReferralSchema } = await import('@agnohire/shared');
  const data = createReferralSchema.parse(req.body);
  const referral = await referralService.createReferral(data, ctx(req), req);
  return ok(res, { referral }, 201);
});

export const updateReferral = asyncHandler(async (req: Request, res: Response) => {
  const { updateReferralSchema } = await import('@agnohire/shared');
  const data = updateReferralSchema.parse(req.body);
  const referral = await referralService.updateReferral(req.params.id, data, ctx(req), req);
  return ok(res, { referral });
});

export const deleteReferral = asyncHandler(async (req: Request, res: Response) => {
  await sourcingService.deleteReferral(req.params.id, req);
  return ok(res, { deleted: true });
});

// ─── SOURCING CHANNELS ────────────────────────────────────────────────────────

export const listChannels = asyncHandler(async (req: Request, res: Response) => {
  const { channelFiltersSchema } = await import('@agnohire/shared');
  const filters = channelFiltersSchema.parse(req.query);
  const channels = await sourcingService.listChannels(filters);
  return ok(res, { channels });
});

export const createChannel = asyncHandler(async (req: Request, res: Response) => {
  const { createSourcingChannelSchema } = await import('@agnohire/shared');
  const data = createSourcingChannelSchema.parse(req.body);
  const channel = await sourcingService.createChannel(data, req);
  return ok(res, { channel }, 201);
});

export const updateChannel = asyncHandler(async (req: Request, res: Response) => {
  const { updateSourcingChannelSchema } = await import('@agnohire/shared');
  const data = updateSourcingChannelSchema.parse(req.body);
  const channel = await sourcingService.updateChannel(req.params.id, data, req);
  return ok(res, { channel });
});

export const syncChannel = asyncHandler(async (req: Request, res: Response) => {
  const result = await sourcingService.syncChannel(req.params.id);
  return ok(res, result);
});

export const deleteChannel = asyncHandler(async (req: Request, res: Response) => {
  await sourcingService.deleteChannel(req.params.id, req);
  return ok(res, { deleted: true });
});
