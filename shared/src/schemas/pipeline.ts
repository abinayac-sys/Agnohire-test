import { z } from 'zod';

/** The Kanban board is scoped to a single job requisition. */
export const boardFiltersSchema = z.object({
  jobRequisitionId: z.string().uuid('A job is required'),
  search: z.string().optional(),
});
export type BoardFilters = z.infer<typeof boardFiltersSchema>;

export const moveApplicationSchema = z.object({
  toStage: z.string().min(1, 'Stage is required'),
  rejectionReason: z.string().optional(),
  rejectedRound: z.string().optional(),
});
export type MoveApplicationInput = z.infer<typeof moveApplicationSchema>;

export const createPipelineNoteSchema = z.object({
  content: z.string().min(1, 'A note is required').max(5000),
  /** Private notes are visible only to their author. */
  isPrivate: z.coerce.boolean().optional().default(false),
});
export type CreatePipelineNoteInput = z.infer<typeof createPipelineNoteSchema>;
