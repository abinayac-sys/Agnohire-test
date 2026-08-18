import type { Request, Response } from 'express';
import { runAISchema, AI_HISTORY_MAX_TURNS } from '@agnohire/shared';
import { AIOrchestratorService } from '../services/aiOrchestratorService.js';
import { ok } from '../utils/response.js';

export async function runAI(req: Request, res: Response): Promise<Response> {
  // The client re-sends the whole conversation on every turn with no
  // windowing of its own, so a long-running chat eventually exceeds
  // runAISchema's history.max(30) — that bound must be enforced BEFORE
  // schema validation (by truncating here), not after: validating first and
  // truncating second (the previous order) meant any conversation past 30
  // turns hard-rejected every subsequent request with a 400, forever, since
  // the truncation code path was never reached.
  if (Array.isArray(req.body?.history) && req.body.history.length > AI_HISTORY_MAX_TURNS) {
    req.body.history = req.body.history.slice(-AI_HISTORY_MAX_TURNS);
  }

  const { instruction, lastWorkflowState, history, confirmationToken } = runAISchema.parse(req.body);

  const ctx = {
    userId: req.user!.sub,
    role: req.user!.role,
    sectorId: req.user!.sectorId ?? null,
    tenantId: req.user!.tenantId ?? null,
    organizationId: req.user!.organizationId ?? null,
    workspaceId: req.user!.workspaceId ?? null,
    workspaceRole: req.user!.workspaceRole ?? null,
    permissions: (req.user as any).permissions || [],
  };

  const result = await AIOrchestratorService.run(instruction, ctx, req, lastWorkflowState, history, confirmationToken);
  return ok(res, result);
}
