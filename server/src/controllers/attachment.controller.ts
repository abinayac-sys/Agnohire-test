import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';
import * as attachmentService from '../services/attachmentService.js';

export const upload = asyncHandler(async (req: Request, res: Response) => {
  const meta = await attachmentService.createAttachment(req.file, req.user?.sub, req);
  return ok(res, { attachment: meta }, 201);
});

export const download = asyncHandler(async (req: Request, res: Response) => {
  const requester = req.user ? {
    userId: req.user.sub,
    role: req.user.role,
    sectorId: req.user.sectorId,
  } : undefined;

  const { fileName, mimeType, buffer } = await attachmentService.getAttachmentFile(
    req.params.id,
    requester,
    req.publicOfferToken
  );
  res.setHeader('Content-Type', mimeType);
  const disposition = req.query.download === 'true' ? 'attachment' : 'inline';
  res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(fileName)}"`);
  res.send(buffer);
});
