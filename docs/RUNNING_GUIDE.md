# AgnoHire Cloud SaaS — Running Guide

How to set up, run, and exercise the multi-tenant SaaS build (tenancy, plans,
quotas, Razorpay billing) locally or on a server. For the migration design and
operations detail, see [SAAS_MIGRATION_RUNBOOK.md](SAAS_MIGRATION_RUNBOOK.md).

---

## 1. Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 20+ | `node -v` |
| Docker Desktop | any recent | runs PostgreSQL 15 + Redis 7 |
| Razorpay account | TEST mode | only needed for paid-plan flows |

## 2. First-time setup

```bash
git clone git@github.com:VarunRK04/AgnoHire_Cloud_Test.git
cd AgnoHire_Cloud_Test

# 1) Environment
cp .env.example .env
# Edit .env and set at minimum:
#   DATABASE_URL, REDIS_URL           (defaults match docker-compose)
#   JWT_SECRET, SESSION_SECRET        (any long random strings)
#   ENCRYPTION_KEY                    (base64 of 32 random bytes, e.g.:
#                                      node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
#   ALLOW_PASSWORD_LOGIN=true         (SaaS email/password login)
# For billing (optional until you test paid plans):
#   RAZORPAY_KEY_ID=rzp_test_...
#   RAZORPAY_KEY_SECRET=...
#   RAZORPAY_WEBHOOK_SECRET=...       (you choose this; must match the dashboard)

# 2) Infrastructure
docker compose up -d          # PostgreSQL + Redis

# 3) Install + build + migrate + seed (existing project setup)
npm run setup
# If setup isn't available or you prefer explicit steps:
#   npm install
#   npm run build --workspace shared
#   npm run prisma:deploy --workspace server    # applies ALL migrations incl.
#                                               # the multi-tenant one (backfill included)
#   npm run prisma:seed --workspace server

# 4) SaaS plan catalogue (REQUIRED once — registration needs the FREE plan)
npm run bootstrap:plans --workspace server
# With Razorpay TEST keys set, also create the matching Razorpay Plans:
#   CREATE_RAZORPAY_PLANS=true npm run bootstrap:plans --workspace server
```

## 3. Run

```bash
npm run dev        # API on http://localhost:4000, SPA on http://localhost:5173
```

Legacy seeded login (Default Tenant): `admin@agnohire.local` / `Admin@12345`.

## 4. Try the SaaS flows

### Create your own tenant (FREE plan)
1. Open `http://localhost:5173/register`.
2. Fill company + owner details, pick **Free**, submit.
3. If SMTP isn't configured, the account is usable immediately — sign in at
   `/login`. (With SMTP configured, click the verification link first.)
4. You land in your own isolated workspace (ADMIN role, tenant owner).

### See usage & billing
- Visit `http://localhost:5173/admin/billing` (or `GET /api/tenant/usage`).
- FREE plan limits: 3 users, 10 interviewed candidates/period, 2 active jobs,
  2 assessments, no AI. Exceeding any returns HTTP **402 QUOTA_EXCEEDED**.

### Invite a teammate
- `POST /api/tenant/invites` `{ "email": "...", "role": "RECRUITER" }`
  (as owner/admin) → invitee opens `/accept-invite?token=...` and sets a password.

### Paid plan with Razorpay (TEST mode)
1. Set the three `RAZORPAY_*` vars, re-run the bootstrap with
   `CREATE_RAZORPAY_PLANS=true`, restart the server.
2. Expose the webhook publicly (e.g. `ngrok http 4000`) and register
   `https://<ngrok-domain>/api/billing/webhook` in the Razorpay dashboard
   (secret = `RAZORPAY_WEBHOOK_SECRET`), subscribing to all `subscription.*`
   events.
3. Register at `/register` choosing **Starter/Pro** → Razorpay Checkout opens →
   pay with Razorpay test card `4111 1111 1111 1111` (any CVV/expiry).
4. The tenant stays PENDING until the `subscription.activated`/`charged`
   webhook arrives — then it's ACTIVE. Checkout success alone never grants access.

### Prove tenant isolation
With the dev server running:
```bash
npm run test --workspace server -- tests/tenantIsolation.test.ts
```
Registers two tenants and asserts neither can see the other's users,
candidates, or jobs. Billing signature unit tests (no server needed):
```bash
npm run test --workspace server -- tests/billingSignatures.test.ts
```

## 5. Key endpoints added by the SaaS build

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/auth/register` | public | create tenant + owner (plan choice) |
| `POST /api/auth/verify-email` | public | activate account from email link |
| `GET /api/billing/config` | public | Razorpay key id + plan catalogue |
| `POST /api/billing/verify` | public | Checkout signature verification |
| `POST /api/billing/webhook` | Razorpay | authoritative subscription state |
| `GET /api/tenant/usage` | user | usage vs plan limits |
| `GET /api/billing/subscription` | owner/admin | plan, usage, invoices |
| `POST /api/billing/change-plan` | owner/admin | upgrade/downgrade |
| `POST /api/billing/cancel` | owner/admin | cancel (at period end or now) |
| `POST /api/tenant/invites` | owner/admin | invite teammate (seat-checked) |
| `POST /api/tenant/invites/accept` | public | accept invite via token |

## 6. Troubleshooting

- **"Unknown or inactive plan" on register** → run `npm run bootstrap:plans`.
- **402 on actions** → plan limit reached or subscription not ACTIVE; check
  `/api/tenant/usage` and `/api/billing/subscription`.
- **Webhook 400 BAD_SIGNATURE** → `RAZORPAY_WEBHOOK_SECRET` doesn't match the
  dashboard value, or a proxy re-encoded the body (must reach the app raw).
- **Paid tenant stuck PENDING** → webhook never arrived; check the ngrok/domain
  URL and the Razorpay dashboard webhook delivery log, then let it retry
  (processing is idempotent).
- **Existing data "missing" for a user** → legacy data belongs to the Default
  Tenant; log in with a Default-Tenant account (e.g. the seeded admin).
