/** Module 8 — Video Interview Intelligence. A review-and-intelligence layer over
 *  completed interviews that carry a recording and/or transcript. */
import type { InterviewStatus, InterviewType, Recommendation, ViolationType } from '../constants/enums.js';

/** Deterministic, AI-free transcript stats (always computed). */
export interface TranscriptMetrics {
  wordCount: number;
  /** Words per minute, using the interview's recorded duration (null if unknown). */
  wordsPerMinute: number | null;
  fillerCount: number;
  /** Filler words as a % of total words (0–100). */
  fillerRatio: number;
  questionCount: number;
  /** Candidate's share of words when the transcript is speaker-labelled (0–100, else null). */
  candidateTalkRatio: number | null;
  topKeywords: { word: string; count: number }[];
}

export interface SentimentBreakdown {
  /** Overall tone label. */
  overall: string;
  /** -1 (negative) … 1 (positive). */
  score: number;
  positive: number;
  neutral: number;
  negative: number;
}

/** The full intelligence payload attached to an interview's result. */
export interface VideoIntelligence {
  /** 0–100 clarity/articulation score (AI; null when key not configured). */
  communicationScore: number | null;
  /** 0–100 skill/topic coverage score (AI; null when not available). */
  skillMatchScore: number | null;
  sentiment: SentimentBreakdown | null;
  /** AI-extracted topics/keywords (falls back to deterministic top keywords). */
  keywords: string[];
  metrics: TranscriptMetrics;
  /** AI narrative summary of the conversation (null when key not configured). */
  transcriptSummary: string | null;
  /** Whether the AI layer actually ran (false = deterministic-only). */
  aiGenerated: boolean;
  analyzedAt: string | null;
}

export interface IntegrityViolation {
  type: ViolationType;
  at: string;
}

/** Proctoring summary derived from the interview's captured anti-cheat violations. */
export interface IntegrityReport {
  totalStrikes: number;
  byType: { type: ViolationType; count: number }[];
  timeline: IntegrityViolation[];
  /** clean | low | medium | high */
  severity: 'clean' | 'low' | 'medium' | 'high';
}

export interface ReviewListItem {
  id: string;
  status: InterviewStatus;
  type: InterviewType;
  createdAt: string;
  completedAt: string | null;
  candidate: { id: string; fullName: string; email: string };
  hasTranscript: boolean;
  hasRecording: boolean;
  communicationScore: number | null;
  percentageScore: number | null;
  decision: string | null;
  failureReason: string | null;
  recommendedLearning: string | null;
  feedbackPdfPath: string | null;
  recommendation: Recommendation | null;
  reviewedAt: string | null;
  roundNumber: number | null;
  violationCount: number;
}

export interface AnswerDetail {
  id: string;
  questionId: string;
  answerText: string | null;
  answerCode: string | null;
  selectedOption: string | null;
  isCorrect: boolean | null;
  aiScore: number | null;
  maxScore: number | null;
  aiEvaluation: string | null;
  aiStrengths: string | null;
  aiImprovements: string | null;
  aiReasoning: string | null;
  timeTaken: number | null;
}

export interface QuestionDetail {
  id: string;
  text: string;
  type: string;
  difficulty: string;
  options: unknown;
}
export interface BiometricReportDetail {
  id: string;
  interviewId: string;
  candidateId: string;
  enrollmentImage: string;
  enrollmentTimestamp: string;
  faceSignature?: any;
  verificationStatus: string;
  totalChecks: number;
  successfulMatches: number;
  failedMatches: number;
  warningsIssued: number;
  noFaceEvents: number;
  multipleFaceEvents: number;
  matchHistory?: any;
  latestImage: string | null;
}

export interface ReviewDetail extends ReviewListItem {
  recordingUrl: string | null;
  transcript: string | null;
  duration: number | null;
  intelligence: VideoIntelligence | null;
  integrity: IntegrityReport;
  reviewerNotes: string | null;
  /** Headline interview score from M4 auto-grading, when present. */
  percentageScore: number | null;
  technicalScore: number | null;
  problemSolvingScore: number | null;
  confidenceScore: number | null;
  domainKnowledgeScore: number | null;
  strengths: string | null;
  improvements: string | null;
  questions: QuestionDetail[];
  answers: AnswerDetail[];
  biometricReport?: BiometricReportDetail | null;
}

