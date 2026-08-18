import { z } from 'zod';

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
const APPLICATION_STATUSES = [
  'APPLIED',
  'SCREENING',
  'ASSESSMENT',
  'INTERVIEW',
  'SCHEDULE',
  'SUBMITTED_TO_HR',
  'HR_VERIFICATION_PENDING',
  'APPROVED',
  'REJECTED',
  'OFFER_SENT',
  'OFFER_ACCEPTED',
  'OFFER_DECLINED',
  'OFFER',
  'ONBOARDING',
  'HIRED',
] as const;

// ─── CANDIDATE CRUD ───────────────────────────────────────────────────────────

const candidateBase = z.object({
  fullName: z.string().min(2, 'Full name must be at least 2 characters').max(150),
  email: z.string().email('A valid email is required'),
  phone: z.string().max(30).optional().or(z.literal('')),
  experienceLevel: z.enum(EXPERIENCE_LEVELS).optional(),
  skills: z.array(z.string().min(1)).default([]),
  linkedinUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  githubUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  location: z.string().max(200).optional().or(z.literal('')),
  currentRole: z.string().max(200).optional().or(z.literal('')),
  source: z.enum(CANDIDATE_SOURCES).optional(),
  sectorId: z.string().uuid().optional().nullable(),
  domainId: z.string().uuid().optional().nullable(),
  jobRequisitionId: z.string().uuid().optional().nullable(),
  consentGiven: z.boolean().optional().default(false),
});

export const createCandidateSchema = candidateBase;
export type CreateCandidateInput = z.infer<typeof createCandidateSchema>;

export const updateCandidateSchema = candidateBase.partial();
export type UpdateCandidateInput = z.infer<typeof updateCandidateSchema>;

// ─── FILTERS ──────────────────────────────────────────────────────────────────

export const candidateFiltersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(1000).default(25),
  search: z.string().optional(),
  sectorId: z.string().uuid().optional(),
  domainId: z.string().uuid().optional(),
  source: z.enum(CANDIDATE_SOURCES).optional(),
  experienceLevel: z.enum(EXPERIENCE_LEVELS).optional(),
  skill: z.string().optional(),
  hasResume: z.coerce.boolean().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  jobRequisitionId: z.string().uuid().optional(),
  sortBy: z.enum(['createdAt', 'fullName', 'fitScore', 'updatedAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type CandidateFilters = z.infer<typeof candidateFiltersSchema>;

// ─── APPLICATIONS ───────────────────────────────────────────────────────────

export const createApplicationSchema = z.object({
  candidateId: z.string().uuid('A candidate is required'),
  jobRequisitionId: z.string().uuid('A job is required'),
  notes: z.string().max(2000).optional(),
});
export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;

export const updateApplicationSchema = z.object({
  status: z.enum(APPLICATION_STATUSES).optional(),
  stage: z.string().max(50).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});
export type UpdateApplicationInput = z.infer<typeof updateApplicationSchema>;

export const applicationFiltersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(1000).default(25),
  jobRequisitionId: z.string().uuid().optional(),
  candidateId: z.string().uuid().optional(),
  status: z.enum(APPLICATION_STATUSES).optional(),
  stage: z.string().optional(),
  search: z.string().optional(),
  minFitScore: z.coerce.number().min(0).max(1000).optional(),
  sortBy: z.enum(['appliedAt', 'fitScore', 'updatedAt']).default('fitScore'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  roundNumber: z.coerce.number().int().positive().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});
export type ApplicationFilters = z.infer<typeof applicationFiltersSchema>;

// ─── RESUMES ──────────────────────────────────────────────────────────────────

/** Attach a resume by public URL (Drive share links are normalized server-side). */
export const importResumeUrlSchema = z.object({
  url: z.string().url('A valid resume URL is required'),
});
export type ImportResumeUrlInput = z.infer<typeof importResumeUrlSchema>;

// ─── SCORING ──────────────────────────────────────────────────────────────────

/** Trigger an AI fit-score for an application (optionally re-score). */
export const scoreApplicationSchema = z.object({
  force: z.boolean().optional().default(false),
});
export type ScoreApplicationInput = z.infer<typeof scoreApplicationSchema>;

// ─── BULK UPLOAD (candidate lists) ────────────────────────────────────────────

export const createCandidateListSchema = z.object({
  name: z.string().min(2, 'List name must be at least 2 characters').max(150),
  jobRequisitionId: z.preprocess((val) => val === '' ? null : val, z.string().uuid().optional().nullable()),
  assignedTo: z.preprocess((val) => val === '' ? null : val, z.string().uuid().optional().nullable()),
});
export type CreateCandidateListInput = z.infer<typeof createCandidateListSchema>;

export const previewCandidateSchema = z.object({
  fullName: z.string(),
  email: z.string().email(),
  phone: z.string().nullable(),
  currentRole: z.string().nullable(),
  location: z.string().nullable(),
  experienceLevel: z.string().nullable(),
  source: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  githubUrl: z.string().nullable(),
  resumeUrl: z.string().nullable(),
  skills: z.array(z.string()),
  
  // Smart Match data
  matchScore: z.number(),
  matchedSkills: z.array(z.string()),
  missingSkills: z.array(z.string()),
  status: z.enum(['IMPORT', 'REJECT', 'ERROR']).default('IMPORT'),
  errorReason: z.string().optional(),
  originalRowIndex: z.number(),
});
export type PreviewCandidate = z.infer<typeof previewCandidateSchema>;

export const previewCandidateListResponseSchema = z.object({
  totalRecords: z.number(),
  matchedCount: z.number(),
  candidates: z.array(previewCandidateSchema),
});
export type PreviewCandidateListResponse = z.infer<typeof previewCandidateListResponseSchema>;

export const smartUploadCandidateListSchema = z.object({
  name: z.string().min(2, 'List name must be at least 2 characters').max(150),
  jobRequisitionId: z.preprocess((val) => val === '' ? null : val, z.string().uuid().optional().nullable()),
  assignedTo: z.preprocess((val) => val === '' ? null : val, z.string().uuid().optional().nullable()),
  candidates: z.array(previewCandidateSchema).min(1, 'No candidates provided for import'),
});
export type SmartUploadCandidateListInput = z.infer<typeof smartUploadCandidateListSchema>;

export const candidateListFiltersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(1000).default(25),
  status: z.enum(['PROCESSING', 'COMPLETED', 'FAILED']).optional(),
  sortBy: z.enum(['createdAt', 'name']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type CandidateListFilters = z.infer<typeof candidateListFiltersSchema>;

// ─── ASSIGNMENT ─────────────────────────────────────────────────────────────

export const assignCandidateSchema = z.object({
  recruiterId: z.string().uuid('Please select a recruiter'),
});
export type AssignCandidateInput = z.infer<typeof assignCandidateSchema>;
