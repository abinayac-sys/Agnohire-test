import { z } from 'zod';

/**
 * POST /ai/run — the AI agent entry point. The client re-sends the whole
 * conversation on every turn with no windowing, so this is the server-side
 * backstop: caps on instruction size, history length/size, and workflow
 * state size. Applied in ai.controller.ts, which also truncates `history`
 * to the last N turns server-side regardless of what the client sends.
 */
export const aiChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(8000),
});

export const runAISchema = z.object({
  instruction: z.string().trim().min(1).max(4000),
  lastWorkflowState: z.record(z.string(), z.unknown()).nullish(),
  history: z.array(aiChatMessageSchema).max(30).optional().default([]),
  /** Present when confirming a previously gated destructive tool call. */
  confirmationToken: z.string().max(200).optional(),
});
export type RunAIInput = z.infer<typeof runAISchema>;

/** Number of most-recent history turns kept after server-side truncation. */
export const AI_HISTORY_MAX_TURNS = 20;
