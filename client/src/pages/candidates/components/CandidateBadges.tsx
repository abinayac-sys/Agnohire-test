import { Badge } from '../../../components/ui/Badge.js';
import type {
  ExperienceLevel,
  CandidateSource,
  ParseStatus,
  ApplicationStatus,
  FitRecommendation,
} from '@agnohire/shared';
import { formatTitleCase } from '@agnohire/shared';

const EXPERIENCE_LABELS: Record<ExperienceLevel, string> = {
  ENTRY: 'Entry',
  JUNIOR: 'Junior',
  MID: 'Mid',
  SENIOR: 'Senior',
  LEAD: 'Lead',
  PRINCIPAL: 'Principal',
};

const SOURCE_LABELS: Record<CandidateSource, string> = {
  DIRECT: 'Direct',
  REFERRAL: 'Referral',
  LINKEDIN: 'LinkedIn',
  JOB_BOARD: 'Job Board',
  AGENCY: 'Agency',
  CAREER_SITE: 'Career Site',
  OTHER: 'Other',
};

export function ExperienceBadge({ level }: { level: ExperienceLevel | null }) {
  if (!level) return <span className="text-text-muted">—</span>;
  return <Badge variant="outline">{EXPERIENCE_LABELS[level]}</Badge>;
}

export function SourceBadge({ source }: { source: CandidateSource | null }) {
  if (!source) return <span className="text-text-muted">—</span>;
  return <Badge variant="muted">{SOURCE_LABELS[source]}</Badge>;
}

export function ParseStatusBadge({ status }: { status: ParseStatus }) {
  const map: Record<ParseStatus, { variant: 'info' | 'success' | 'warning' | 'danger'; label: string }> = {
    PENDING: { variant: 'warning', label: 'Queued' },
    PROCESSING: { variant: 'info', label: 'Parsing…' },
    COMPLETED: { variant: 'success', label: 'Parsed' },
    FAILED: { variant: 'danger', label: 'Parse failed' },
  };
  const { variant, label } = map[status];
  return <Badge variant={variant}>{label}</Badge>;
}

const APP_STATUS: Record<ApplicationStatus, { variant: 'muted' | 'info' | 'warning' | 'success' | 'danger'; label: string }> = {
  APPLIED: { variant: 'muted', label: 'Applied' },
  SCREENING: { variant: 'info', label: 'Screening' },
  ASSESSMENT: { variant: 'info', label: 'Assessment' },
  INTERVIEW: { variant: 'info', label: 'Interview' },
  SCHEDULE: { variant: 'info', label: 'Schedule' },
  SUBMITTED_TO_HR: { variant: 'warning', label: 'HR Approval' },
  OFFER: { variant: 'warning', label: 'Offer' },
  ONBOARDING: { variant: 'info', label: 'Onboarding' },
  HIRED: { variant: 'success', label: 'Hired' },
  REJECTED: { variant: 'danger', label: 'Rejected' },
};

export function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  const mapping = APP_STATUS[status];
  if (!mapping) {
    return <Badge variant="info">{formatTitleCase(status)}</Badge>;
  }
  return <Badge variant={mapping.variant}>{mapping.label}</Badge>;
}

/** Colored numeric fit-score chip (0–100). */
export function FitScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-text-muted">—</span>;
  const variant = score >= 75 ? 'success' : score >= 50 ? 'warning' : 'danger';
  return <Badge variant={variant}>{Math.round(score)}%</Badge>;
}

const REC_LABELS: Record<FitRecommendation, { variant: 'success' | 'info' | 'warning' | 'danger'; label: string }> = {
  STRONG_MATCH: { variant: 'success', label: 'Strong match' },
  MATCH: { variant: 'info', label: 'Match' },
  WEAK_MATCH: { variant: 'warning', label: 'Weak match' },
  NO_MATCH: { variant: 'danger', label: 'No match' },
};

export function RecommendationBadge({ recommendation }: { recommendation: FitRecommendation }) {
  const { variant, label } = REC_LABELS[recommendation];
  return <Badge variant={variant}>{label}</Badge>;
}
