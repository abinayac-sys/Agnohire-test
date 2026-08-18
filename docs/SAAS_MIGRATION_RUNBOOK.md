# AgnoHire — Cloud Multi-Tenant SaaS Migration Runbook

Status of the SaaS migration (tenancy, plans, quotas, Razorpay billing) and how
to deploy/operate it. **No existing recruitment functionality was changed** —
everything here is additive; the frontend design is untouched.

---

## 1. What was implemented

### Phase 1 — Tenancy foundation ✅
- **New Prisma models:** `Tenant`, `Plan`, `Subscription`, `UsageCounter`,
  `PaymentEvent`, `Invoice`, `TenantInvite` (end of `server/prisma/schema.prisma`).
- **`tenantId` column + index on 33 tenant-owned models** (User, Sector, Domain,
  JobRequisition, JobTemplate, Candidate, JobApplication, CandidateList,
  CandidateAssignment, Resume, Interview, InterviewSchedule, QuestionBank,
  Question, Assessment, AssessmentAssignment, PipelineNote, SourcingChannel,
  Referral, Offer, ChatbotConversation, ChatbotFaq, Notification, EmailTemplate,
  EmailLog, Integration, WebhookLog, AuditLog, GdprRequest, SystemConfiguration,
  AnalyticsSnapshot, Attachment, Theme-adjacent config). Child rows inherit
  isolation transitively via their parents.
- **Forward-only migration + backfill:**
  `server/prisma/migrations/20260702000001_multi_tenant_saas/migration.sql`
  — creates tables, adds nullable `tenantId` columns, backfills everything into
  a **Default Tenant** (`slug: default`) on an unlimited `LEGACY_ENTERPRISE`
  plan with an ACTIVE internal subscription, seeds `TENANT_OWNER` and
  `PLATFORM_SUPERADMIN` roles, and sets the default tenant owner. Safe for
  `prisma migrate deploy`; no `migrate reset` needed.
- **Choke-point scoping:** `server/src/config/tenantContext.ts`
  (AsyncLocalStorage) + a Prisma `$use` middleware in
  `server/src/config/database.ts`. Every **authenticated** request runs inside
  the JWT's tenant context: reads are filtered by `tenantId`, creates are
  stamped, unique updates/deletes are pre-verified in-tenant (fail closed —
  a principal with no tenant matches nothing). Public token routes and boot
  code pass through unchanged (they authenticate via unguessable tokens),
  preserving pre-SaaS behaviour exactly. `PLATFORM_SUPERADMIN` / legacy
  `SUPERADMIN` bypass for support/ops.
- **JWT carries `tenantId`** (`shared/src/types/api.ts`,
  `authService.buildPayload`, applied in `auth.middleware`). Never read from
  client headers/body.

### Phase 2 — Plans, entitlements, quotas ✅
- `server/src/services/entitlementService.ts`:
  `getEntitlements`, `assertActiveSubscription` (402 `SUBSCRIPTION_INACTIVE`),
  `assertWithinLimit` (402 `QUOTA_EXCEEDED` with current/limit detail),
  `getUsage`, `recordUsage`, `meterInterviewedCandidate`, `assertFeature`,
  `rolloverPeriod`. Structural metrics (USERS, ACTIVE_JOBS, ASSESSMENTS) are
  live-counted (self-healing); INTERVIEWED_CANDIDATES is period-metered via
  `UsageCounter` (unique per tenant/metric/periodStart — rollover is automatic
  because the period key changes).
- **Enforcement hooks (server-side, authoritative):**
  - `adminUserService.createUser` → blocks at `maxUsers`.
  - `publicInterviewService.startInterview` → blocks + meters at the
    SCHEDULED→IN_PROGRESS transition, once per candidate per billing period.
- **New endpoint:** `GET /api/tenant/usage` (authenticated) — usage meters vs
  limits for client UX gating.
- New typed errors in `server/src/utils/errors.ts`: `QuotaExceededError` (402),
  `SubscriptionInactiveError` (402).

### Phase 3 — Self-registration & provisioning ✅ (server-side)
- `server/src/services/tenantProvisioningService.ts` +
  `server/src/routes/registration.routes.ts` (mounted additively at `/api/auth`):
  - `POST /api/auth/register` `{companyName, fullName, email, password, planCode, billingInterval}`
    — FREE → tenant ACTIVE immediately with an internal ACTIVE subscription;
    PAID → tenant PENDING + Razorpay subscription; returns Checkout bootstrap
    `{subscriptionId, razorpaySubscriptionId, shortUrl, keyId}`. Activation is
    **webhook-driven only**.
  - `POST /api/auth/verify-email`, `POST /api/auth/resend-verification`
    (best-effort SMTP; does not block registration).
  - Owner user gets the existing **ADMIN role** (so the approved client UI works
    unchanged) + `Tenant.ownerUserId`; tenant defaults (General sector) seeded
    on activation.
