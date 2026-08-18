import type { AssessmentStatus } from '../constants/enums.js';
import type { QuestionItem, PublicQuestion, ViolationEntry, ProctorShotMeta } from './interview.js';

export interface AssessmentListItem {
  id: string;
  title: string;
  description: string | null;
  passingScore: number;
  durationMin: number | null;
  isActive: boolean;
  createdAt: string;
  domain: { id: string; name: string } | null;
  jobRequisition: { id: string; title: string } | null;
  questionCount: number;
  assignmentCount: number;
}

export interface AssessmentDetail extends AssessmentListItem {
  questions: QuestionItem[];
}

export interface AssignmentListItem {
  id: string;
  status: AssessmentStatus;
  accessToken: string;
  createdAt: string;
  startedAt: string | null;
  submittedAt: string | null;
  percentageScore: number | null;
  passed: boolean | null;
  candidate: { id: string; fullName: string; email: string };
  assessment: { id: string; title: string; passingScore: number } | null;
  jobRequisition: { id: string; title: string } | null;
}

export interface AssignmentAnswerItem {
  id: string;
  questionId: string;
  answerText: string | null;
  answerCode: string | null;
  selectedOption: string | null;
  language: string | null;
  isCorrect: boolean | null;
  aiScore: number | null;
  maxScore: number | null;
  aiEvaluation: string | null;
}

export interface AssignmentDetail extends AssignmentListItem {
  totalScore: number | null;
  maxScore: number | null;
  aiSummary: string | null;
  questions: QuestionItem[];
  answers: AssignmentAnswerItem[];
  /** ISO timestamp of the last successfully sent result email, or null if none sent. */
  resultEmailSentAt: string | null;
  /** Proctoring evidence (mirrors interviews). */
  violations: ViolationEntry[] | null;
  terminatedReason: string | null;
  recordingUrl: string | null;
  transcript: string | null;
  proctorShots: ProctorShotMeta[];
}

export interface AssessmentEmailResult {
  sent: boolean;
  skipped?: 'not-configured' | 'already-sent';
  error?: string;
}

// ─── PUBLIC (candidate-facing, token route) ───────────────────────────────────

export interface PublicAssessment {
  id: string;
  status: AssessmentStatus;
  title: string;
  description: string | null;
  candidateName: string;
  durationMin: number | null;
  startedAt: string | null;
  questions: PublicQuestion[];
  antiCheat: {
    /** Total cheating warnings allowed before the assessment auto-ends. */
    maxWarnings: number;
    proctoringEnabled: boolean;
    cameraRequired: boolean;
    micRequired: boolean;
    snapshotIntervalSec: number;
    screenShareRequired: boolean;
  };
  savedAnswers: {
    questionId: string;
    answerText: string | null;
    answerCode: string | null;
    selectedOption: string | null;
    language: string | null;
  }[];
}
