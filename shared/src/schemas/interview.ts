import { z } from 'zod';
import { CODE_LANGUAGE_VALUES } from '../constants/enums.js';

const QUESTION_TYPES = ['MCQ', 'TEXT', 'CODE'] as const;
const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'] as const;
const DECISIONS = ['PASS', 'FAIL', 'HOLD'] as const;
const VIOLATION_TYPES = [
  'TAB_SWITCH',
  'FULLSCREEN_EXIT',
  'WINDOW_BLUR',
  'COPY_PASTE',
  'CAMERA_BLOCKED',
  'MIC_BLOCKED',
  'NO_FACE',
  'MULTIPLE_FACES',
  'MULTIPLE_VOICES',
  'FREQUENT_MOVEMENT',
  'MOBILE_PHONE',
  'SUSPICIOUS_OBJECT',
  'UNUSUAL_NOISE',
  'FACE_MISMATCH',
  'INTEGRITY_VIOLATION',
] as const;
const SNAPSHOT_REASONS = ['PERIODIC', 'VIOLATION', 'START', 'TERMINATION'] as const;
const INTERVIEW_STATUSES = [
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
  'EVALUATING',
  'EVALUATED',
  'CANCELLED',
  'EXPIRED',
] as const;

// ─── QUESTION BANKS ───────────────────────────────────────────────────────────

export const createQuestionBankSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(150),
  domainId: z.string().uuid().optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  isPublic: z.boolean().optional().default(true),
  sectorId: z.string().uuid().optional().nullable(),
  attachmentId: z.string().uuid().optional().nullable(),
  questions: z.array(z.object({
    text: z.string().min(3),
    type: z.enum(['MCQ', 'TEXT', 'CODE']),
    difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
    rubric: z.string().optional().nullable(),
    tags: z.array(z.string()).default([]),
    orderIndex: z.number().int().default(0),
    aiGenerated: z.boolean().optional().default(false),
    options: z.array(z.object({
      text: z.string(),
      correct: z.boolean(),
    })).optional(),
    testCases: z.array(z.object({
      input: z.string().default(''),
      expectedOutput: z.string(),
      hidden: z.boolean().default(false),
    })).optional(),
  })).optional(),
});
export type CreateQuestionBankInput = z.infer<typeof createQuestionBankSchema>;

export const updateQuestionBankSchema = createQuestionBankSchema.partial();
export type UpdateQuestionBankInput = z.infer<typeof updateQuestionBankSchema>;

