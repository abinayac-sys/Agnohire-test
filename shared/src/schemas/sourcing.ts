import { z } from 'zod';

const REFERRAL_STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED', 'HIRED'] as const;
const CHANNEL_TYPES = [
  'LINKEDIN',
  'JOB_BOARD',
  'AGENCY',
  'REFERRAL',
  'INTERNAL',
  'CAREER_SITE',
  'OTHER',
] as const;
const EXPERIENCE_LEVELS = ['ENTRY', 'JUNIOR', 'MID', 'SENIOR', 'LEAD', 'PRINCIPAL'] as const;
const CANDIDATE_SOURCES = [
  'DIRECT',
  'REFERRAL',
  'LINKEDIN',
  'JOB_BOARD',
  'AGENCY',
  'CAREER_SITE',
  'OTHER',
] as const;

// ─── REFERRALS ────────────────────────────────────────────────────────────────

export const createReferralSchema = z.object({
  candidateId: z.string().uuid('Select a candidate to refer'),
  jobId: z.string().uuid().optional().nullable(),
  bonusAmount: z.coerce.number().min(0).optional(),
  note: z.string().max(1000).optional(),
});
export type CreateReferralInput = z.infer<typeof createReferralSchema>;

export const updateReferralSchema = z.object({
  status: z.enum(REFERRAL_STATUSES).optional(),
  bonusAmount: z.coerce.number().min(0).optional().nullable(),
  bonusPaid: z.boolean().optional(),
});
export type UpdateReferralInput = z.infer<typeof updateReferralSchema>;

export const referralFiltersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(1000).default(25),
  status: z.enum(REFERRAL_STATUSES).optional(),
  jobId: z.string().uuid().optional(),
  sortBy: z.enum(['createdAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type ReferralFilters = z.infer<typeof referralFiltersSchema>;

// ─── SOURCING CHANNELS ────────────────────────────────────────────────────────

export const createSourcingChannelSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(1000),
  type: z.enum(CHANNEL_TYPES),
  isActive: z.boolean().optional().default(true),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type CreateSourcingChannelInput = z.infer<typeof createSourcingChannelSchema>;

export const updateSourcingChannelSchema = z.object({
  name: z.string().min(2).max(1000).optional(),
  type: z.enum(CHANNEL_TYPES).optional(),
  isActive: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateSourcingChannelInput = z.infer<typeof updateSourcingChannelSchema>;

export const channelFiltersSchema = z.object({
  type: z.enum(CHANNEL_TYPES).optional(),
  isActive: z.coerce.boolean().optional(),
});
export type ChannelFilters = z.infer<typeof channelFiltersSchema>;

// ─── CURATED LISTS ──────────────────────────────────────────────────────────

export const createCuratedListSchema = z.object({
  name: z.string().min(2, 'List name must be at least 2 characters').max(150),
});
export type CreateCuratedListInput = z.infer<typeof createCuratedListSchema>;

export const listItemsSchema = z.object({
  candidateIds: z.array(z.string().uuid()).min(1, 'Select at least one candidate'),
});
export type ListItemsInput = z.infer<typeof listItemsSchema>;

export const assignListSchema = z.object({
  recruiterId: z.string().uuid('Select a recruiter'),
});
export type AssignListInput = z.infer<typeof assignListSchema>;

export const assignJobToListSchema = z.object({
  jobRequisitionId: z.string().uuid('Select a job'),
});
export type AssignJobToListInput = z.infer<typeof assignJobToListSchema>;

// ─── ADVANCED TALENT SEARCH ───────────────────────────────────────────────────

export const candidateSearchSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(1000).default(25),
  q: z.string().optional(),
  // Comma-joined skill lists in the URL; arrays after parse.
  skillsAll: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) =>
      v == null ? [] : Array.isArray(v) ? v : v.split(',').map((s) => s.trim()).filter(Boolean),
    ),
  skillsAny: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) =>
      v == null ? [] : Array.isArray(v) ? v : v.split(',').map((s) => s.trim()).filter(Boolean),
    ),
  experienceLevel: z.enum(EXPERIENCE_LEVELS).optional(),
  source: z.enum(CANDIDATE_SOURCES).optional(),
  sectorId: z.string().uuid().optional(),
  domainId: z.string().uuid().optional(),
  jobRequisitionId: z.string().uuid().optional(),
  hasResume: z.coerce.boolean().optional(),
  unassignedOnly: z.coerce.boolean().optional(),
  minFitScore: z.coerce.number().min(0).max(1000).optional(),
  sortBy: z.enum(['createdAt', 'fullName', 'fitScore']).default('fitScore'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type CandidateSearchFilters = z.infer<typeof candidateSearchSchema>;
