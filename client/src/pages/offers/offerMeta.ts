import type { OfferStatus, OnboardingStatus, BgvStatus } from '@agnohire/shared';
import type { BadgeProps } from '../../components/ui/Badge.js';

type Variant = NonNullable<BadgeProps['variant']>;

export const OFFER_STATUS_VARIANT: Record<OfferStatus, Variant> = {
  DRAFT: 'muted',
  SENT: 'info',
  ACCEPTED: 'success',
  DECLINED: 'danger',
  EXPIRED: 'warning',
  TENTATIVE: 'warning',
  DOCUMENTS_PENDING: 'warning',
  DOCUMENTS_SUBMITTED: 'info',
  DOCUMENTS_VERIFIED: 'success',
};

export const ONBOARDING_STATUS_LABEL: Record<OnboardingStatus, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
};

export const ONBOARDING_STATUS_VARIANT: Record<OnboardingStatus, Variant> = {
  NOT_STARTED: 'muted',
  IN_PROGRESS: 'info',
  COMPLETED: 'success',
};

export const BGV_STATUS_VARIANT: Record<BgvStatus, Variant> = {
  PENDING: 'muted',
  IN_PROGRESS: 'info',
  CLEARED: 'success',
  FLAGGED: 'danger',
};

export const OFFER_STATUS_LABEL: Record<OfferStatus, string> = {
  DRAFT: 'DRAFT',
  SENT: 'SENT',
  ACCEPTED: 'OFFER ACCEPTED',
  DECLINED: 'DECLINED',
  EXPIRED: 'EXPIRED',
  TENTATIVE: 'TENTATIVE',
  DOCUMENTS_PENDING: 'DOCUMENTS PENDING',
  DOCUMENTS_SUBMITTED: 'DOCUMENTS SUBMITTED',
  DOCUMENTS_VERIFIED: 'DOCUMENTS VERIFIED',
};

export const OFFER_STATUS_OPTIONS = (Object.keys(OFFER_STATUS_VARIANT) as OfferStatus[]).map((value) => ({
  value,
  label: OFFER_STATUS_LABEL[value] || value,
}));
