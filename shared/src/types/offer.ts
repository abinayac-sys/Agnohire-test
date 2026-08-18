/** Module 11 — Offer & Onboarding. Offer composing, lifecycle, documents, and a
 *  post-acceptance onboarding checklist with background verification. */
import type { OfferStatus, OnboardingStatus, BgvStatus } from '../constants/enums.js';

export interface OfferListItem {
  id: string;
  applicationId: string;
  status: OfferStatus;
  salaryOffered: number | null;
  joiningDate: string | null;
  validUntil: string | null;
  createdAt: string;
  candidate: { id: string; fullName: string; email: string };
  job: { id: string; title: string };
  /** Onboarding status, once the offer has been accepted. */
  onboardingStatus: OnboardingStatus | null;
}

export interface OfferDocumentItem {
  id: string;
  name: string;
  fileUrl: string | null;
  type: string;
  required: boolean;
  uploadedAt: string | null;
  description: string | null;
  maxSizeInt: number | null;
  status: string;
  rejectionReason: string | null;
  createdAt: string;
  isManual?: boolean;
}

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
  completedAt: string | null;
}

export interface OnboardingInfo {
  id: string;
  status: OnboardingStatus;
  bgvStatus: BgvStatus;
  bgvProvider: string | null;
  bgvReportUrl: string | null;
  checklist: ChecklistItem[];
  completedAt: string | null;
}

export interface OfferDetail {
  id: string;
  status: OfferStatus;
  salaryOffered: number | null;
  joiningDate: string | null;
  validUntil: string | null;
  offerLetterUrl: string | null;
  notes: string | null;
  signedAt: string | null;
  createdAt: string;
  updatedAt: string;
  candidate: { id: string; fullName: string; email: string; currentRole: string | null };
  job: { id: string; title: string; budgetMin?: number | null; budgetMax?: number | null; };
  offeredByName: string | null;
  acceptanceToken: string | null;
  documents: OfferDocumentItem[];
  /** Present once the offer is accepted (onboarding auto-created). */
  onboarding: OnboardingInfo | null;
}
