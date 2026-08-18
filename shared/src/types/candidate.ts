import type {
  ApplicationStatus,
  CandidateSource,
  ExperienceLevel,
  FitRecommendation,
  ParseStatus,
} from '../constants/enums.js';

/** Structured data extracted from a resume by the AI parser. */
export interface ParsedResumeData {
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  currentRole?: string | null;
  totalExperienceYears?: number | null;
  summary?: string | null;
  skills: string[];
  education: { degree: string; institution: string; year?: string | null }[];
  experience: {
    title: string;
    company: string;
    duration?: string | null;
    description?: string | null;
  }[];
  certifications: string[];
}

export interface ResumeItem {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  isPrimary: boolean;
  parseStatus: ParseStatus;
  parseError: string | null;
  parsedData: ParsedResumeData | null;
  parsedAt: string | null;
  createdAt: string;
}

export interface CandidateListItem {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  experienceLevel: ExperienceLevel | null;
  currentRole: string | null;
  location: string | null;
  skills: string[];
  source: CandidateSource | null;
  fitScore: number | null;
  avatarUrl: string | null;
  consentGiven: boolean;
  createdAt: string;
  updatedAt: string;
  sector: { id: string; name: string } | null;
  domain: { id: string; name: string } | null;
  /** Job requisition this candidate is directly linked to, when set. */
  jobRequisition?: { id: string; title: string } | null;
  _count: { resumes: number; applications: number };
  /** Primary (or newest) resume, when one exists — present on list responses. */
  primaryResume?: { id: string; fileName: string; parseStatus: ParseStatus } | null;
  jobApplied?: { id: string; title: string } | null;
}

export interface CandidateAssignmentRef {
  id: string;
  recruiterId: string;
  assignedById: string;
  status: string;
  assignedAt: string;
}

export interface CandidateDetail extends CandidateListItem {
  linkedinUrl: string | null;
  githubUrl: string | null;
  consentAt: string | null;
  resumes: ResumeItem[];
  applications: ApplicationListItem[];
  assignments: CandidateAssignmentRef[];
}

// ─── Bulk upload (candidate lists) ────────────────────────────────────────────

export interface CandidateUploadError {
  row: number;
  email: string | null;
  reason: string;
}

export interface CandidateUploadList {
  id: string;
  name: string;
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'ERROR' | 'ALREADY_UPLOADED';
  totalCount: number;
  validCount: number;
  errorCount: number;
  /** Of validCount, how many rows matched an existing candidate (by email/
   * phone/resume/LinkedIn/GitHub) instead of creating a new one — e.g. the
   * same person appearing in two source files. Not an error. */
  linkedCount: number;
  uploadedById: string;
  sectorId: string | null;
  /** BULK_IMPORT lists cascade-delete their candidates when deleted; CURATED
   * lists are just a reusable pointer and never delete their members. */
  source: 'CURATED' | 'BULK_IMPORT';
  createdAt: string;
  updatedAt: string;
}

export interface CandidateUploadListDetail extends CandidateUploadList {
  errorReport: CandidateUploadError[] | null;
  linkedReport: CandidateUploadError[] | null;
}

/** AI fit-score breakdown stored on JobApplication.fitScoreData. */
export interface FitScoreData {
  overall: number;
  skillMatch: number;
  experienceMatch: number;
  matchedSkills: string[];
  missingSkills: string[];
  summary: string;
  strengths: string[];
  concerns: string[];
  recommendation: FitRecommendation;
  scoredAt: string;
}

export interface ApplicationListItem {
  id: string;
  status: ApplicationStatus;
  stage: string | null;
  fitScore: number | null;
  fitScoreData: FitScoreData | null;
  notes: string | null;
  currentRound: number;
  completedRounds: number;
  failedRound: number | null;
  workflowStatus: string;
  appliedAt: string;
  updatedAt: string;
  candidate: {
    id: string;
    fullName: string;
    email: string;
    currentRole: string | null;
    avatarUrl: string | null;
    skills: string[];
  };
  job: {
    id: string;
    title: string;
    domain: { id: string; name: string };
  };
}

export interface CandidateStats {
  total: number;
  withResume: number;
  scored: number;
  newThisWeek: number;
}
