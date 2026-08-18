/** Status enums used across the platform. Stored as strings in the DB. */

/**
 * Languages a candidate can pick for a CODE question. The `value` is stored on
 * the answer (CandidateAnswer.language / AssessmentAnswer.language) and fed to
 * the AI scorer so it judges syntax in the right language. `mode` maps to the
 * editor's syntax hint.
 */
export const CODE_LANGUAGES = [
  { value: 'python', label: 'Python' },
  { value: 'java', label: 'Java' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'cpp', label: 'C++' },
  { value: 'c', label: 'C' },
  { value: 'csharp', label: 'C#' },
  { value: 'go', label: 'Go' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'sql', label: 'SQL' },
] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number]['value'];
export const DEFAULT_CODE_LANGUAGE: CodeLanguage = 'python';
/** Set of valid language values, for schema validation. */
export const CODE_LANGUAGE_VALUES = CODE_LANGUAGES.map((l) => l.value) as readonly CodeLanguage[];

export const JOB_STATUS = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
  REJECTED: 'REJECTED',
} as const;
export type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS];

export const WORK_MODE = {
  ONSITE: 'ONSITE',
  REMOTE: 'REMOTE',
  HYBRID: 'HYBRID',
} as const;
export type WorkMode = (typeof WORK_MODE)[keyof typeof WORK_MODE];

export const APPLICATION_STATUS = {
  APPLIED: 'APPLIED',
  SCREENING: 'SCREENING',
  ASSESSMENT: 'ASSESSMENT',
  INTERVIEW: 'INTERVIEW',
  SCHEDULE: 'SCHEDULE',
  SUBMITTED_TO_HR: 'SUBMITTED_TO_HR',
  OFFER: 'OFFER',
  ONBOARDING: 'ONBOARDING',
  HIRED: 'HIRED',
  REJECTED: 'REJECTED',
} as const;
export type ApplicationStatus = (typeof APPLICATION_STATUS)[keyof typeof APPLICATION_STATUS];

/** Default ATS pipeline stages (Admin Console configurable). */
export const PIPELINE_STAGES = [
  'SOURCED',
  'APPLIED',
  'SCREENING',
  'INTERVIEW',
  'OFFER',
  'HIRED',
  'REJECTED',
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const EXPERIENCE_LEVEL = {
  ENTRY: 'ENTRY',
  JUNIOR: 'JUNIOR',
  MID: 'MID',
  SENIOR: 'SENIOR',
  LEAD: 'LEAD',
  PRINCIPAL: 'PRINCIPAL',
} as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVEL)[keyof typeof EXPERIENCE_LEVEL];

export const CANDIDATE_SOURCE = {
  DIRECT: 'DIRECT',
  REFERRAL: 'REFERRAL',
  LINKEDIN: 'LINKEDIN',
  JOB_BOARD: 'JOB_BOARD',
  AGENCY: 'AGENCY',
  CAREER_SITE: 'CAREER_SITE',
  OTHER: 'OTHER',
} as const;
export type CandidateSource = (typeof CANDIDATE_SOURCE)[keyof typeof CANDIDATE_SOURCE];

export const PARSE_STATUS = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;
export type ParseStatus = (typeof PARSE_STATUS)[keyof typeof PARSE_STATUS];

export const REFERRAL_STATUS = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  HIRED: 'HIRED',
} as const;
export type ReferralStatus = (typeof REFERRAL_STATUS)[keyof typeof REFERRAL_STATUS];

export const SOURCING_CHANNEL_TYPE = {
  LINKEDIN: 'LINKEDIN',
  JOB_BOARD: 'JOB_BOARD',
  AGENCY: 'AGENCY',
  REFERRAL: 'REFERRAL',
  INTERNAL: 'INTERNAL',
  CAREER_SITE: 'CAREER_SITE',
  OTHER: 'OTHER',
} as const;
export type SourcingChannelType =
  (typeof SOURCING_CHANNEL_TYPE)[keyof typeof SOURCING_CHANNEL_TYPE];

export const FIT_RECOMMENDATION = {
  STRONG_MATCH: 'STRONG_MATCH',
  MATCH: 'MATCH',
  WEAK_MATCH: 'WEAK_MATCH',
  NO_MATCH: 'NO_MATCH',
} as const;
export type FitRecommendation = (typeof FIT_RECOMMENDATION)[keyof typeof FIT_RECOMMENDATION];

export const INTERVIEW_STATUS = {
  SCHEDULED: 'SCHEDULED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  EVALUATING: 'EVALUATING',
  EVALUATED: 'EVALUATED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
} as const;
export type InterviewStatus = (typeof INTERVIEW_STATUS)[keyof typeof INTERVIEW_STATUS];

export const INTERVIEW_TYPE = {
  AI: 'AI',
  LIVE: 'LIVE',
  PANEL: 'PANEL',
} as const;
export type InterviewType = (typeof INTERVIEW_TYPE)[keyof typeof INTERVIEW_TYPE];

export const DECISION = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  HOLD: 'HOLD',
} as const;
export type Decision = (typeof DECISION)[keyof typeof DECISION];