- **Password login as a production path:** set `ALLOW_PASSWORD_LOGIN=true`
  (`env.ts → passwordLoginEnabled`); the existing `/api/auth/dev-login` endpoint
  now honours it (Google OAuth stays optional).

### Phase 5 — Razorpay billing ✅
- **Provider abstraction:** `server/src/services/billing/razorpayProvider.ts`
  (`PaymentProvider` interface; lazy-loads the `razorpay` SDK; constant-time
  HMAC verification for both signatures). Stub-injectable via
  `setPaymentProvider()` for tests.
- **Billing service:** `server/src/services/billing/billingService.ts` —
  create subscription (notes carry `tenantId`/`planCode`), checkout verify
  (`HMAC_SHA256(payment_id|subscription_id, KEY_SECRET)` → marks PENDING only),
  idempotent webhook processor (unique `PaymentEvent.eventId`), state machine:
  `authenticated→PENDING`, `activated→ACTIVE + tenant activation`,
  `charged→ACTIVE + period rollover + Invoice mirror`, `pending→PAST_DUE`,
  `halted→HALTED + tenant SUSPENDED`, `cancelled/completed→CANCELLED`,
  `updated→plan sync`. Plan change = cancel-and-create; cancel supports
  `atPeriodEnd`.
- **Webhook:** `POST /api/billing/webhook` mounted in `app.ts` with
  `express.raw()` **before** the global JSON parser (raw bytes preserved for
  signature verification). Invalid signature → 400. Retries safe (idempotent).
- **Routes:** `server/src/routes/billing.routes.ts` —
  `GET /api/billing/config` (public: keyId + plan catalogue — never secrets),
  `POST /api/billing/verify` (public), and owner/admin-gated
  `GET /api/billing/subscription`, `POST /api/billing/change-plan`,
  `POST /api/billing/cancel`.
- **Plan bootstrap:** `npm run bootstrap:plans --workspace server` upserts the
  FREE/STARTER/PRO/ENTERPRISE catalogue; with `CREATE_RAZORPAY_PLANS=true` it
  also creates the matching Razorpay Plans and stores their ids.
- **Tests:** `server/tests/billingSignatures.test.ts` (checkout + webhook HMAC,
  valid/forged/tampered) — passing. Server + shared + client typecheck clean
  (the only remaining TS warnings are pre-existing in `src/ai/tools/*`).

---

## 2. Deployment steps

1. `npm install` (adds `razorpay`).
2. Set env vars (see `.env.example`):
   `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`
   (TEST keys `rzp_test_…` outside prod), `ALLOW_PASSWORD_LOGIN=true`.
3. `npm run prisma:deploy --workspace server` — applies the tenancy migration +
   backfill (existing data lands in the Default Tenant, nothing throttled).
4. `npm run bootstrap:plans --workspace server` (once; add
   `CREATE_RAZORPAY_PLANS=true` to auto-create Razorpay Plans).
5. Razorpay dashboard → Webhooks → add
   `https://<your-domain>/api/billing/webhook`, secret = `RAZORPAY_WEBHOOK_SECRET`,
   subscribe to: `subscription.authenticated`, `subscription.activated`,
   `subscription.charged`, `subscription.pending`, `subscription.halted`,
   `subscription.cancelled`, `subscription.completed`, `subscription.updated`,
   and (as of the mid-cycle prorated add-on billing, 2026-08-13)
   `payment_link.paid`, `payment_link.expired`, `payment_link.cancelled` —
   these track the standalone Payment Link issued when an auto-pay tenant
   increases add-on capacity mid-cycle (see `issueProratedInvoice` in
   `billingService.ts`); without them, `TenantAddonPurchase.paymentLinkStatus`
   just stays `PENDING` forever even after the customer pays.
6. If a CSP is enforced at the web edge, allow `checkout.razorpay.com`
   (script-src, frame-src) and `api.razorpay.com` (connect-src). The current
   server-side `helmet()` does not set a CSP on the SPA, so nothing to change
   unless an edge proxy adds one.

