import type { Recommendation } from '@agnohire/shared';

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  STRONG_HIRE: 'Strong hire',
  HIRE: 'Hire',
  NO_HIRE: 'No hire',
  STRONG_NO_HIRE: 'Strong no-hire',
};

export const RECOMMENDATION_VARIANT: Record<Recommendation, 'success' | 'info' | 'warning' | 'danger'> = {
  STRONG_HIRE: 'success',
  HIRE: 'info',
  NO_HIRE: 'warning',
  STRONG_NO_HIRE: 'danger',
};

export const RECOMMENDATION_OPTIONS = (Object.keys(RECOMMENDATION_LABEL) as Recommendation[]).map((value) => ({
  value,
  label: RECOMMENDATION_LABEL[value],
}));
