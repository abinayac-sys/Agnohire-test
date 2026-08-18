import { z } from 'zod';

const INTERVIEW_TYPES = ['AI', 'LIVE', 'PANEL'] as const;
const RECOMMENDATIONS = ['STRONG_HIRE', 'HIRE', 'NO_HIRE', 'STRONG_NO_HIRE'] as const;

export const reviewFiltersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(1000).default(25),
  search: z.string().optional(),
  type: z.enum(INTERVIEW_TYPES).optional(),
  /** Only those still awaiting a reviewer recommendation. */
  pendingOnly: z.coerce.boolean().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  sortBy: z.enum(['completedAt', 'createdAt']).default('completedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  jobRequisitionId: z.string().uuid().optional(),
});
export type ReviewFilters = z.infer<typeof reviewFiltersSchema>;

/** Attach a recording URL and/or paste a transcript. At least one must be present. */
export const setMediaSchema = z
  .object({
    recordingUrl: z
      .string()
      .max(2000)
      .optional()
      .refine(
        (val) => !val || val.startsWith('/') || /^(https?:\/\/)/.test(val),
        { message: 'Must be a valid URL or internal path' }
      )
      .or(z.literal('')),
    transcript: z.string().max(200_000).optional(),
  })
  .refine((d) => (d.recordingUrl && d.recordingUrl !== '') || (d.transcript && d.transcript.trim() !== ''), {
    message: 'Provide a recording URL or transcript text',
  });
export type SetMediaInput = z.infer<typeof setMediaSchema>;

export const submitReviewSchema = z.object({
  recommendation: z.enum(RECOMMENDATIONS),
  reviewerNotes: z.string().max(5000).optional().or(z.literal('')),
  finalScore: z.coerce.number().min(0).max(1000).optional(),
});
export type SubmitReviewInput = z.infer<typeof submitReviewSchema>;