### Replaying a webhook locally
```bash
BODY='{"event":"subscription.activated","payload":{"subscription":{"entity":{"id":"sub_123","notes":{"tenantId":"<tenant-uuid>"},"current_start":1750000000,"current_end":1752600000}}}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$RAZORPAY_WEBHOOK_SECRET" -hex | sed 's/^.* //')
curl -X POST http://localhost:4000/api/billing/webhook \
  -H "Content-Type: application/json" -H "x-razorpay-signature: $SIG" -d "$BODY"
```

---

## 3. Also implemented (second pass)

- **Phase 4 — tenant-scoped configuration:** `configService` now resolves
  `tenant+sector → tenant → platform-sector → platform default`, and `set()`
  creates a tenant override row on first write (metadata copied from the
  platform default). Existing `SystemConfiguration` rows remain platform
  defaults (`tenantId NULL`) — the migration intentionally does not backfill them.
- **Tenant invites:** `POST/GET /api/tenant/invites` (owner/admin, seat-quota
  checked) and public `POST /api/tenant/invites/accept` (token + name +
  password; seat re-checked at acceptance; email pre-verified by the invite).
- **All enforcement hooks:** `maxUsers` (user create + invite), `maxActiveJobs`
  (job approval), `maxAssessments` (assessment create),
  `maxInterviewedCandidates` (interview start, metered), `aiEnabled` plan gate
  at the central `openaiService.chatCompletion` hub (request-context only —
  workers/system calls unaffected).
- **Email verification at login:** unverified self-registered users are blocked
  at password login **only when SMTP is configured** (local dev unaffected;
  legacy users were marked verified by the migration).
- **Client pages (new files only; zero changes to existing screens/design):**
  `/register` (plan picker + Razorpay Checkout), `/verify-email`,
  `/accept-invite`, and `<role>/billing` (usage meters, plan switch, cancel,
  invoices) inside the existing AppLayout. Routes added additively in
  `App.tsx`; services in `client/src/services/billingApi.ts`.
- **Tests:** `server/tests/tenantIsolation.test.ts` — two-tenant black-box
  isolation proof (registers 2 FREE tenants; asserts cross-tenant users/
  candidates/jobs are invisible; usage + subscription are tenant-scoped).
  Requires the dev server + DB running (same as the rest of the suite) and the
  plan catalogue bootstrapped.

## 3b. Phase 6 — Organization/Workspace hierarchy + billing v2 (recurring add-ons, auto-pay)

**Not yet deployed to production as of 2026-08-13.** Adds `Organization`/
`Workspace`/`OrganizationMember`/`WorkspaceMember` under `Tenant`, retrofits
`Sector` (and transitively `JobRequisition`) to require an org+workspace,
denormalizes `organizationId`/`workspaceId` onto 12 further sector-dependent
tables (nullable forever there), adds RESTRICTIVE `workspace_isolation` RLS
policies, and extends `Plan`/`Tenant`/`Subscription` for per-unit add-on
pricing, minimum floors, deferred decreases, and Razorpay-backed recurring
add-on/auto-pay billing. 15 migrations, `20260812084825` through
`20260813063620`. All additive/nullable-first with guarded backfills — see
each migration's own header comment for its specific safety reasoning.

**Verified 2026-08-13**: restored a real production backup
(`agnohire_20260812_165339.dump`, 16 tenants / 37 users / 1278 candidates /
62 job requisitions) into a local Postgres instance and ran
`prisma migrate deploy` (the exact command production uses) against it.
Result: all 15 migrations applied with zero errors; pre/post row-count and
identity-hash comparison (`Tenant.id`, `User.email`) came back byte-identical;
backfill was 100% complete (0 Sectors/JobRequisitions left without an
org/workspace; membership row counts matched active-user counts exactly).
**Recommend repeating this restore-and-deploy dry run against a fresh
production backup immediately before the real deploy**, since 15+ hours will
have passed and new signups/data may exist that these migrations haven't
been proven against.

**Critical deploy order — do not run this as one undifferentiated
`migrate deploy` against a live app without the gap below, or you risk a
production incident:**

1. **Deploy migrations `084825` → `093000` only** (core tables, default
   org/workspace backfill, nullable columns on the 12 sector-dependent
   tables, their backfill). These are pure additions — nothing existing
   reads or writes these columns yet, so this is safe to run while the OLD
   app code is still live and serving traffic.
2. **Deploy the new app/server code** (this PR/branch) and confirm it is
   fully rolled out and healthy. This is the code that (a) populates
   `organizationId`/`workspaceId` whenever it creates a `Sector`, and
   (b) sets the `app.workspace_id` Postgres GUC on every request (see
   `server/src/config/tenantContext.ts` / `database.ts`).
