import { z } from 'zod';
import { OFFER_STATUS, ONBOARDING_STATUS, BGV_STATUS } from '../constants/enums.js';

const OFFER_STATUSES = Object.values(OFFER_STATUS) as [string, ...string[]];

/**
 * A file reference: either an absolute http(s) URL (externally hosted) or an
 * internal uploaded-file path from POST /api/files (e.g. "/api/files/<id>/download").
 */
const fileRef = z
  .string()
  .max(2000)
  .refine(
    (v) => /^https?:\/\//.test(v) || v.startsWith('/api/files/'),
    'Must be a valid URL or an uploaded file',
  );

export const offerFiltersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(1000).default(25),
  search: z.string().optional(),
  status: z.enum(OFFER_STATUSES).optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'joiningDate']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type OfferFilters = z.infer<typeof offerFiltersSchema>;

export const createOfferSchema = z.object({
  applicationId: z.string().uuid('An application is required'),
  salaryOffered: z.coerce.number().min(0).optional(),
  joiningDate: z.coerce.date().optional(),
  validUntil: z.coerce.date().optional(),
  offerLetterUrl: fileRef.optional().or(z.literal('')),
  notes: z.string().max(5000).optional().or(z.literal('')),
});
export type CreateOfferInput = z.infer<typeof createOfferSchema>;

/** Only DRAFT offers are editable. */
export const updateOfferSchema = z.object({
  salaryOffered: z.coerce.number().min(0).optional().nullable(),
  joiningDate: z.coerce.date().optional().nullable(),
  validUntil: z.coerce.date().optional().nullable(),
  offerLetterUrl: fileRef.optional().or(z.literal('')),
  notes: z.string().max(5000).optional().or(z.literal('')),
});
export type UpdateOfferInput = z.infer<typeof updateOfferSchema>;

/** Record the candidate's response (staff-side); ACCEPTED may carry a signature. */
export const respondOfferSchema = z.object({
  status: z.enum(['ACCEPTED', 'DECLINED']),
  signature: z.string().max(500).optional(),
});
export type RespondOfferInput = z.infer<typeof respondOfferSchema>;

export const addOfferDocumentSchema = z.object({
  name: z.string().min(1).max(200),
  fileUrl: fileRef,
  type: z.string().min(1).max(50),
  required: z.coerce.boolean().optional().default(false),
  maxSizeInt: z.coerce.number().int().min(1).max(100).optional().default(5),
});
export type AddOfferDocumentInput = z.infer<typeof addOfferDocumentSchema>;

export const createDocumentRequirementSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional().or(z.literal('')),
  required: z.coerce.boolean().optional().default(false),
  type: z.string().min(1).max(100),
  maxSizeInt: z.coerce.number().int().min(1).max(100).optional().default(5),
});
export type CreateDocumentRequirementInput = z.infer<typeof createDocumentRequirementSchema>;

export const uploadDocumentSchema = z.object({
  fileUrl: fileRef,
});
export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;

export const rejectDocumentSchema = z.object({
  reason: z.string().min(1).max(1000),
});
export type RejectDocumentInput = z.infer<typeof rejectDocumentSchema>;

// ─── ONBOARDING ──────────────────────────────────────────────────────────────

const ONBOARDING_STATUSES = Object.values(ONBOARDING_STATUS) as [string, ...string[]];
const BGV_STATUSES = Object.values(BGV_STATUS) as [string, ...string[]];

export const updateOnboardingSchema = z.object({
  status: z.enum(ONBOARDING_STATUSES).optional(),
  bgvStatus: z.enum(BGV_STATUSES).optional(),
  bgvProvider: z.string().max(200).optional().or(z.literal('')),
  bgvReportUrl: fileRef.optional().or(z.literal('')),
});
export type UpdateOnboardingInput = z.infer<typeof updateOnboardingSchema>;

/** Replace the onboarding checklist with the given items (labels). */
export const setChecklistSchema = z.object({
  items: z.array(z.object({
    id: z.string().optional(),
    label: z.string().min(1).max(300),
    done: z.coerce.boolean().optional().default(false),
  })).max(50),
});
export type SetChecklistInput = z.infer<typeof setChecklistSchema>;

/** Toggle a single checklist item by id. */
export const toggleChecklistItemSchema = z.object({
  itemId: z.string().min(1),
  done: z.coerce.boolean(),
});
export type ToggleChecklistItemInput = z.infer<typeof toggleChecklistItemSchema>;
