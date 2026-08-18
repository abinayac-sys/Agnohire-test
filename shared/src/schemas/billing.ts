import { z } from 'zod';

/** Shared password strength rule (owner accounts). */
export const passwordSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/[A-Z]/, 'Must contain an uppercase letter')
  .regex(/[a-z]/, 'Must contain a lowercase letter')
  .regex(/[0-9]/, 'Must contain a digit');

/** Public self-registration (creates a tenant + owner user, pending approval). */
export const registerTenantSchema = z.object({
  companyName: z.string().min(2).max(120),
  fullName: z.string().min(2).max(120),
  email: z.string().email(),
  // Contact number marketing calls to qualify the tenant before activating.
  phone: z.string().trim().min(6, 'Enter a valid phone number').max(40),
  password: passwordSchema,
  planCode: z.enum(['FREE', 'STARTER', 'PRO', 'ENTERPRISE']),
  billingInterval: z.enum(['monthly', 'yearly']).default('monthly'),
  // Auto-detected from the browser at signup (Intl.DateTimeFormat). Invalid
  // or missing values are silently clamped to UTC server-side — never blocks
  // registration over a soft-detection field.
  timezone: z.string().optional(),
});
export type RegisterTenantInput = z.infer<typeof registerTenantSchema>;

export const verifyEmailSchema = z.object({
  token: z.string().min(16),
});

export const resendVerificationSchema = z.object({
  email: z.string().email(),
});

/** Razorpay Checkout success handler payload → POST /api/billing/verify. */
export const verifyCheckoutSchema = z.object({
  razorpay_payment_id: z.string().min(1),
  razorpay_subscription_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});
export type VerifyCheckoutInput = z.infer<typeof verifyCheckoutSchema>;

export const changePlanSchema = z.object({
  planCode: z.enum(['FREE', 'STARTER', 'PRO', 'ENTERPRISE']),
  billingInterval: z.enum(['monthly', 'yearly']).optional(),
});

export const cancelSubscriptionSchema = z.object({
  atPeriodEnd: z.boolean().default(true),
});

// ── Platform-superadmin: Plan catalogue CRUD ──────────────────────────────────
const nullableNonNegInt = z.number().int().min(0).nullable();
const nullableNonNegMoney = z.number().min(0).nullable();

/** Create a plan. `code` is immutable once created (used as a stable key). */
export const createPlanSchema = z.object({
  code: z.string().min(2).max(40).regex(/^[A-Z0-9_]+$/, 'Uppercase letters, digits, underscores only'),
  name: z.string().min(2).max(120),
  priceMonthly: z.number().min(0).nullable().optional(),
  priceYearly: z.number().min(0).nullable().optional(),
  currency: z.string().min(3).max(3).default('INR'),
  isActive: z.boolean().default(true),
  razorpayPlanIdMonthly: z.string().max(120).nullable().optional(),
  razorpayPlanIdYearly: z.string().max(120).nullable().optional(),
  maxUsers: nullableNonNegInt.optional(),
  maxInterviewedCandidates: nullableNonNegInt.optional(),
  maxActiveJobs: nullableNonNegInt.optional(),
  maxCandidates: nullableNonNegInt.optional(),
  maxSchedules: nullableNonNegInt.optional(),
  maxOrganizations: nullableNonNegInt.optional(),
  maxWorkspaces: nullableNonNegInt.optional(),
  storageMb: nullableNonNegInt.optional(),
  pricePerOrganization: nullableNonNegMoney.optional(),
  pricePerWorkspace: nullableNonNegMoney.optional(),
  pricePerUser: nullableNonNegMoney.optional(),
  pricePerCandidate: nullableNonNegMoney.optional(),
  minOrganizations: nullableNonNegInt.optional(),
  minWorkspaces: nullableNonNegInt.optional(),
  minUsers: nullableNonNegInt.optional(),
  minCandidates: nullableNonNegInt.optional(),
  // Free-trial length (days) granted on tenant approval — null falls back to
  // the platform-wide "billing.default_trial_days" SystemConfiguration default.
  trialDays: nullableNonNegInt.optional(),
  aiEnabled: z.boolean().default(true),
  proctoringEnabled: z.boolean().default(true),
});
export type CreatePlanInput = z.infer<typeof createPlanSchema>;

/** Tenant self-service: buy add-on capacity for one billable metric. */
export const purchaseAddonSchema = z.object({
  metric: z.enum(['ORGANIZATIONS', 'WORKSPACES', 'USERS', 'CANDIDATES']),
  quantity: z.number().int().min(1).max(1000),
});
export type PurchaseAddonInput = z.infer<typeof purchaseAddonSchema>;

/** Tenant self-service: schedule a reduction in add-on capacity, effective next renewal. */
export const decreaseAddonSchema = purchaseAddonSchema;
export type DecreaseAddonInput = z.infer<typeof decreaseAddonSchema>;

/** Tenant self-service: explicit opt-in/out for auto-collecting the recurring add-on/overage amount via Razorpay. */
export const setAutoPaySchema = z.object({
  enabled: z.boolean(),
});
export type SetAutoPayInput = z.infer<typeof setAutoPaySchema>;

/** Update a plan — all fields optional; `code` cannot change. */
export const updatePlanSchema = createPlanSchema.partial().omit({ code: true });
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;

// ── Platform-superadmin: Tenant admin ─────────────────────────────
export const createTenantSchema = z.object({
  companyName: z.string().min(2).max(120),
  ownerFullName: z.string().min(2).max(120),
  ownerEmail: z.string().email(),
  // Operator sets the owner's initial password so they can sign in immediately.
  ownerPassword: passwordSchema,
  planCode: z.string().min(2).max(40),
});
export type CreateTenantInput = z.infer<typeof createTenantSchema>;

/** Approve/reject a pending tenant (marketing review). */
export const tenantApprovalSchema = z.object({
  notes: z.string().trim().max(1000).optional(),
});
export type TenantApprovalInput = z.infer<typeof tenantApprovalSchema>;

export const tenantStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']),
});

/** Edit a tenant profile (name and/or assigned plan). */
export const updateTenantSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    planCode: z.string().min(2).max(40).optional(),
  })
  .refine((v) => v.name !== undefined || v.planCode !== undefined, {
    message: 'Provide a name or planCode to update',
  });
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
