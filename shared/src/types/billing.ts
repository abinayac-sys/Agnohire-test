/** SaaS billing / tenancy DTOs shared by server and client. */
import type { AuthUser } from './api.js';

export type PlanCode = 'FREE' | 'STARTER' | 'PRO' | 'ENTERPRISE' | 'LEGACY_ENTERPRISE';
export type BillingInterval = 'monthly' | 'yearly';

export type SubscriptionStatus =
  | 'CREATED'
  | 'PENDING'
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'HALTED'
  | 'CANCELLED'
  // Trial ran out without converting to a paid plan. Set lazily by
  // entitlementService.assertActiveSubscription on the write path — there is
  // no billing webhook for a trial ending, so this self-heals the row the
  // next time anything tries to write for this tenant.
  | 'EXPIRED';

export type TenantStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';

/** Sales/marketing approval state, orthogonal to billing TenantStatus. */
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/**
 * Public/free email providers. Signups on these are flagged (not blocked) in the
 * approval queue so marketing can prioritise corporate tenants.
 */
export const FREEMAIL_DOMAINS: readonly string[] = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'ymail.com',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'icloud.com', 'me.com',
  'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'zoho.com', 'mail.com',
  'yandex.com', 'rediffmail.com',
];

/** True when an email uses a known free/public provider domain. */
export function isFreeEmailDomain(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase().trim();
  return !!domain && FREEMAIL_DOMAINS.includes(domain);
}

export type UsageMetric =
  | 'USERS'
  | 'INTERVIEWED_CANDIDATES'
  | 'ACTIVE_JOBS'
  | 'CANDIDATES'
  | 'SCHEDULES'
  | 'ORGANIZATIONS'
  | 'WORKSPACES';

/** The 4 metrics that support per-unit overage pricing and add-on purchases. */
export type BillableMetric = 'ORGANIZATIONS' | 'WORKSPACES' | 'USERS' | 'CANDIDATES';

export interface PlanLimits {
  maxUsers: number | null;
  maxInterviewedCandidates: number | null;
  maxActiveJobs: number | null;
  maxCandidates: number | null;
  maxSchedules: number | null;
  maxOrganizations: number | null;
  maxWorkspaces: number | null;
  storageMb: number | null;
  aiEnabled: boolean;
  proctoringEnabled: boolean;
  /**
   * Per-unit price for self-service add-on capacity: null = this metric has
   * no add-on option at all, so its maxX above is an unconditional hard
   * block. When set, a tenant can proactively buy add-on capacity at this
   * rate to raise their included quota (see TenantAddonPurchaseItem) — but
   * creation is ALWAYS blocked at the effective (plan + add-on) limit either
   * way; there is no automatic metered-overage path that bypasses the block
   * just because a price is configured (see entitlementService.assertWithinLimit).
   * getOverageCharges/OverageCharge still price any pre-existing over-limit
   * data (e.g. grandfathered, or a plan downgrade), just not newly-creatable.
   */
  pricePerOrganization: number | null;
  pricePerWorkspace: number | null;
  pricePerUser: number | null;
  pricePerCandidate: number | null;
  /**
   * Deletion floor, independent of maxX: null = no floor beyond the existing
   * structural one (a tenant's single "default" org/workspace can't be
   * deleted). When set, deleting past this number is blocked — see
   * entitlementService.assertAboveMinimum.
   */
  minOrganizations: number | null;
  minWorkspaces: number | null;
  minUsers: number | null;
  minCandidates: number | null;
  /**
   * Free-trial length in days granted on tenant approval, for FREE/plan-less
   * or not-yet-paid tenants — null falls back to the platform-wide
   * `billing.default_trial_days` SystemConfiguration default. See
   * tenantAdminService.approveTenant.
   */
  trialDays: number | null;
}

export interface PlanSummary extends PlanLimits {
  code: PlanCode;
  name: string;
  priceMonthly: number | null;
  priceYearly: number | null;
  currency: string;
  isActive: boolean;
  /** Short marketing bullets shown alongside the structured limits. */
  features: string[];
}

export interface UsageEntry {
  metric: UsageMetric;
  used: number;
  /** EFFECTIVE limit: the plan's included maxX plus any add-on capacity this tenant has purchased for it. Null = unlimited. */
  limit: number | null;
  remaining: number | null;
  /** Per-unit overage price for this metric's plan, if configured (see PlanLimits). Null = hard-blocked at `limit`, not metered. */
  unitPrice: number | null;
  /** This tenant's currently-owned add-on units for this metric (0 for non-billable metrics) — what a "remove N" action would reduce. */
  extra: number;
}