3. **Only then deploy migrations `094000` onward** — starting with
   `organization_workspace_tighten_not_null`. Applying this migration while
   OLD app code is still creating `Sector` rows will make every such create
   fail (`organizationId`/`workspaceId` NOT NULL, old code never sets them).
   The two RLS-stage migrations later in this range (`130000`, `150000`)
   carry the same requirement for reads: `150000_rls_organization_workspace_
   policies_stage2` has no NULL escape hatch, so any connection that never
   set `app.workspace_id` gets zero rows back from `Sector`/`JobRequisition`
   — exactly the scenario step 2 is required to prevent.

**Never run `prisma migrate dev` or `migrate reset` against production** —
only `migrate deploy`. `migrate dev` can silently reset+reseed the database
on detected drift, which would wipe the Razorpay plan-id mappings written by
`bootstrap:plans` (they live only in `Plan` rows, not in seed data or any
migration) and any other runtime-written state. If billing v2's per-unit
add-on pricing should be enabled in production, that's a separate business
decision made by setting `Plan.pricePerX`/`minX` values directly — no script
does this automatically, matching how the base plan catalogue itself is
already managed.

### Production configuration gap discovered 2026-08-13 (data, not schema — not yet actioned)

Restoring a production backup into local dev and diffing it against the app
surfaced that **production has never had any plan mapped to Razorpay, and no
plan has ever had per-unit add-on pricing configured** — confirmed directly
against the restored data, not assumed. This means the "buy add-on capacity"
UI correctly stays hidden today (by design — the client only shows it when
`Plan.pricePerX` is set) and a real paid signup on **any** plan would fail at
checkout with "Plan X has no Razorpay plan mapped for Y billing" — the exact
error that prompted this investigation. This is pre-existing production
state that the restore only made visible locally; nothing in the restore or
the migrations caused it.

**Both fields are already editable in production without touching code**,
via the existing platform-superadmin Plan admin (`PATCH /api/platform/plans/:id`,
schema in `shared/src/schemas/billing.ts:updatePlanSchema` — covers
`razorpayPlanIdMonthly/Yearly`, `pricePerOrganization/Workspace/User/Candidate`,
`minOrganizations/Workspaces/Users/Candidates`). No new script or migration is
needed; this is a one-time business/data decision, same as the base plan
catalogue itself (`docs/SAAS_MIGRATION_RUNBOOK.md` §1 Phase 5).

**To actually enable this in production, in this order:**
1. Decide final `priceMonthly`/`priceYearly` for every plan that should be
   purchasable, and final per-unit add-on prices/minimum floors for any plan
   that should offer them — via the Plan admin UI/API, same as today.
2. **Lock in pricing before the next step** — a live-mode Razorpay Plan is
   immutable once created (Razorpay has no "edit price" API); changing a
   price after this point means creating a new Razorpay Plan and migrating
   subscribers, not editing the existing one.
3. Run `CREATE_RAZORPAY_PLANS=true npm run bootstrap:plans --workspace server`
   **on production, with production's live `RAZORPAY_KEY_ID`/`KEY_SECRET`**
   (never the `rzp_test_…` keys used in this repo's `.env`). This creates one
   real, permanent Razorpay Plan object per paid plan/interval and writes the
   returned id back onto that `Plan` row — safe to re-run, it only fills in
   whichever of `razorpayPlanIdMonthly`/`Yearly` is still null.
4. Confirm via the Razorpay dashboard (live mode) that the created Plan
   amounts match what was decided in step 1 before advertising checkout for
   that plan.

Nothing above has been run against production — this is prepared guidance
only, pending a deliberate decision on final pricing.

## 4. Remaining / future work

- Per-tenant rate limiting (current limiter is global per-IP).
- tenantId stamped into Socket.IO room authorization and Bull job payloads
  (job payloads are entity-id based and services scope on read, but explicit
  stamping would harden defense-in-depth).
- `NOT NULL` tightening migration for `tenantId` once all write paths are
  confirmed context-covered in production.
- Dunning notifications (PAST_DUE/HALTED emails to the owner) — webhook states
  are tracked; wiring to `notificationService`/`mailerService` is a small add.
- Admin Console System-Config list for brand-new tenants shows only their
  override rows (platform defaults are resolved at read time but not listed);
  a merged list view would improve UX.
- Sidebar navigation link for the Billing page (left out to avoid altering the
  approved navigation design — the page is reachable at `/<role>/billing`).
