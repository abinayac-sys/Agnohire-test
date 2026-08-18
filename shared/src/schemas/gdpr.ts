import { z } from 'zod';
import { GDPR_REQUEST_TYPE } from '../constants/enums.js';

const gdprType = z.enum([
  GDPR_REQUEST_TYPE.ACCESS,
  GDPR_REQUEST_TYPE.DELETION,
  GDPR_REQUEST_TYPE.PORTABILITY,
]);

/** Raise a GDPR request against a candidate (subject access / portability / erasure). */
export const createGdprRequestSchema = z.object({
  candidateId: z.string().uuid(),
  type: gdprType,
  note: z.string().trim().max(1000).optional(),
});
export type CreateGdprRequestInput = z.infer<typeof createGdprRequestSchema>;

export const gdprFiltersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(1000).default(25),
  status: z.enum(['PENDING', 'COMPLETED', 'REJECTED']).optional(),
  type: gdprType.optional(),
  search: z.string().trim().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type GdprFilters = z.infer<typeof gdprFiltersSchema>;

/** Process a pending request: fulfil it (export/erase) or reject it. */
export const processGdprRequestSchema = z.object({
  action: z.enum(['fulfil', 'reject']),
  note: z.string().trim().max(1000).optional(),
});
export type ProcessGdprRequestInput = z.infer<typeof processGdprRequestSchema>;

/** Record/withdraw a candidate's processing consent. */
export const setConsentSchema = z.object({
  candidateId: z.string().uuid(),
  given: z.boolean(),
});
export type SetConsentInput = z.infer<typeof setConsentSchema>;

/** Create or update a data-retention policy for an entity type. */
export const retentionPolicySchema = z.object({
  entityType: z.string().trim().min(1).max(60),
  retentionDays: z.coerce.number().int().min(1).max(36500),
  autoDeleteEnabled: z.coerce.boolean().default(false),
});
export type RetentionPolicyInput = z.infer<typeof retentionPolicySchema>;
