import type { PipelineStage, FitRecommendation } from '@agnohire/shared';
import type { BadgeProps } from '../../components/ui/Badge.js';

type BadgeVariant = NonNullable<BadgeProps['variant']>;

export const STAGE_LABEL: Record<PipelineStage, string> = {
  SOURCED: 'Sourced',
  APPLIED: 'Applied',
  SCREENING: 'Screening',
  INTERVIEW: 'Interview',
  OFFER: 'Offer',
  HIRED: 'Hired',
  REJECTED: 'Rejected',
};

/** Accent strip colour per column (Tailwind bg utility). */
export const STAGE_ACCENT: Record<PipelineStage, string> = {
  SOURCED: 'bg-text-muted',
  APPLIED: 'bg-accent',
  SCREENING: 'bg-info',
  INTERVIEW: 'bg-warning',
  OFFER: 'bg-success',
  HIRED: 'bg-success',
  REJECTED: 'bg-danger',
};

export const FIT_VARIANT: Record<FitRecommendation, BadgeVariant> = {
  STRONG_MATCH: 'success',
  MATCH: 'success',
  WEAK_MATCH: 'warning',
  NO_MATCH: 'danger',
};

export function fitVariant(score: number | null): BadgeVariant {
  if (score == null) return 'muted';
  if (score >= 75) return 'success';
  if (score >= 50) return 'warning';
  return 'danger';
}