export const VIOLATION_TYPE = {
  TAB_SWITCH: 'TAB_SWITCH',
  FULLSCREEN_EXIT: 'FULLSCREEN_EXIT',
  WINDOW_BLUR: 'WINDOW_BLUR',
  COPY_PASTE: 'COPY_PASTE',
  CAMERA_BLOCKED: 'CAMERA_BLOCKED',
  MIC_BLOCKED: 'MIC_BLOCKED',
  NO_FACE: 'NO_FACE',
  MULTIPLE_FACES: 'MULTIPLE_FACES',
  MULTIPLE_VOICES: 'MULTIPLE_VOICES',
  FREQUENT_MOVEMENT: 'FREQUENT_MOVEMENT',
  MOBILE_PHONE: 'MOBILE_PHONE',
  SUSPICIOUS_OBJECT: 'SUSPICIOUS_OBJECT',
  UNUSUAL_NOISE: 'UNUSUAL_NOISE',
  FACE_MISMATCH: 'FACE_MISMATCH',
  INTEGRITY_VIOLATION: 'INTEGRITY_VIOLATION',
} as const;
export type ViolationType = (typeof VIOLATION_TYPE)[keyof typeof VIOLATION_TYPE];

export const PANEL_MEMBER_STATUS = {
  INVITED: 'INVITED',
  ACCEPTED: 'ACCEPTED',
  DECLINED: 'DECLINED',
} as const;
export type PanelMemberStatus = (typeof PANEL_MEMBER_STATUS)[keyof typeof PANEL_MEMBER_STATUS];

export const QUESTION_TYPE = {
  MCQ: 'MCQ',
  TEXT: 'TEXT',
  CODE: 'CODE',
} as const;
export type QuestionType = (typeof QUESTION_TYPE)[keyof typeof QUESTION_TYPE];

export const DIFFICULTY = {
  EASY: 'EASY',
  MEDIUM: 'MEDIUM',
  HARD: 'HARD',
} as const;
export type Difficulty = (typeof DIFFICULTY)[keyof typeof DIFFICULTY];

/** Points a question is worth, derived from difficulty (Question has no maxScore column). */
export const DIFFICULTY_POINTS: Record<Difficulty, number> = {
  EASY: 5,
  MEDIUM: 10,
  HARD: 15,
};

export const ASSESSMENT_STATUS = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  SUBMITTED: 'SUBMITTED',
  EVALUATING: 'EVALUATING',
  EVALUATED: 'EVALUATED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;
export type AssessmentStatus = (typeof ASSESSMENT_STATUS)[keyof typeof ASSESSMENT_STATUS];

export const OFFER_STATUS = {
  DRAFT: 'DRAFT',
  TENTATIVE: 'TENTATIVE',
  DOCUMENTS_PENDING: 'DOCUMENTS_PENDING',
  DOCUMENTS_SUBMITTED: 'DOCUMENTS_SUBMITTED',
  DOCUMENTS_VERIFIED: 'DOCUMENTS_VERIFIED',
  SENT: 'SENT',
  ACCEPTED: 'ACCEPTED',
  DECLINED: 'DECLINED',
  EXPIRED: 'EXPIRED',
} as const;
export type OfferStatus = (typeof OFFER_STATUS)[keyof typeof OFFER_STATUS];

export const ONBOARDING_STATUS = {
  NOT_STARTED: 'NOT_STARTED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
} as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUS)[keyof typeof ONBOARDING_STATUS];

/** Background-verification status (Onboarding.bgvStatus, a free-text column). */
export const BGV_STATUS = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  CLEARED: 'CLEARED',
  FLAGGED: 'FLAGGED',
} as const;
export type BgvStatus = (typeof BGV_STATUS)[keyof typeof BGV_STATUS];

export const RECOMMENDATION = {
  STRONG_HIRE: 'STRONG_HIRE',
  HIRE: 'HIRE',
  NO_HIRE: 'NO_HIRE',
  STRONG_NO_HIRE: 'STRONG_NO_HIRE',
} as const;
export type Recommendation = (typeof RECOMMENDATION)[keyof typeof RECOMMENDATION];

export const GDPR_REQUEST_TYPE = {
  ACCESS: 'ACCESS',
  DELETION: 'DELETION',
  PORTABILITY: 'PORTABILITY',
} as const;
export type GdprRequestType = (typeof GDPR_REQUEST_TYPE)[keyof typeof GDPR_REQUEST_TYPE];

export const CONFIG_CATEGORY = {
  GENERAL: 'GENERAL',
  SECURITY: 'SECURITY',
  EMAIL: 'EMAIL',
  AI: 'AI',
  INTERVIEW: 'INTERVIEW',
  ASSESSMENT: 'ASSESSMENT',
  PIPELINE: 'PIPELINE',
  RATE_LIMIT: 'RATE_LIMIT',
  THEME: 'THEME',
  INTEGRATIONS: 'INTEGRATIONS',
  // Email template branding (logo/colors/footer/social links) — edited from
  // the Email Customizer's Branding & Themes tab, not the generic System
  // Config list. Kept out of CONFIG_CATEGORY.EMAIL so the two surfaces don't
  // show duplicate controls for the same settings.
  EMAIL_BRANDING: 'EMAIL_BRANDING',
  // Public careers page display toggles (header banner, salary visibility).
  CAREERS: 'CAREERS',
  // Subscription/trial defaults.
  BILLING: 'BILLING',
} as const;
export type ConfigCategory = (typeof CONFIG_CATEGORY)[keyof typeof CONFIG_CATEGORY];

export const CONFIG_DATA_TYPE = {
  STRING: 'STRING',
  NUMBER: 'NUMBER',
  BOOLEAN: 'BOOLEAN',
  JSON: 'JSON',
  /** Value is an uploaded Attachment id; rendered as an image uploader + preview. */
  IMAGE: 'IMAGE',
} as const;
export type ConfigDataType = (typeof CONFIG_DATA_TYPE)[keyof typeof CONFIG_DATA_TYPE];

export const DOCUMENT_STATUS = {
  PENDING: 'PENDING',
  UPLOADED: 'UPLOADED',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
} as const;
export type DocumentStatus = (typeof DOCUMENT_STATUS)[keyof typeof DOCUMENT_STATUS];
