import { api } from './api.js';
import type {
  ApiResponse,
  RegisterResult,
  TenantUsage,
  SubscriptionSummary,
  PlanSummary,
  CheckoutBootstrap,
  CareersFeatureStatus,
  OverageSummary,
  BillableMetric,
  TenantAddonPurchaseItem,
  PendingAddonChangeItem,
  RecurringAddonSummary,
} from '@agnohire/shared';

/** SaaS billing / registration client (all state authority is server-side). */

export interface BillingConfig {
  keyId: string;
  billingEnabled: boolean;
  plans: (Partial<PlanSummary> & { code: string; name: string })[];
}

function unwrap<T>(res: { data: ApiResponse<T> }): T {
  if (!res.data.success) throw new Error(res.data.error.message);
  return res.data.data;
}

export async function fetchBillingConfig(): Promise<BillingConfig> {
  return unwrap(await api.get<ApiResponse<BillingConfig>>('/billing/config'));
}

export async function registerTenant(input: {
  companyName: string;
  fullName: string;
  email: string;
  password: string;
  planCode: string;
  billingInterval: 'monthly' | 'yearly';
  timezone?: string;
}): Promise<RegisterResult> {
  return unwrap(await api.post<ApiResponse<RegisterResult>>('/auth/register', input));
}

export async function verifyCheckout(payload: {
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
}): Promise<{ state: string }> {
  return unwrap(await api.post<ApiResponse<{ state: string }>>('/billing/verify', payload));
}

export async function verifyEmailToken(token: string): Promise<{ verified: boolean }> {
  return unwrap(await api.post<ApiResponse<{ verified: boolean }>>('/auth/verify-email', { token }));
}

export async function requestPasswordReset(email: string): Promise<{ sent: boolean }> {
  return unwrap(await api.post<ApiResponse<{ sent: boolean }>>('/auth/forgot-password', { email }));
}

export async function resetPassword(input: {
  token: string;
  password: string;
  confirmPassword: string;
}): Promise<{ reset: boolean }> {
  return unwrap(await api.post<ApiResponse<{ reset: boolean }>>('/auth/reset-password', input));
}

export async function acceptInvite(input: {
  token: string;
  fullName: string;
  password: string;
}): Promise<{ accepted: boolean }> {
  return unwrap(await api.post<ApiResponse<{ accepted: boolean }>>('/tenant/invites/accept', input));
}

export async function fetchTenantUsage(): Promise<TenantUsage> {
  return unwrap(await api.get<ApiResponse<TenantUsage>>('/tenant/usage'));
}

export async function updateTenantTimezone(timezone: string): Promise<{ timezone: string }> {
  return unwrap(await api.patch<ApiResponse<{ timezone: string }>>('/tenant/timezone', { timezone }));
}

/** Superadmin-controlled per-tenant feature grants (currently: careers page). */
export async function fetchCareersFeatureStatus(): Promise<CareersFeatureStatus> {
  return unwrap(await api.get<ApiResponse<CareersFeatureStatus>>('/tenant/features'));
}

export interface BillingOverview {
  subscription: SubscriptionSummary;
  usage: TenantUsage;
  overage: OverageSummary;
  addonPurchases: TenantAddonPurchaseItem[];
  recurringAddon: RecurringAddonSummary;
  pendingAddonChanges: PendingAddonChangeItem[];
  invoices: {
    id: string;
    amount: string | null;
    currency: string;
    status: string;
    paidAt: string | null;
    createdAt: string;
  }[];
}

export async function fetchBillingOverview(): Promise<BillingOverview> {
  return unwrap(await api.get<ApiResponse<BillingOverview>>('/billing/subscription'));
}

export interface PurchaseAddonResult {
  metric: BillableMetric;
  quantity: number;
  unitPrice: number;
  amount: number;
  currency: string;
  newEffectiveLimit: number | null;
  /** Immediate mid-cycle prorated charge, if one was issued (auto-pay tenants only) — null otherwise. */
  prorationAmount: number | null;
  paymentLinkUrl: string | null;
}

/** Tenant self-service: buy add-on capacity for a billable metric (only offered when its plan has a per-unit price configured). */
export async function purchaseAddon(metric: BillableMetric, quantity: number): Promise<PurchaseAddonResult> {
  return unwrap(await api.post<ApiResponse<PurchaseAddonResult>>('/billing/addon', { metric, quantity }));
}

/** Tenant self-service: schedule removing add-on capacity, effective next renewal. */
export async function decreaseAddon(metric: BillableMetric, quantity: number): Promise<PendingAddonChangeItem> {
  return unwrap(await api.post<ApiResponse<PendingAddonChangeItem>>('/billing/addon/decrease', { metric, quantity }));
}

/** Tenant self-service: undo a scheduled add-on decrease before it takes effect. */
export async function cancelPendingAddonChange(id: string): Promise<{ cancelled: true }> {
  return unwrap(await api.delete<ApiResponse<{ cancelled: true }>>(`/billing/addon/pending/${id}`));
}

/** Tenant self-service: explicit opt-in/out for auto-collecting the recurring add-on/overage amount via Razorpay. */
export async function setAutoPay(enabled: boolean): Promise<{ autoPayEnabled: boolean; autoPayConsentedAt: string | null }> {
  return unwrap(
    await api.post<ApiResponse<{ autoPayEnabled: boolean; autoPayConsentedAt: string | null }>>('/billing/auto-pay', { enabled }),
  );
}

export async function changePlan(
  planCode: string,
  billingInterval?: 'monthly' | 'yearly',
): Promise<CheckoutBootstrap | { changed: true }> {
  return unwrap(
    await api.post<ApiResponse<CheckoutBootstrap | { changed: true }>>('/billing/change-plan', {
      planCode,
      billingInterval,
    }),
  );
}

export async function cancelSubscription(atPeriodEnd = true) {
  return unwrap(await api.post<ApiResponse<unknown>>('/billing/cancel', { atPeriodEnd }));
}

/**
 * Reverts a scheduled ("cancel at period end") cancellation. Razorpay has no
 * API to undo cancel_at_cycle_end, so this replaces the doomed subscription
 * with a fresh one on the same plan — always returns a CheckoutBootstrap that
 * must be handed to Razorpay, same as changePlan()'s paid-plan path.
 */
export async function resumeSubscription(): Promise<CheckoutBootstrap> {
  return unwrap(await api.post<ApiResponse<CheckoutBootstrap>>('/billing/resume', {}));
}

/** Load Razorpay Checkout script once and open it for a created subscription. */
export function openRazorpayCheckout(opts: {
  keyId: string;
  razorpaySubscriptionId: string;
  name: string;
  email: string;
  onSuccess: (payload: {
    razorpay_payment_id: string;
    razorpay_subscription_id: string;
    razorpay_signature: string;
  }) => void;
  onDismiss?: () => void;
}): void {
  const open = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Razorpay = (window as any).Razorpay;
    const rzp = new Razorpay({
      key: opts.keyId,
      subscription_id: opts.razorpaySubscriptionId,
      name: 'AgnoHire',
      prefill: { name: opts.name, email: opts.email },
      handler: opts.onSuccess,
      modal: { ondismiss: opts.onDismiss },
    });
    rzp.open();
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).Razorpay) return open();
  const script = document.createElement('script');
  script.src = 'https://checkout.razorpay.com/v1/checkout.js';
  script.onload = open;
  document.body.appendChild(script);
}
