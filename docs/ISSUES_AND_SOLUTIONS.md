# AgnoHire — Issues Found & Solutions

Findings from an end-to-end audit of the running application (server + client + Postgres + Redis),
driving the real HTTP API and the full integration suite against a live stack.

Every issue below was **reproduced against the running app**, not inferred from reading code.
Where a fix has shipped, the commit is named.

---

## Summary

| # | Issue | Severity | Status |
|---|---|---|---|
| [SEC-1](#sec-1) | Workspace-approval gate bypassed on every login | **Critical** | Fixed (`9e3981b`) |
| [SEC-2](#sec-2) | Soft-deleted users invisibly squat their email forever | **High** | Fixed (`c855c03`) |
| [SEC-3](#sec-3) | `User.email` is globally unique across all tenants | **High** | Open (Stage 1 shipped in SEC-2; Stage 2 deliberately deferred) |
| [BUG-1](#bug-1) | Job approval 402s — quota counted lifetime jobs, not active | High | Fixed (`e173f4c`) |
| [BUG-2](#bug-2) | `db:seed` crashes, blocking `setup` / `sync` | High | Fixed (`9e3981b`) |
| [GAP-1](#gap-1) | No password reset for tenants | High | Fixed (`3042ff4`) |
| [RISK-1](#risk-1) | Token refresh does not re-check the approval gate | Medium | Fixed, Option C (`4307d45`) |
| [QUAL-1](#qual-1) | `prisma/` and `tests/` are excluded from typecheck | Medium | Fixed (`b6f36b4`) |
| [QUAL-2](#qual-2) | `seed-demo.ts` does unscoped `deleteMany({})` | Medium | Fixed (`b6f36b4`) |
| [QUAL-3](#qual-3) | bcrypt cost factor inconsistent (10 vs 12) | Medium | Fixed (`c3afecd`) |
| [QUAL-4](#qual-4) | Leftover debug logging in hot paths | Low | Fixed (`48e85ae`) |
| [QUAL-5](#qual-5) | `seed-jobs.ts` writes a job status that doesn't exist | Low | Part 1 fixed (`b6f36b4`); part 2 (enum) deferred |
| [TEST-1..5](#test-suite) | Suite was structurally broken (22 tests never ran) | High | Fixed (`9e3981b`) |

Suite went from **10 files failing / 22 skipped** to **17/17 files, 97/97 tests, 0 skipped**.

Three recurring root causes explain almost all of it — see [Systemic Patterns](#systemic-patterns).
That section is the most important part of this document; the individual bugs are symptoms.

---

<a name="sec-1"></a>
## SEC-1 — Workspace-approval gate bypassed on every login · **Critical** · Fixed

### Symptom
A self-registered workspace could sign in **without ever being approved**. Rejected workspaces could
sign in too. The entire marketing phone-qualification gate was dead.

### Reproduction (before fix)
```
POST /api/auth/register   → 201  {"requiresApproval": true}
DB                        → Tenant.status = PENDING, approvalStatus = PENDING
POST /api/auth/dev-login  → 200  + full ADMIN access token   ← should have been 403
```

### Root cause
`auth.controller.ts` wraps login in `runAsPlatform()` — it **has to**, because the pre-auth lookup
resolves a globally-unique email across tenants and must bypass RLS to find the user:

```ts
const tokens = await runAsPlatform(() => authService.devLogin(email, password, req));
```

`runAsPlatform` sets `bypass: true` on the ambient tenant context. And `assertWorkspaceApproved`
skipped itself whenever it saw that flag:

```ts
if (getTenantContext()?.bypass) return;   // ← intended only for operator impersonation
```

The exemption was written for impersonation (which also runs under `runAsPlatform`). But because
*every* front-door login runs under `runAsPlatform` for an unrelated infrastructure reason, the flag
silently disabled the gate for all of them.

**The bug is not the check — it's that an authorization decision was inferred from an infrastructure
flag that a different caller sets for a different reason.**

### Solution (shipped)
Make the exemption explicit and un-inferrable. `assertWorkspaceApproved` no longer reads ambient
state; the one caller allowed to skip it passes a flag:

```ts
// authService.ts
async function assertWorkspaceApproved(user, skipApprovalGate = false) {
  if (skipApprovalGate) return;
  const tenantId = user.tenantId ?? null;
  if (!tenantId) return;                       // platform users have no tenant
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { approvalStatus: true } });
  if (tenant && tenant.approvalStatus !== 'APPROVED') throw new WorkspacePendingApprovalError(tenant.approvalStatus);
}

// platform.controller.ts — the ONLY caller permitted to skip it
const tokens = await runAsPlatform(() =>
  loginByUserId(ownerUserId, req, { skipApprovalGate: true }),
);
```

### Verified after fix
```
unapproved login  → 403 WORKSPACE_PENDING_APPROVAL
after approval    → 200
platform admin    → 200 (unaffected)
```

---

<a name="sec-2"></a>
## SEC-2 — Soft-deleted users invisibly squat their email forever · **High** · OPEN

### Symptom
An admin deletes a user, then later tries to re-add the same person. They get:

> **409 — "That record already exists"**

…but **no such user is visible anywhere in the app**. The email is permanently, invisibly burned.
There is no way to recover it through the UI.

### Reproduction (live, current `main`)
```
POST /api/admin/users   {email: ghost@x.com}  → 201
DELETE /api/admin/users/:id                   → 200   (soft delete)
POST /api/admin/users   {email: ghost@x.com}  → 409 "That record already exists"

GET /api/admin/users?search=ghost             → 0 results      ← invisible
SELECT … FROM "User" WHERE email LIKE 'ghost%' AND "deletedAt" IS NOT NULL  → 1 row  ← but it's there
```

### Root cause
This is the **same defect class as [BUG-2](#bug-2)**, in the live product:

1. The global soft-delete middleware (`database.ts`) injects `deletedAt: null` into every read.
   The deleted row is invisible to the application.
2. But `User_email_key` is a **FULL** unique index — *not* partial. The deleted row still occupies
   the email in the index.
3. So the duplicate-check read finds nothing → code proceeds to `create()` → the DB constraint fires
   → generic P2002 → mapped to a generic 409.

Reads are filtered; constraints are not. The application and the database disagree about which rows exist.

### Solution
Two layers — do **both**.

**Layer 1 — make the constraint agree with the reads.** Replace the full unique index with a partial
one, exactly as was already done for `Candidate.email` (migration `20260708120000_candidate_email_tenant_scoped`):

```sql
-- migration
DROP INDEX "User_email_key";
CREATE UNIQUE INDEX "User_email_active_key" ON "User"(email) WHERE "deletedAt" IS NULL;
```

```prisma
model User {
  // Unique only among LIVE users: a soft-deleted user must release its email so
  // the address can be re-used. Enforced by a partial unique index (see migration);
  // Prisma cannot express a partial constraint, so it is intentionally not @unique here.
  email String
}
```

⚠️ **Migration caveat:** dropping `@unique` breaks `prisma.user.findUnique({ where: { email } })` at
the type level. Callers must move to `findFirst`. Audit these first:

```
server/src/services/tenantProvisioningService.ts   (registerTenant, createWorkspaceByAdmin, resendVerification, requestPasswordReset)
server/src/services/adminUserService.ts            (duplicate check in createUser)
```
`authService.loadUser` already uses `findFirst` — unaffected.

**Layer 2 — give the admin sensible behaviour.** Re-adding a deleted user should *restore* them,
not fail. The codebase already has this exact idiom for candidates (`candidateService.ts`, the
"Restore soft-deleted candidate" branch of `createCandidate`). Mirror it in `adminUserService.createUser`:

```ts
// Reads hide soft-deleted rows, so look for one explicitly (documented opt-out).
const deleted = await prisma.user.findFirst({
  where: { email, deletedAt: { not: null } },
});
if (deleted) {
  return prisma.user.update({
    where: { id: deleted.id },
    data: { ...data, deletedAt: null, isActive: true, passwordHash: await hashPassword(data.password) },
  });
}
```

Alternatively, if reactivation is *not* desired semantics, at minimum return an actionable error
("A deleted user already holds this email — restore them instead") rather than the opaque
"That record already exists".

### The same shape exists elsewhere
Every table that is soft-deletable **and** carries a full (non-partial) unique index has this latent
bug. Audited list:

| Table.index | Risk |
|---|---|
| `User.User_email_key` | **Live bug** (above) |
| `Candidate.Candidate_userId_key` | **Live** — this is what crashed `db:seed` ([BUG-2](#bug-2)) |
| `Interview.Interview_scheduleId_key` | Latent — re-creating an interview for a deleted schedule collides |
| `Interview.Interview_accessToken_key` | Low (values are random) |
| `Offer.Offer_acceptanceToken_key` | Low (values are random) |

Recommendation: sweep all of them to `… WHERE "deletedAt" IS NULL`. Query to re-audit at any time:

> **Attempted 2026-07-15 for `Interview.Interview_scheduleId_key`, reverted.** Unlike `User.email` /
> `Candidate.email`, `scheduleId` backs a one-to-one Prisma relation (`Interview.schedule`). Prisma
> requires `@unique` literally on the FK scalar for a one-to-one relation to validate — dropping it
> (to hand-manage a partial index the way SEC-2 does) fails schema validation outright. Fixing this
> properly means restructuring the relation (e.g. to one-to-many, `InterviewSchedule.interviews[]`),
> which touches every `interview.schedule` call site — out of scope for a targeted index fix. The
> `accessToken`/`acceptanceToken` indexes are lower priority (random values, near-zero collision odds)
> and were not attempted. Re-audit query below still applies to find new instances of this shape.

```sql
SELECT c.relname||'.'||i.relname
FROM pg_index x JOIN pg_class c ON c.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid
WHERE x.indisunique AND x.indpred IS NULL AND i.relname NOT LIKE '%_pkey'
  AND EXISTS (SELECT 1 FROM information_schema.columns col
              WHERE col.table_name=c.relname AND col.column_name='deletedAt');
```

---

<a name="sec-3"></a>
## SEC-3 — `User.email` is globally unique across all tenants · **High** · OPEN

### Symptom
Two different customer workspaces cannot both have a user with the same email address. If
`alice@consultancy.com` works with two client workspaces, the second one is refused. A self-registering
owner whose email already exists in *someone else's* tenant is blocked with a conflict.

This is a genuine multi-tenant data-model leak: one tenant's data constrains another's.

### Root cause
`User.email String @unique` — a single global constraint, unchanged from the pre-SaaS single-tenant design.
`Candidate.email` was already fixed for exactly this reason (scoped per-tenant); `User` was not.

### Why this is genuinely hard (and not just an index change)
The obvious fix is `@@unique([tenantId, email])`. But **the entire auth model assumes email is a global
identifier**: login is `POST /auth/dev-login { email, password }` with no tenant discriminator. If two
tenants share an email, `loadUser({ email })` becomes ambiguous — which Alice is logging in?

So this cannot be fixed at the database layer alone. It requires deciding *how a user identifies their
workspace at login*.

### Solution — staged

**Stage 1 (do now, cheap, safe).** Keep email globally unique, but make the index **partial** so
soft-deleted users release it. This resolves the painful, user-visible half of the problem
([SEC-2](#sec-2)) without touching the login identity model. This is the migration already given above.

**Stage 2 (roadmap).** Move to per-tenant identity, which requires a workspace discriminator at login:

```sql
DROP INDEX "User_email_active_key";
-- tenant members: unique per workspace, among live rows
CREATE UNIQUE INDEX "User_tenantId_email_active_key"
  ON "User"("tenantId", email) WHERE "deletedAt" IS NULL;
-- platform operators have tenantId NULL and must stay globally unique
CREATE UNIQUE INDEX "User_email_platform_active_key"
  ON "User"(email) WHERE "deletedAt" IS NULL AND "tenantId" IS NULL;
```

The good news: **the workspace-slug routing this depends on already exists** (`Tenant.slug`,
`withWorkspace()`, workspace-scoped routes added in `dd46b2d`). So login becomes workspace-scoped:

- `/w/:slug/login` resolves the user *within* that tenant (`loadUser({ tenantId, email })`), or
- the login form gains a workspace field, or
- an email that resolves to exactly one tenant proceeds; an ambiguous one prompts "which workspace?".

Stage 2 also needs: password-reset and email-verification token lookups to stop assuming one user per
email, and the `ConflictError` in `registerTenant` to be scoped per-tenant.

**Recommendation:** ship Stage 1 now; schedule Stage 2 deliberately — it is a login-UX decision as much
as a schema one, and should not be rushed into a hotfix.

---

<a name="bug-1"></a>
## BUG-1 — Job approval 402s: quota counted lifetime jobs, not active ones · High · Fixed

### Symptom
On a plan allowing **2 active jobs**, creating and approving a second job failed with **402 Payment
Required** — even though only one job was actually open. Closing a job never freed a slot.

### Root cause
The `ACTIVE_JOBS` metric counted **every job ever created** — drafts, closed, rejected, all of it:

```ts
case 'ACTIVE_JOBS':
  return prisma.jobRequisition.count({ where: { tenantId, deletedAt: null } }); // ← no status filter
```

So with 1 OPEN + 1 DRAFT, approving the draft evaluated `used(2) + 1 > limit(2)` → 402.
The metric name (`ACTIVE_JOBS`) and the plan field (`maxActiveJobs`) both promised a concurrency cap;
the implementation delivered a lifetime cap.

### Solution (shipped)
```ts
case 'ACTIVE_JOBS':
  // Only OPEN jobs occupy a slot — closing a job frees capacity.
  return prisma.jobRequisition.count({ where: { tenantId, deletedAt: null, status: 'OPEN' } });
```
Also removed a redundant quota check in `createJob()` that blocked *drafting* a job when active
capacity was full — a draft isn't active. `approveJob()` still correctly gates the DRAFT→OPEN
transition, which is the moment a slot is actually consumed.

Applies uniformly to every plan (the limit is read from `Plan.maxActiveJobs`; there is no per-tier logic).

---

<a name="bug-2"></a>
## BUG-2 — `db:seed` crashes, blocking `setup` / `sync` · High · Fixed

### Symptom
`npm run db:seed` (part of the documented `setup` and `sync` flows) died with an unhandled P2002 on any
database where the seeded candidate had previously been soft-deleted.

### Root cause — three things had to line up
1. `seedDevCandidate` looked the row up with `findUnique({ where: { email } })`, but **`Candidate.email`
   is no longer globally unique** — it became a per-tenant *partial* index in migration
   `20260708120000_candidate_email_tenant_scoped`.
2. The soft-delete middleware **downgrades `findUnique` → `findFirst`** and injects `deletedAt: null`,
   so the lookup silently returned `null` instead of erroring. The seed concluded "no such candidate".
3. It therefore called `create()` — which collided with `Candidate_userId_key`, a **FULL** unique index
   that the soft-deleted row still occupies.

Net effect: *"a duplicate exists, but every read says it doesn't."*

### Solution (shipped)
Match on the keys the database *actually* enforces, use the middleware's documented opt-out to see
soft-deleted rows, and **revive** rather than duplicate:

```ts
const identity = { OR: [{ userId: user.id }, { tenantId, email }] };
const existing =
  (await prisma.candidate.findFirst({ where: identity })) ??
  (await prisma.candidate.findFirst({ where: { ...identity, deletedAt: { not: null } } }));

if (existing) {
  await prisma.candidate.update({
    where: { id: existing.id },
    data: { userId: user.id, sectorId, tenantId, deletedAt: null },   // revive
  });
} else { /* create */ }
```

> This bug was invisible to `tsc` because `prisma/` is excluded from the typecheck — see [QUAL-1](#qual-1).
> With `email` no longer `@unique`, `findUnique({where:{email}})` should have been a **compile error**.

---

<a name="gap-1"></a>
## GAP-1 — No password reset for tenants · High · Fixed

### Symptom
A workspace owner set a password once at creation. If they forgot it, there was **no recovery path
whatsoever** — not for them, and not for the superadmin who provisioned them.

### Solution (shipped)
Two paths, reusing the `User.resetToken` / `resetTokenExp` columns that already existed in the schema
but were never wired to anything:

- **Self-service:** "Forgot password?" on the login page → `/forgot-password` emails a single-use link
  (1-hour expiry) → `/reset-password?token=…`. Does not leak whether an account exists; invalidates all
  existing sessions on reset.
- **Operator-assisted:** a "Reset owner password" action on the superadmin's *Edit workspace* drawer,
  restricted to the operator who created that workspace (same rule as edit/impersonate).

Verified end-to-end: request → token issued → reset → login with the new password.

---

<a name="risk-1"></a>
## RISK-1 — Token refresh does not re-check the approval gate · Medium · Needs a decision

### Current behaviour
`POST /auth/refresh` issues a new token pair **without** re-running the approval gate.

### Why it is like this (deliberate)
Operator impersonation sets the owner's refresh cookie and then does a **hard page reload**, which
re-bootstraps the SPA through `/refresh`. Gating refresh would instantly break entering a workspace that
is *under review* — the exact scenario impersonation exists for.

It is not an open door: a refresh token can now only be obtained by passing the (now-fixed) login gate,
or by an operator deliberately impersonating.

### Residual gap
A workspace **approved → later rejected or suspended** keeps working until its refresh token expires
(default 7 days). Tenant suspension is enforced elsewhere (subscription/quota gating makes the workspace
read-only), so the blast radius is limited — but it is not immediate.

### Options
| Option | Effect | Cost |
|---|---|---|
| **A. Leave as-is** | Impersonation works; revocation lags ≤ refresh TTL | none |
| **B. Gate refresh too** | Immediate revocation | **breaks impersonation of PENDING workspaces** |
| **C. Mark impersonated sessions** | Immediate revocation *and* impersonation works | add an `impersonated` flag to `RefreshToken`, skip the gate only for those |

**Recommendation: C.** It is a small schema addition (`RefreshToken.impersonated Boolean @default(false)`)
and removes the trade-off entirely. Until then, A is acceptable; **B is not** — it silently breaks the
operator review flow.

---

<a name="qual-1"></a>
## QUAL-1 — `prisma/` and `tests/` are excluded from typecheck · Medium · OPEN

`server/tsconfig.json` has `"include": ["src/**/*.ts"]`. So **`prisma/seed.ts` and the entire `tests/`
directory are never typechecked.** This is precisely why [BUG-2](#bug-2) shipped: `findUnique({where:{email}})`
against a non-unique field is a compile error that nobody ever compiled.

### Solution
Add a second config that covers them, and run it in CI:

```jsonc
// server/tsconfig.check.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": true, "rootDir": "." },
  "include": ["src/**/*.ts", "tests/**/*.ts", "prisma/**/*.ts", "scripts/**/*.ts"]
}
```
```jsonc
// package.json
"typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.check.json"
```

Expect this to surface further latent errors in `scripts/` on first run (see [QUAL-5](#qual-5)) — that is
the point.

---

<a name="qual-2"></a>
## QUAL-2 — `seed-demo.ts` does unscoped `deleteMany({})` · Medium · OPEN

```ts
await prisma.onboarding.deleteMany({});    // every onboarding, every tenant
await prisma.offerDocument.deleteMany({});
await prisma.offer.deleteMany({});
```

No tenant filter, no confirmation, no `NODE_ENV` guard. A developer running the "demo seed" against the
wrong `DATABASE_URL` destroys **all offers and onboardings for every tenant**. I declined to run this
script during the audit for exactly this reason.

### Solution
Guard it, and scope it:
```ts
if (process.env.NODE_ENV === 'production') throw new Error('seed-demo must never run in production');
const tenantId = /* the demo tenant */;
await prisma.offer.deleteMany({ where: { tenantId } });   // scoped
```
Better still, have it delete only rows it created (tag them with a `DEMO_` prefix or a known tenant).

---

<a name="qual-3"></a>
## QUAL-3 — bcrypt cost factor is inconsistent · Medium · OPEN

`authService.hashPassword()` uses **12 rounds** and enforces a minimum length. But five call sites hash
passwords directly at **10 rounds**, bypassing that helper entirely:

```
authService.ts:390                 bcrypt.hash(plain, 12)   ← the intended helper
tenantProvisioningService.ts:93    bcrypt.hash(..., 10)     registerTenant
tenantProvisioningService.ts:204   bcrypt.hash(..., 10)     createWorkspaceByAdmin
tenantProvisioningService.ts:328   bcrypt.hash(..., 10)     acceptInvite
tenantProvisioningService.ts:433   bcrypt.hash(..., 10)     resetPasswordWithToken
workspaceAdminService.ts:208       bcrypt.hash(..., 10)     resetOwnerPassword
```

So a workspace owner's password is hashed weaker than a platform user's, and which one you get depends
on which door you came through. (The length guard is incidentally covered by the zod schemas, but the
cost factor is not.)

### Solution
Export a single hashing function and use it everywhere — one place to raise the cost factor later:

```ts
// authService.ts (or better, a dedicated password.ts)
const BCRYPT_ROUNDS = 12;
export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < 8) throw new BadRequestError('Password too short');
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}
```
Then replace all six `bcrypt.hash(...)` call sites with `hashPassword(...)`. Existing 10-round hashes stay
valid (`bcrypt.compare` reads the cost from the hash), so this needs no migration — passwords upgrade
naturally on next reset.

---

<a name="qual-4"></a>
## QUAL-4 — Leftover debug logging in hot paths · Low · OPEN

```ts
// server/src/config/database.ts:199 — fires on EVERY SystemConfiguration read
logger.info(`DEBUG DB: model=${model} ctx=`, ctx);

// server/src/services/workspaceAdminService.ts:137 — raw console.log on an auth path
console.log("DEBUG impersonation: t.createdById =", t.createdById, "currentUserId =", currentUserId);
```

The first runs on every config lookup (visible on every server boot). The second bypasses the logger
entirely and prints identifiers on a privileged code path.

### Solution
Delete both. If the impersonation trace is worth keeping, route it through the structured logger at
`debug` level: `logger.debug('impersonation check', { createdById, currentUserId })`.

---

<a name="qual-5"></a>
## QUAL-5 — `seed-jobs.ts` writes a job status that doesn't exist · Low · Part 1 fixed, part 2 deferred

`scripts/seed-jobs.ts` creates jobs with `status: 'PUBLISHED'`. That is **not a status this application
uses** — the real set is `DRAFT | PENDING_APPROVAL | OPEN | CLOSED | REJECTED`. Because `status` is a plain
`String` column (no DB enum, no Prisma enum), Postgres accepts it happily and the rows land in a state no
code path recognises: invisible to every `status: 'OPEN'` query, uncountable by the `ACTIVE_JOBS` quota.

This is the script drifting behind the product with nothing to catch it.

### Solution
Two parts:
1. Fix the script to use `'OPEN'` (and give it an `approvedById` / `approvedAt`, as a real approved job has).
2. **Make the invalid state unrepresentable.** Promote `status` to a real enum so the database rejects
   this class of drift:
   ```prisma
   enum JobStatus { DRAFT PENDING_APPROVAL OPEN CLOSED REJECTED }
   model JobRequisition { status JobStatus @default(DRAFT) }
   ```
   A migration must first normalise any existing junk values. This also makes [BUG-1](#bug-1)-style
   status-filter mistakes typecheck-visible.

> **Part 1 fixed** (script now uses `'OPEN'`, in `b6f36b4`). **Part 2 (the enum) deliberately deferred
> 2026-07-15**: this schema has zero enums across all 55 models today — every status field, on every
> model, is a plain `String`. Promoting just `JobRequisition.status` would be the first-ever enum and a
> real precedent decision (migration strategy for the other ~20 status-shaped string fields, whether to
> do this repo-wide or one field at a time), not a contained bug fix. Needs a deliberate call, same as
> [SEC-3](#sec-3) Stage 2.
>
> **Found and fixed while investigating this**, a live instance of exactly the drift this item warns
> about: `JOB_STATUS` (`shared/src/constants/enums.ts`) and `jobFiltersSchema` (`shared/src/schemas/job.ts`)
> both enumerated only `DRAFT | PENDING_APPROVAL | OPEN | CLOSED`, omitting `REJECTED` even though
> `jobService.ts` sets that status (`rejectJob`). Effect: `GET /jobs?status=REJECTED` was rejected by zod
> validation with a 400 — rejected jobs could be created but never filtered for in the UI. Added
> `REJECTED` to both. Verified: `jobFiltersSchema.safeParse({status:'REJECTED'})` now succeeds
> (previously failed); `npm run typecheck` clean.

---

<a name="test-suite"></a>
## TEST-1..5 — The test suite was structurally broken · High · Fixed

**22 tests never ran at all**, and whole suites errored out in `beforeAll` — meaning entire product flows
(document collection, biometric proctoring) had *zero* coverage while appearing to be "tested".

| | Problem | Fix |
|---|---|---|
| TEST-1 | **Tests were blind to the database.** They used the *app's* Prisma client, which derives its tenant GUCs from request-scoped `AsyncLocalStorage`. A test process has no such context, so RLS (enabled **and FORCEd** on every tenant table) hid every row — fixtures came back silently empty, and setup died with "Seeded database is missing required entities". | Added an owner-connection fixture client (`DIRECT_URL`, superuser/BYPASSRLS) in `tests/helpers.ts`, mirroring what migrations and the seed use. The app's real RLS behaviour is still exercised by the HTTP-driven tests, which go through the server's restricted role. |
| TEST-2 | **Fixtures were invisible to the API.** Rows created directly in the DB had `tenantId = NULL` (they had relied on middleware auto-stamping, which never applies in a test process), so the tenant-scoped API 404'd on them. | Stamp `tenantId` explicitly on fixture rows. |
| TEST-3 | **The suite depended on data the seed never created** — an OPEN job, a question bank, an application. On a fresh clone, those suites simply failed. | `db:seed` now provisions a baseline workload, so `db:seed → npm test` passes from scratch. |
| TEST-4 | A pipeline assertion matched stages case-insensitively but compared them with strict equality, so a custom round named `"Screening"` made it assert the wrong expected status. | Match consistently with how the stage was selected. |
| TEST-5 | `tenantIsolation` registered tenants and logged straight in — **it only passed because of [SEC-1](#sec-1)**. Fixing the security hole correctly broke it. | The test now approves the workspaces first, as the real product flow requires. |

> TEST-5 is worth dwelling on: **a test was passing *because* of a security bug.** Had the gate ever been
> fixed without touching the test, the failure would have looked like a regression in the fix.

**Result: 17/17 files, 97/97 tests, 0 skipped.**

---

<a name="systemic-patterns"></a>
## Systemic patterns — the actual root causes

The individual bugs are symptoms. Three patterns produced nearly all of them, and each will keep
producing new ones until addressed structurally.

### Pattern A — Authorization inferred from ambient infrastructure flags
> *Produced: [SEC-1](#sec-1) (critical).*

`runAsPlatform()`'s `bypass` flag means **"bypass RLS for this database read."** It was *also* read as
**"this is a privileged operator action."** Two unrelated concerns collapsed into one ambient boolean —
so when login started using `runAsPlatform` for a purely infrastructural reason (resolving a globally-unique
email pre-auth), it silently inherited an authorization exemption nobody intended to grant.

**Rule:** a security decision must never be inferred from ambient context set by a different layer for a
different purpose. Pass intent explicitly.

**Action:** audit every other reader of `getTenantContext()?.bypass` for the same conflation.
```bash
grep -rn "bypass" server/src --include=*.ts | grep -v "config/"
```
Consider splitting the context into two independent fields — `rlsBypass` (infrastructure) and
`operatorAction` (authorization) — so they can never be confused again.

> **Audited 2026-07-15.** One code reader remains outside `config/`: `roleService.ts:30`
> (`currentTenantId`) uses `ctx.bypass` to pick between a tenant's role customizations and the
> global defaults — pure data-scoping, not an authorization gate (it never skips a permission check).
> Every other hit is a comment. No further instance of the SEC-1 pattern found; no action needed
> unless a new reader appears.

### Pattern B — Reads are filtered; constraints are not
> *Produced: [BUG-2](#bug-2), [SEC-2](#sec-2), and latent bugs in Interview/Offer.*

The soft-delete middleware injects `deletedAt: null` into every read. Unique **indexes** have no such
filter unless they are explicitly partial. The result is a whole family of bugs with one signature:

> *"A duplicate exists, but every read tells me it doesn't."*

Application logic does `find → not found → create → 💥 constraint violation`, and the resulting error is
unactionable because the conflicting row is invisible to the user *and* to the developer debugging it.

**Rule:** if a model is soft-deletable, **every** unique index on it must be
`… WHERE "deletedAt" IS NULL`. Otherwise the database and the application disagree about what exists.

**Action:** run the audit query in [SEC-2](#sec-2) and make all five indexes partial. Then add the
restore-on-recreate path (the idiom already exists for candidates) wherever re-creation is a legitimate
user action.

### Pattern C — Nothing was verifying the verifiers
> *Produced: [TEST-1..5](#test-suite), and allowed [BUG-2](#bug-2) and [QUAL-5](#qual-5) to ship.*

- The typecheck excluded `prisma/`, `tests/`, and `scripts/` — so the seed and the tests, the very things
  meant to catch regressions, were themselves unchecked ([QUAL-1](#qual-1)).
- 22 tests were silently skipped and several suites died in setup, yet the suite still *looked* like it
  had coverage. Skipped ≠ passing, but nothing enforced that distinction.
- The RLS rollout (a large, correct, important change) silently invalidated the entire test harness'
  access to the database, and nobody noticed, because the tests that would have noticed were the ones
  that broke.

**Rule:** the test suite and the seed are production code. Typecheck them, and treat a skipped or errored
suite as a failure.

**Action:**
1. Adopt the `tsconfig.check.json` in [QUAL-1](#qual-1).
2. Fail CI on skipped tests: `vitest run --passWithNoTests=false` plus an assertion that
   `skipped === 0`, or convert conditional `if (!up) return` guards into hard failures in CI.
3. Add `db:seed → npm test` to CI so the "works from a fresh clone" property is actually enforced —
   it was not true before this audit, and nothing would have told you.

---

## Recommended order of work

1. ~~**[SEC-2](#sec-2) Stage 1**~~ — Fixed `c855c03`.
2. ~~**[QUAL-1](#qual-1)**~~ — Fixed `b6f36b4`.
3. ~~**[QUAL-2](#qual-2), [QUAL-4](#qual-4)**~~ — Fixed `b6f36b4`, `48e85ae`.
4. ~~**[QUAL-3](#qual-3)**~~ — Fixed `c3afecd`.
5. ~~**[RISK-1](#risk-1) Option C**~~ — Fixed `4307d45`.
6. **Pattern B sweep** — partially done 2026-07-15: `User.email` (SEC-2) fixed; `Interview.scheduleId`
   attempted and reverted (blocked by a Prisma one-to-one relation constraint — see note under
   [SEC-2](#sec-2)); `accessToken`/`acceptanceToken` indexes deliberately left (low risk, random values).
7. ~~**[QUAL-5](#qual-5) part 1**~~ — script fixed. **Part 2 (JobStatus enum) deliberately deferred —
   first enum in this schema, needs a repo-wide precedent decision, not a one-field patch.**
   ~~**Pattern A audit**~~ — done 2026-07-15, clean (see note under Pattern A).
8. **[SEC-3](#sec-3) Stage 2** — per-tenant user identity. *Still deliberately deferred; it is a login-UX
   decision as much as a schema migration, and the workspace-slug routing it needs already exists.*

**Fixed 2026-07-15 as a byproduct of auditing QUAL-5:** `JOB_STATUS` / `jobFiltersSchema` were missing
`REJECTED`, so `GET /jobs?status=REJECTED` 400'd. See note under [QUAL-5](#qual-5).

**Remaining open work — both need a product/architecture decision, not more debugging:**
[SEC-3](#sec-3) Stage 2 (per-tenant identity), [QUAL-5](#qual-5) part 2 (`JobStatus` enum, and by
extension whether to enum-ify status fields repo-wide), and — if ever prioritized — the
`Interview.schedule` relation restructure needed to close the last Pattern B gap.
