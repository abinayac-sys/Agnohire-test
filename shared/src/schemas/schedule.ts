import { z } from 'zod';

const SCHEDULE_TYPES = ['LIVE', 'PANEL'] as const;
const INTERVIEW_STATUSES = [
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
  'EVALUATING',
  'EVALUATED',
  'CANCELLED',
  'EXPIRED',
] as const;

// ─── CREATE ───────────────────────────────────────────────────────────────────

export const createScheduleSchema = z.object({
  candidateId: z.string().uuid('Select a candidate'),
  interviewerIds: z.array(z.string().uuid()).min(1, 'Add at least one interviewer'),
  /** ISO 8601 with offset, e.g. 2026-06-10T09:00:00.000Z */
  scheduledDate: z.string().datetime({ offset: true }),
  duration: z.coerce.number().int().min(15).max(480).default(60),
  timezone: z.string().min(1).max(64).default('UTC'),
  type: z.enum(SCHEDULE_TYPES).default('LIVE'),
  instructions: z.string().max(2000).optional().or(z.literal('')),
  meetingProvider: z.enum(['GOOGLE_MEET', 'MS_TEAMS', 'ZOOM', 'CUSTOM']).default('GOOGLE_MEET'),
  meetingLink: z.string().url('Enter a valid URL').max(500).optional().or(z.literal('')),
  jobRequisitionId: z.string().uuid('Select a Job Requisition'),
  roundNumber: z.number().int().positive().optional(),
});
export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;

// ─── RESCHEDULE / UPDATE ──────────────────────────────────────────────────────

export const updateScheduleSchema = z.object({
  scheduledDate: z.string().datetime({ offset: true }).optional(),
  duration: z.coerce.number().int().min(15).max(480).optional(),
  interviewerIds: z.array(z.string().uuid()).min(1).optional(),
  timezone: z.string().min(1).max(64).optional(),
  instructions: z.string().max(2000).optional().or(z.literal('')),
  meetingProvider: z.enum(['GOOGLE_MEET', 'MS_TEAMS', 'ZOOM', 'CUSTOM']).optional(),
  meetingLink: z.string().url('Enter a valid URL').max(500).optional().or(z.literal('')),
});
export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;

// ─── FILTERS ──────────────────────────────────────────────────────────────────

export const scheduleFiltersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(10000).default(25),
  candidateId: z.string().uuid().optional(),
  jobRequisitionId: z.string().uuid().optional(),
  status: z.enum(INTERVIEW_STATUSES).optional(),
  decision: z.enum(['PASS', 'FAIL', 'HOLD']).optional(),
  /** Inclusive lower/upper bounds on scheduledDate (ISO or plain date). */
  from: z.string().optional(),
  to: z.string().optional(),
  search: z.string().optional(),
  roundNumber: z.number().int().positive().optional(),
  sortBy: z.enum(['scheduledDate', 'createdAt']).default('scheduledDate'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});
export type ScheduleFilters = z.infer<typeof scheduleFiltersSchema>;

// ─── AVAILABILITY ─────────────────────────────────────────────────────────────

/** GET query: interviewerIds is a comma-separated list of user ids. */
export const availabilityQuerySchema = z.object({
  interviewerIds: z
    .string()
    .min(1, 'Provide at least one interviewer')
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  duration: z.coerce.number().int().min(15).max(480).default(60),
  /** When rescheduling, the interview being edited is excluded from conflicts. */
  excludeInterviewId: z.string().uuid().optional(),
  /** IANA timezone the working-hours/slots are interpreted in (default UTC). */
  timeZone: z.string().max(64).optional().default('UTC'),
});
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;
