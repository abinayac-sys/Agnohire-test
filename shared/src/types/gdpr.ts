import type { GdprRequestType } from '../constants/enums.js';

export type GdprRequestStatus = 'PENDING' | 'COMPLETED' | 'REJECTED';

/** A GDPR request row (subject-access / portability / erasure). */
export interface GdprRequestItem {
  id: string;
  candidateId: string;
  candidateName: string | null;
  candidateEmail: string | null;
  type: GdprRequestType;
  status: GdprRequestStatus;
  requestedAt: string;
  processedAt: string | null;
  processedById: string | null;
  processedByName: string | null;
}

/** The portable data bundle returned for an ACCESS/PORTABILITY request. */
export interface GdprExportBundle {
  exportedAt: string;
  candidate: Record<string, unknown>;
  resumes: Record<string, unknown>[];
  applications: Record<string, unknown>[];
  interviews: Record<string, unknown>[];
  offers: Record<string, unknown>[];
}

/** Consent state for a candidate, shown in the compliance overview. */
export interface ConsentRow {
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  consentGiven: boolean;
  consentAt: string | null;
  gdprDeletedAt: string | null;
}

export interface RetentionPolicyItem {
  id: string;
  entityType: string;
  retentionDays: number;
  autoDeleteEnabled: boolean;
  updatedAt: string;
}

/** Headline compliance numbers for the page summary. */
export interface ComplianceSummary {
  pendingRequests: number;
  completedRequests: number;
  totalCandidates: number;
  consentedCandidates: number;
  erasedCandidates: number;
}
