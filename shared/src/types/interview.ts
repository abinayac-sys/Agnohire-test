import type {
  Difficulty,
  QuestionType,
  InterviewStatus,
  InterviewType,
  Decision,
  ViolationType,
} from '../constants/enums.js';

export interface McqOption {
  text: string;
  correct: boolean;
}
/** MCQ option as sent to the candidate — never reveals which is correct. */
export interface McqOptionPublic {
  text: string;
}

/** CODE questions only: a sample/hidden test case checked against stdout via Piston. */
export interface TestCase {
  input: string;
  expectedOutput: string;
  hidden: boolean;
}

export interface QuestionItem {
  id: string;
  text: string;
  type: QuestionType;
  difficulty: Difficulty;
  options: McqOption[] | null;
  rubric: string | null;
  testCases: TestCase[] | null;
  tags: string[];
  maxScore: number;
  orderIndex: number;
  aiGenerated: boolean;
}

export interface QuestionBankListItem {
  id: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  createdAt: string;
  domain: { id: string; name: string };
  attachment?: { id: string; fileName: string; mimeType: string } | null;
  _count: { questions: number };
}

export interface QuestionBankDetail extends QuestionBankListItem {
  questions: QuestionItem[];
}

export interface ViolationEntry {
  type: ViolationType;
  at: string;
  detail?: string;
}

export interface ProctorShotMeta {
  id: string;
  reason: 'PERIODIC' | 'VIOLATION' | 'START' | 'TERMINATION';
  note: string | null;
  capturedAt: string;
}

export interface CandidateAnswerItem {
  id: string;
  questionId: string;
  answerText: string | null;
  answerCode: string | null;
  selectedOption: string | null;
  /** Programming language chosen for a CODE answer (e.g. 'python', 'java'). */
  language: string | null;
  isCorrect: boolean | null;
  aiScore: number | null;
  maxScore: number | null;
  aiEvaluation: string | null;
  timeTaken: number | null;
}

export interface InterviewResultItem {
  totalScore: number | null;
  maxScore: number | null;
  percentageScore: number | null;
  aiScore: number | null;
  finalScore: number | null;
  decision: Decision | null;
  aiDecision: string | null;
  aiReasoning: string | null;
  aiSummary: string | null;
  strengths: string | null;
  improvements: string | null;
  recruiterNotes: string | null;
  decidedAt: string | null;
  technicalScore?: number | null;
  problemSolvingScore?: number | null;
  communicationScore?: number | null;
  culturalFitScore?: number | null;
  skillMatchScore?: number | null;
  sentimentResult?: any;
  keywordAnalysis?: any;
  transcriptSummary?: string | null;
}

export interface InterviewListItem {
  id: string;
  status: InterviewStatus;
  type: InterviewType;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  duration: number | null;
  jobRequisition?: { id: string; title: string } | null;
  candidate: { id: string; fullName: string; email: string };
  questionBank: { id: string; name: string } | null;
  result: { percentageScore: number | null; decision: Decision | null; aiDecision: string | null } | null;
  _count: { questions: number };
}

export interface InterviewDetail extends InterviewListItem {
  accessToken: string | null;
  duration: number | null;
  transcript: string | null;
  violations: ViolationEntry[] | null;
  terminatedReason: string | null;
  /** Internal download URL for the candidate's interview audio recording. */
  recordingUrl: string | null;
  proctorShots: ProctorShotMeta[];
  questions: QuestionItem[];
  answers: CandidateAnswerItem[];
  result: InterviewResultItemFull | null;
}
/** Detail view exposes the full result (list view only carries a summary). */
export type InterviewResultItemFull = InterviewResultItem;

// ─── PUBLIC (candidate-facing, token route) ───────────────────────────────────

export interface PublicQuestion {
  id: string;
  text: string;
  type: QuestionType;
  difficulty: Difficulty;
  options: McqOptionPublic[] | null;
  /** CODE questions only: visible (non-hidden) test cases; hidden ones are never sent to the candidate. */
  sampleTestCases: Pick<TestCase, 'input' | 'expectedOutput'>[] | null;
  maxScore: number;
  orderIndex: number;
}

export interface PublicInterview {
  id: string;
  status: InterviewStatus;
  candidateName: string;
  candidateEmail: string;
  candidateId?: string;
  durationMin: number | null;
  startedAt: string | null;
  questions: PublicQuestion[];
  antiCheat: {
    /** Total cheating warnings allowed before the interview auto-ends. */
    maxWarnings: number;
    proctoringEnabled: boolean;
    cameraRequired: boolean;
    micRequired: boolean;
    snapshotIntervalSec: number;
    screenShareRequired: boolean;
    biometricSimilarityThreshold?: number;
  };
  /** Existing autosaved answers, so a refreshed candidate resumes in place. */
  savedAnswers: {
    questionId: string;
    answerText: string | null;
    answerCode: string | null;
    selectedOption: string | null;
    language: string | null;
  }[];
  biometricEnrollment?: {
    faceSignature: any;
    enrollmentImage: string;
  } | null;
  faceSignature?: any;
  violations?: any[];
}

/** Post-hoc microphone analysis result — surfaced in the admin evaluation view. */
export interface VoiceAnalysisResult {
  /** How many distinct human voices the analyzer heard. */
  speakerCount: number;
  /** True when a voice other than the candidate is detected speaking. */
  otherVoiceDetected: boolean;
  /** Short human-readable explanation of what was heard. */
  summary: string;
  analyzedAt: string;
}

/** A candidate eligible for a bulk result email (finalized PASS/FAIL). */
export interface ResultCandidateItem {
  interviewId: string;
  candidateName: string;
  candidateEmail: string | null;
  decision: 'PASS' | 'FAIL';
  percentageScore: number | null;
  decidedAt: string | null;
  /** When the result email was last sent to this candidate, if ever. */
  lastEmailedAt: string | null;
}

/** Outcome of a bulk result-email send. */
export interface BulkEmailResult {
  sent: number;
  skipped: number;
  failed: number;
  total: number;
  /** Skipped because the candidate was already emailed (and force was off). */
  skippedAlreadySent?: number;
  /** Skipped because SMTP isn't configured in System Config → Email. */
  skippedNotConfigured?: number;
}

/** Response from recording a violation — drives the candidate warning UI. */
export interface ViolationResult {
  /** How many total warnings the candidate has now accrued. */
  warnings: number;
  maxWarnings: number;
  /** True once warnings exceed the allowance — the interview is ending. */
  terminated: boolean;
  autoSubmitted: boolean;
}