/** A purchase (or scheduled decrease, once applied) event for a tenant's add-on capacity — history only; the actual recurring charge is computed live each cycle from Tenant.extraX, see RecurringAddonSummary. */
export interface TenantAddonPurchaseItem {
  id: string;
  metric: BillableMetric;
  quantity: number;
  unitPrice: number;
  amount: number;
  currency: string;
  createdAt: string;
  /** Immediate mid-cycle prorated charge, if one was issued (auto-pay tenants only) — null otherwise. */
  prorationAmount: number | null;
  paymentLinkUrl: string | null;
  paymentLinkStatus: 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED' | null;
}

/** A requested reduction in add-on capacity, deferred to the next renewal (see TenantAddonPendingChange). */
export interface PendingAddonChangeItem {
  id: string;
  metric: BillableMetric;
  /** Always negative — the number of units to remove. */
  delta: number;
  /** When this takes effect (the current cycle's renewal date). */
  effectiveAt: string | null;
  createdAt: string;
}

export interface RecurringAddonBreakdownItem {
  metric: BillableMetric;
  extraUnits: number;
  unitPrice: number;
  amount: number;
}

/** This cycle's recurring add-on charge (Tenant.extraX × current pricePerX per metric) — separate from OverageSummary, which is usage beyond even that. */
export interface RecurringAddonSummary {
  breakdown: RecurringAddonBreakdownItem[];
  total: number;
  currency: string;
}

/** A metric currently over its plan's included quota, on a plan with per-unit overage pricing configured. */
export interface OverageCharge {
  metric: UsageMetric;
  /** Current live count over the included quota (falls as the count falls — see entitlementService.getOverageCharges). */
  unitsOver: number;
  unitPrice: number;
  amount: number;
}

export interface OverageSummary {
  charges: OverageCharge[];
  total: number;
  currency: string;
}

export interface TenantUsage {
  tenantId: string;
  planCode: PlanCode;
  subscriptionStatus: SubscriptionStatus;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  usage: UsageEntry[];
}

export interface SubscriptionSummary {
  status: SubscriptionStatus;
  plan: PlanSummary;
  billingInterval: BillingInterval;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  shortUrl: string | null;
  /** Explicit opt-in: whether the recurring add-on/overage amount auto-collects via Razorpay each cycle. Off by default. */
  autoPayEnabled: boolean;
  autoPayConsentedAt: string | null;
}

/** Returned by POST /api/auth/register for paid plans (Razorpay Checkout). */
export interface CheckoutBootstrap {
  tenantId: string;
  subscriptionId: string;
  razorpaySubscriptionId: string;
  shortUrl: string | null;
  keyId: string;
}

export interface RegisterResult {
  tenantId: string;
  requiresPayment: boolean;
  requiresEmailVerification: boolean;
  /** Self-serve signups are inert until marketing approves — the client shows a
   * "workspace under review" holding page instead of logging the user in. */
  requiresApproval: boolean;
  checkout?: CheckoutBootstrap;
}

// ── Platform-superadmin admin DTOs ────────────────────────────────────────────

/** Full plan row for the platform Billing & Plans admin. */
export interface PlanAdminDto extends PlanLimits {
  id: string;
  code: string;
  name: string;
  priceMonthly: number | null;
  priceYearly: number | null;
  currency: string;
  isActive: boolean;
  razorpayPlanIdMonthly: string | null;
  razorpayPlanIdYearly: string | null;
  tenantCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Row in the Tenant Accounts list. */
export interface TenantListItem {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  /** Marketing approval state (PENDING signups await a qualifying call). */
  approvalStatus: ApprovalStatus;
  /** Owner contact number collected at signup (the number to call). */
  phone: string | null;
  /** True when the owner email is a free/public provider (triage hint). */
  ownerEmailFreemail: boolean;
  planCode: string | null;
  planName: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  ownerEmail: string | null;
  ownerUserId: string | null;
  userCount: number;
  jobCount: number;
  candidateCount: number;
  interviewCount: number;
  createdAt: string;
  /** Platform operator who provisioned this tenant (null = self-registered). */
  createdById: string | null;
  /** True when the requesting operator created this tenant (gates edit/login). */
  createdByMe: boolean;
  /** Superadmin-only feature grant for the public careers page (website embed).
   *  Defaults false; hidden from the tenant's own admin UI until granted here. */
  careersPageEnabled: boolean;
}

/** Detailed tenant view (accounts detail drawer). */
export interface TenantDetail extends TenantListItem {
  usage: UsageEntry[];
  currentPeriodEnd: string | null;
}

export interface CreateTenantResult {
  tenantId: string;
  slug: string;
  ownerEmail: string;
  ownerUserId: string;
  /** One-time token the owner uses to set their password (accept-invite page). */
  setPasswordToken: string;
}

/** Result of impersonating (logging into) a created tenant's owner. */
export interface TenantLoginResult {
  accessToken: string;
  user: AuthUser;
}
