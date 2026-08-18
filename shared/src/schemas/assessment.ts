import { z } from 'zod';
import { CODE_LANGUAGE_VALUES } from '../constants/enums.js';

const ASSESSMENT_STATUSES = [
  'PENDING',
  'IN_PROGRESS',
  'SUBMITTED',
  'EVALUATING',
  'EVALUATED',
  'EXPIRED',
  'CANCELLED',
] as const;

// ─── ASSESSMENT TEMPLATE ──────────────────────────────────────────────────────

export const createAssessmentSchema = z.object({
  title: z.string().min(2, 'Title must be at least 2 characters').max(150),
  description: z.string().max(2000).optional().or(z.literal('')),
  domainId: z.string().uuid().optional().nullable(),
  /** Optional job requisition this assessment screens for. */
  jobRequisitionId: z.string().uuid().optional().nullable(),
  passingScore: z.coerce.number().int().min(0).max(1000).default(60),
  durationMin: z.coerce.number().int().min(1).max(480).optional().nullable(),
  /** Question ids (from any question bank) that make up the assessment. */
  questionIds: z.array(z.string().uuid()).default([]),
});
export type CreateAssessmentInput = z.infer<typeof createAssessmentSchema>;

export const updateAssessmentSchema = createAssessmentSchema.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdateAssessmentInput = z.infer<typeof updateAssessmentSchema>;

export const assessmentFiltersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(1000).default(25),
  search: z.string().optional(),
  domainId: z.string().uuid().optional(),
  isActive: z.coerce.boolean().optional(),
  sortBy: z.enum(['createdAt', 'title']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type AssessmentFilters = z.infer<typeof assessmentFiltersSchema>;

// ─── ASSIGNMENT ───────────────────────────────────────────────────────────────

export const assignAssessmentSchema = z.object({
  candidateIds: z.array(z.string().uuid()).min(1, 'Select at least one candidate'),
});
export type AssignAssessmentInput = z.infer<typeof assignAssessmentSchema>;

export const assignmentFiltersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(1000).default(25),
  assessmentId: z.string().uuid().optional(),
  candidateId: z.string().uuid().optional(),
  /** Filter by the job requisition the assignment's assessment screens for. */
  jobRequisitionId: z.string().uuid().optional(),
  status: z.enum(ASSESSMENT_STATUSES).optional(),
  /** Filter by graded outcome (true=passed, false=failed). */
  passed: z.coerce.boolean().optional(),
  search: z.string().optional(),
  sortBy: z.enum(['createdAt', 'submittedAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type AssignmentFilters = z.infer<typeof assignmentFiltersSchema>;

// ─── PUBLIC (token-based, candidate-facing) ───────────────────────────────────

export const sendAssessmentResultSchema = z.object({
  /** Override the automatically generated next-steps message. */
  nextSteps: z.string().max(1000).optional().or(z.literal('')),
  /** Force re-send even if already sent (requires ASSESSMENT_MANAGE). */
  force: z.boolean().optional(),
});
export type SendAssessmentResultInput = z.infer<typeof sendAssessmentResultSchema>;

export const bulkSendAssessmentResultSchema = z.object({
  assignmentIds: z.array(z.string().uuid()).min(1, 'Select at least one assignment'),
  force: z.boolean().optional(),
});
export type BulkSendAssessmentResultInput = z.infer<typeof bulkSendAssessmentResultSchema>;

export const submitAssessmentAnswerSchema = z
  .object({
    questionId: z.string().uuid(),
    answerText: z.string().max(20000).optional(),
    answerCode: z.string().max(50000).optional(),
    selectedOption: z.string().max(500).optional(),
    language: z.enum(CODE_LANGUAGE_VALUES as [string, ...string[]]).optional(),
  })
  .refine((a) => a.answerText != null || a.answerCode != null || a.selectedOption != null, {
    message: 'An answer is required',
  });
export type SubmitAssessmentAnswerInput = z.infer<typeof submitAssessmentAnswerSchema>;
