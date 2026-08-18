/** Candidate portal — read-only views of a signed-in candidate's own
 *  interviews and offers. Deliberately narrow: only fields a candidate should
 *  see (no internal scores, recruiter notes, or other candidates' data). */
import type { OfferStatus } from '../constants/enums.js';

export interface MyInterviewItem {
  id: string;
  type: string;
  status: string;
  /** Scheduled date/time (from the linked schedule) or the start time. */
  scheduledAt: string | null;
  duration: number | null;
  /** External meeting link for a panel/live interview, when present. */
  meetingLink: string | null;
  /** Access token for a self-serve AI interview — builds /interview/:token. */
  accessToken: string | null;
  roundNumber?: number | null;
  jobRequisitionId?: string | null;
  completedAt: string | null;
  result?: {
    percentageScore: number | null;
    decision: string | null;
    aiDecision: string | null;
    aiSummary: string | null;
    aiReasoning: string | null;
    strengths: string | null;
    improvements: string | null;
    failureReason?: string | null;
    recommendedLearning?: string | null;
    hasFeedbackPdf?: boolean;
  } | null;
}

export interface MyApplicationItem {
  id: string;
  jobRequisitionId?: string | null;
  jobTitle: string;
  status: string;
  currentRound: number;
  completedRounds: number;
  workflowStatus: string;
  failedRound: number | null;
  workflowRounds: {
    id: string;
    roundNumber: number;
    roundName: string;
    roundType: string;
    isMandatory: boolean;
    passPercentage: number | null;
  }[];
}

export interface MyOfferItem {
  id: string;
  jobTitle: string;
  status: OfferStatus;
  salaryOffered: number | null;
  joiningDate: string | null;
  validUntil: string | null;
  /** Download URL for the signed/issued offer letter, when available. */
  offerLetterUrl: string | null;
  /** When the offer was created/sent. */
  sentAt: string;
}