export const questionBankFiltersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(1000).default(25),
  search: z.string().optional(),
  domainId: z.string().uuid().optional(),
  sortBy: z.enum(['createdAt', 'name']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type QuestionBankFilters = z.infer<typeof questionBankFiltersSchema>;

// ─── QUESTIONS ────────────────────────────────────────────────────────────────

export const mcqOptionSchema = z.object({
  text: z.string().min(1, 'Option text is required').max(500),
  correct: z.boolean().default(false),
});
// Note: the `McqOption` type lives in types/interview.ts (canonical domain type).

// Note: the `TestCase` type lives in types/interview.ts (canonical domain type).
export const testCaseSchema = z.object({
  input: z.string().max(5000).default(''),
  expectedOutput: z.string().max(5000),
  hidden: z.boolean().default(false),
});

const questionBase = z.object({
  text: z.string().min(3, 'Question text is required').max(5000),
  type: z.preprocess((val) => typeof val === 'string' ? val.toUpperCase() : val, z.enum(QUESTION_TYPES)),
  difficulty: z.preprocess((val) => typeof val === 'string' ? val.toUpperCase() : val, z.enum(DIFFICULTIES)).default('MEDIUM'),
  options: z.array(mcqOptionSchema).optional(),
  rubric: z.string().max(3000).optional().or(z.literal('')),
  testCases: z.array(testCaseSchema).max(20).optional(),
  tags: z.array(z.string().min(1)).default([]),
  orderIndex: z.coerce.number().int().min(0).default(0),
});

export const createQuestionSchema = questionBase.refine(
  (q) =>
    q.type !== 'MCQ' ||
    (Array.isArray(q.options) && q.options.length >= 2 && q.options.some((o) => o.correct)),
  { message: 'MCQ questions need at least 2 options with one marked correct', path: ['options'] },
);
export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;

export const updateQuestionSchema = questionBase.partial();
export type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>;

/** AI generation of questions into a bank (OpenAI-backed). */
export const generateQuestionsSchema = z.object({
  count: z.coerce.number().int().min(1).max(50).default(3),
  type: z.preprocess((val) => typeof val === 'string' ? val.toUpperCase() : val, z.enum(QUESTION_TYPES)),
  difficulty: z.preprocess((val) => typeof val === 'string' ? val.toUpperCase() : val, z.enum(DIFFICULTIES)).default('MEDIUM'),
  /** Optional focus; defaults to the bank's domain when omitted. */
  topic: z.string().max(200).optional().or(z.literal('')),
});
export type GenerateQuestionsInput = z.infer<typeof generateQuestionsSchema>;

// ─── INTERVIEWS ───────────────────────────────────────────────────────────────

export const createInterviewSchema = z.object({
  candidateId: z.string().uuid('Select a candidate'),
  questionBankId: z.string().uuid('Select a question bank'),
  jobRequisitionId: z.string().uuid().optional().nullable(),
  /** Subset of question ids to include; if omitted, all bank questions are used. */
  questionIds: z.array(z.string().uuid()).optional(),
  /**
   * How many questions to draw per candidate from the eligible set (questionIds, or the
   * whole bank if omitted). When smaller than the eligible set, each interview gets a
   * randomized subset that favors questions least-used by other candidates in the same
   * job/round, so candidates interviewing back-to-back don't see the same set in the
   * same order. Omit to use every eligible question (still order-shuffled per candidate).
   */
  questionsPerCandidate: z.coerce.number().int().min(1).optional(),
  durationMin: z.coerce.number().int().min(5).max(300).optional(),
  roundNumber: z.number().int().positive().optional(),
});
export type CreateInterviewInput = z.infer<typeof createInterviewSchema>;

export const interviewFiltersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(1000).default(25),
  candidateId: z.string().uuid().optional(),
  jobRequisitionId: z.string().uuid().optional(),
  status: z.enum(INTERVIEW_STATUSES).optional(),
  decision: z.enum(DECISIONS).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  search: z.string().optional(),
  sortBy: z.enum(['createdAt', 'completedAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type InterviewFilters = z.infer<typeof interviewFiltersSchema>;

export const interviewDecisionSchema = z.object({
  decision: z.enum(DECISIONS),
  recruiterNotes: z.string().max(2000).optional(),
});
export type InterviewDecisionInput = z.infer<typeof interviewDecisionSchema>;

export const submitDecisionSchema = z.object({
  decision: z.enum(DECISIONS),
  interviewerComments: z.string().max(5000).optional(),
  strengths: z.string().max(2000).optional(),
  improvements: z.string().max(2000).optional(),
  recommendedPosition: z.string().max(200).optional(),
  recommendedSalary: z.coerce.number().optional(),
  hiringRecommendation: z.string().max(500).optional(),
});
export type SubmitDecisionInput = z.infer<typeof submitDecisionSchema>;

export const hrApprovalSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT', 'REASSESS']),
  remarks: z.string().max(5000).optional(),
  delayMinutes: z.coerce.number().int().min(0).optional(),
});
export type HrApprovalInput = z.infer<typeof hrApprovalSchema>;

// ─── PUBLIC (token-based, candidate-facing) ───────────────────────────────────

export const submitAnswerSchema = z
  .object({
    questionId: z.string().uuid(),
    answerText: z.string().max(20000).optional(),
    answerCode: z.string().max(50000).optional(),
    selectedOption: z.string().max(500).optional(),
    language: z.enum(CODE_LANGUAGE_VALUES as [string, ...string[]]).optional(),
    timeTaken: z.coerce.number().int().min(0).optional(),
  })
  .refine(
    (a) => a.answerText != null || a.answerCode != null || a.selectedOption != null,
    { message: 'An answer is required' },
  );
export type SubmitAnswerInput = z.infer<typeof submitAnswerSchema>;

export const recordViolationSchema = z.object({
  type: z.enum(VIOLATION_TYPES),
  detail: z.string().max(500).optional(),
});
export type RecordViolationInput = z.infer<typeof recordViolationSchema>;

/** A webcam proctoring snapshot uploaded during a live interview (data URL). */
export const proctorSnapshotSchema = z.object({
  reason: z.enum(SNAPSHOT_REASONS).default('PERIODIC'),
  image: z
    .string()
    .regex(/^data:image\/(png|jpe?g|webp);base64,/, 'Expected an image data URL')
    .max(3_500_000, 'Snapshot too large'),
});
export type ProctorSnapshotInput = z.infer<typeof proctorSnapshotSchema>;

/** The candidate's microphone recording, uploaded once at submit time (data URL).
 *  Used for post-hoc voice analysis (detecting a second speaker). Audio-only,
 *  low-bitrate Opus/WebM so a full interview stays under the 5 MB JSON body cap;
 *  the client skips the upload if the blob somehow exceeds this. */
export const interviewRecordingSchema = z.object({
  audio: z
    .string()
    .regex(/^data:audio\/(webm|ogg|mp4|mpeg|wav)(;[^,]*)?base64,/, 'Expected an audio data URL')
    .max(4_500_000, 'Recording too large'),
});
export type InterviewRecordingInput = z.infer<typeof interviewRecordingSchema>;

/** Bulk-send finalized interview result emails to a set of evaluated interviews. */
export const sendBulkResultsSchema = z.object({
  interviewIds: z.array(z.string().uuid()).min(1, 'Select at least one candidate').max(500),
  /** Re-send even to candidates who already received a result email. */
  force: z.boolean().optional().default(false),
});
export type SendBulkResultsInput = z.infer<typeof sendBulkResultsSchema>;

export const biometricEnrollSchema = z.object({
  image: z.string().regex(/^data:image\/(png|jpe?g|webp);base64,/, 'Expected an image data URL'),
  faceSignature: z.any().optional(),
});
export type BiometricEnrollInput = z.infer<typeof biometricEnrollSchema>;

export const biometricVerifySchema = z.object({
  image: z.string().regex(/^data:image\/(png|jpe?g|webp);base64,/, 'Expected an image data URL'),
  faceSignature: z.any().optional(),
  matchScore: z.number(),
  isMatch: z.boolean(),
  noFace: z.boolean().default(false),
  multipleFaces: z.boolean().default(false),
  isLive: z.boolean().optional().default(true),
  livenessScore: z.number().optional(),
  numFaces: z.number().optional().default(1),
});
export type BiometricVerifyInput = z.infer<typeof biometricVerifySchema>;

