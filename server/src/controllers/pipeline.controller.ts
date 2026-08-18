import type { Request, Response } from 'express';
import { ok } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as pipelineService from '../services/pipelineService.js';
import type { PipelineContext } from '../services/pipelineService.js';

function ctx(req: Request): PipelineContext {
  return {
    userId: req.user!.sub,
    role: req.user!.role,
    sectorId: req.user!.sectorId,
    permissions: req.user!.permissions,
  };
}

export const getBoard = asyncHandler(async (req: Request, res: Response) => {
  const { boardFiltersSchema } = await import('@agnohire/shared');
  const filters = boardFiltersSchema.parse(req.query);
  return ok(res, { board: await pipelineService.getBoard(filters, ctx(req)) });
});

export const moveApplication = asyncHandler(async (req: Request, res: Response) => {
  const { moveApplicationSchema } = await import('@agnohire/shared');
  const data = moveApplicationSchema.parse(req.body);
  return ok(res, { card: await pipelineService.moveApplication(req.params.id, data, ctx(req), req) });
});

export const listNotes = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, { notes: await pipelineService.listNotes(req.params.id, ctx(req)) });
});

export const addNote = asyncHandler(async (req: Request, res: Response) => {
  const { createPipelineNoteSchema } = await import('@agnohire/shared');
  const data = createPipelineNoteSchema.parse(req.body);
  return ok(res, { note: await pipelineService.addNote(req.params.id, data, ctx(req), req) }, 201);
});

export const deleteNote = asyncHandler(async (req: Request, res: Response) => {
  return ok(res, { success: await pipelineService.deleteNote(req.params.noteId, ctx(req), req) });
});
