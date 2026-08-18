import type { ReferralStatus, SourcingChannelType } from '../constants/enums.js';

export interface ReferralItem {
  id: string;
  status: ReferralStatus;
  bonusAmount: string | null;
  bonusPaid: boolean;
  createdAt: string;
  candidate: { id: string; fullName: string; email: string } | null;
  job: { id: string; title: string } | null;
  referrer: { id: string; fullName: string } | null;
}

export interface SourcingChannelItem {
  id: string;
  name: string;
  type: SourcingChannelType;
  isActive: boolean;
  config: Record<string, unknown> | null;
  /** True when this channel needs an Integration credential that isn't set yet. */
  needsCredential: boolean;
  createdAt: string;
}

/** A candidate member of a curated list. */
export interface CuratedListMember {
  id: string;
  fullName: string;
  email: string;
  currentRole: string | null;
  skills: string[];
  fitScore: number | null;
}
