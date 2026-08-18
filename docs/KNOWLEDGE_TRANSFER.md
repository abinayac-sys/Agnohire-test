# AgnoHire — Knowledge Transfer

_Compiled 2026-07-15 from the working repo, `docs/ISSUES_AND_SOLUTIONS.md`, and this engagement's session history._

An enterprise ATS + AI interview platform: one system of record for jobs, candidates,
AI-proctored interviews, assessments, scheduling, offers, and compliance. Multi-tenant —
each customer is a `Tenant` with its own workspace slug.

| | |
|---|---|
| Branch | `main` |
| Remote | `cloudtest` |
| HEAD | `51776ae` |
| Stack | Node 20 · PostgreSQL 15 · Redis 7 · React 18 |

---

## 1. Overview

Modular-monolith ATS covering the full hiring lifecycle: requisition → sourcing → AI
interview → assessment → panel review → offer → onboarding, plus the admin/GDPR/compliance
tooling a real SaaS needs.

**Key stats:** 55 Prisma models · 42 domain services · 14 functional modules · 80+
permissions · 38 migrations.

**Design principle — zero hardcoded config.** Infra secrets (DB/Redis URLs, JWT/encryption
keys, OAuth) live in `.env`. Everything else — SMTP, AI keys, rate limits, themes,
permissions — lives in the DB (`SystemConfiguration`, `Integration`, `Theme`) and is editable
from the Admin Console with no redeploy.

**Design principle — fail-closed multi-tenancy.** A Prisma middleware choke-point
auto-scopes reads/writes by `tenantId`, backed by Postgres Row-Level Security enabled and
**forced** on every tenant table. A principal with no resolvable tenant matches nothing —
never everything.

---

## 2. Architecture

Modular monolith, not microservices: one deployable API process, services called in-process
(not over the network), transactional integrity, simple ops.

```
React SPA (Vite)
  staff portal · candidate portal · public token pages
        │  REST + WebSocket
        ▼
Express API
  25 route groups → 23 controllers → 42 services · RBAC · Zod · Socket.IO
        │
        ├──▶ PostgreSQL 15   — 55 models, RLS forced, blobs in-DB
        ├──▶ Redis 7          — Bull queues, rate limit, session revoke
        └──▶ AI endpoint      — OpenAI-compatible (Gemini/Azure/local GW)
```

### Request path

```
Helmet + CORS + cookies + morgan
  → rate limiter (Redis-backed, /api scope)
  → route → controller
  → authenticate (JWT) → requirePermission/requireRole → Zod validate
  → tenantTransaction (stamps app.tenant_id GUC for RLS)
  → service(s): business logic + Prisma
  → audit log (on mutation)
  → { success, data } / { success: false, error }
```

### Frontend layout

| Path | Contains |
|---|---|
| `App.tsx` | Route tree — role-scoped staff area, candidate portal, public token pages |
| `layouts/` | `AppLayout` — sidebar + shell, mounted per role under `/:workspaceSlug/:roleBase/...` |
| `pages/` | One folder per module (jobs, candidates, interviews, sourcing, admin…) |
| `services/` | One API client per domain, thin axios wrappers over `@agnohire/shared` types |
| `store/` | Zustand — auth/session identity only; TanStack Query owns remote data |

---

## 3. Data model (55 models, by domain)

| Domain | Models |
|---|---|
| Identity & tenancy | User, Role, Permission, TenantRolePermission, Tenant, RefreshToken, OAuthAccount |
| Jobs & candidates | JobRequisition, Candidate, Resume (bytes in-DB), JobApplication, ApprovalWorkflow |
| Interviews | Interview, InterviewSchedule, Question(Bank), CandidateAnswer, ProctorShot, InterviewFeedback |
| Assessments | Assessment, AssessmentQuestion, AssessmentAssignment, AssessmentAnswer |
| Pipeline & sourcing | CandidateList(Item), SourcingChannel, Referral, CandidateAssignment |
| Offers | Offer, OfferDocument, Onboarding (1:1 with Offer) |
| Platform | SystemConfiguration, Integration (encrypted), Notification, EmailTemplate, Attachment |
| Compliance | AuditLog (append-only), GdprRequest, DataRetentionPolicy |
| Analytics | AnalyticsSnapshot, WebhookLog, RecruiterSkill |

### Conventions worth knowing

- Binary blobs (resumes, proctor shots, attachments) live in Postgres, not object storage —
  zero external deps, transactional, simple backup, but a scale-later decision.
- Soft-delete via a global Prisma middleware — `deletedAt` is auto-injected into every read.
  **Reads are filtered; unique indexes are not**, unless declared partial — this exact gap
  caused two real bugs this pass (see [Security audit](#5-security-audit-2026-07-08--07-15)).
- Row-Level Security is enabled *and forced* on all 31 tenant-scoped models. The app connects
  as a restricted `agnohire_app` role (NOSUPERUSER NOBYPASSRLS); migrations run as the owner
  role via `DIRECT_URL`.

---

## 4. Auth & tenancy

### Roles & permissions

7 roles (`SUPERADMIN`, `ADMIN`, `HR`, `RECRUITER`, `HIRING_MANAGER`, `PANEL_MEMBER`,
`CANDIDATE`, plus SaaS-era `TENANT_OWNER` and `PLATFORM_SUPERADMIN`) gate 80+ granular
permissions. Role/Permission rows are global by design (shared catalogue), but a tenant can
override its own effective permission set per role via `TenantRolePermission` — presence of a
row means "this tenant customized this role"; absence means "use the global default."
Resolved once at login/refresh and baked into the JWT.

### Tenant identity

`User.email` is intentionally global-unique (one person = one platform login, not
per-workspace identity) — a deliberate call, not a bug; see [Open items](#7-open-items) for
the staged alternative. `Candidate.email` is per-tenant partial-unique. A Prisma client
extension stamps `app.tenant_id`/`app.bypass` Postgres GUCs per request (via
`AsyncLocalStorage`), which RLS policies read directly — the two layers (app-level scoping,
DB-level enforcement) are independent by design.

---

## 5. Modules (14 functional areas, all shipped)

| # | Module | Highlights |
|---|---|---|
| 01 | Job requisition & JD | Approval workflow, AI JD generation, headcount tracking |
| 02 | Resume & screening | AI parsing (PDF/DOCX/OCR), fit scoring, bulk CSV import |
| 03 | Sourcing | Internal search, referrals, curated & bulk-import lists |
| 04 | AI interview engine | Question generation, live proctoring, face detection, violation tracking |
| 05 | Scheduling | Availability matching, Google Calendar sync, reminders |
| 06 | Assessments | MCQ + coding (Judge0), auto-scoring |
| 07 | Analytics | Funnel/KPIs, AI narrative insights, CSV export |
| 08 | Video intelligence | Whisper transcription, filler-word/WPM metrics, AI sentiment |
| 09 | ATS pipeline | Kanban, live Socket.IO board updates |
| 10 | Hiring panel | Structured feedback, consensus scoring |
| 11 | Offers & onboarding | PDF offer letters, e-sign path, public accept page |
| 12 | AI chatbot | FAQ match → OpenAI fallback → canned response |
| 13 | Security & GDPR | Audit log, access/erasure/portability rights |
| 14 | Admin console | Users, roles, sectors, config, integrations, themes |

---

## 6. Security audit (2026-07-08 → 07-15)

Full findings live in `docs/ISSUES_AND_SOLUTIONS.md` — every issue below was reproduced
against the running app, not inferred from reading code. Two systemic patterns explain almost
all of it.

### Pattern A — authorization inferred from infrastructure flags

Root cause of SEC-1 (critical, fixed pre-engagement): `runAsPlatform`'s `bypass` flag means
"skip RLS," but was also read as "this is a privileged action" — so every login inheriting it
for an unrelated reason silently disabled the approval gate. Re-audited this pass: one
remaining reader outside `config/`, and it's legitimate data-scoping, not authorization.
Clean.

### Pattern B — reads are filtered, constraints are not

Soft-delete middleware injects `deletedAt: null` into reads; unique *indexes* don't get the
same filter unless declared partial. Signature: "a duplicate exists, but every read says it
doesn't." Root-caused SEC-2 and a latent bug on `Interview.scheduleId` (fix attempted,
blocked by a Prisma one-to-one relation constraint — documented as deferred, not silently
dropped).

### What shipped this pass

**SEC-2 (High) — soft-deleted emails permanently blocked re-registration** · `c855c03`
Deleting a user then re-adding the same email 409'd forever, invisibly — `User_email_key` was
a full unique index over soft-deleted rows. Fixed with a partial index (live among
`deletedAt IS NULL` rows) plus restore-on-recreate, mirroring the existing `Candidate.email`
pattern.

**RISK-1 (Medium) — token refresh never re-checked the approval gate** · `4307d45`
`/auth/refresh` hard-coded the approval-gate skip so impersonation could re-bootstrap the
SPA — which meant a workspace rejected or suspended *after* login kept renewing sessions for
up to 7 days. Fixed with Option C: an explicit `RefreshToken.impersonated` flag, so normal
sessions re-gate on every rotation and impersonated ones still work. Also closed two adjacent
holes: fail-open on a missing tenant row, and suspension not blocking auth at all.

**QUAL-1 / QUAL-2 — typecheck the safety net, remove the footgun** · `b6f36b4`
`tsconfig.json` excluded `prisma/`, `tests/`, `scripts/` — exactly why a since-fixed seed bug
shipped uncaught. Added a second tsconfig covering them. Also removed an unscoped
`deleteMany({})` in the demo seed that could wipe every tenant's offers/onboardings against
the wrong `DATABASE_URL`.

**QUAL-3 — inconsistent bcrypt cost factor** · `c3afecd`
Five call sites hashed passwords at 10 rounds directly, bypassing the intended 12-round
`hashPassword()` helper — so which strength you got depended on which door you registered
through. Unified behind one exported function.

### Status of every finding

| ID | Issue | Status |
|---|---|---|
| SEC-1 | Workspace-approval gate bypassed on every login | ✅ fixed |
| SEC-2 | Soft-deleted users invisibly squat their email | ✅ fixed |
| SEC-3 | `User.email` globally unique across tenants | 🟡 Stage 1 shipped, Stage 2 deferred |
| RISK-1 | Refresh doesn't re-check approval gate | ✅ fixed (Option C) |
| QUAL-1…4 | Typecheck gaps, seed footgun, bcrypt drift, debug logging | ✅ fixed |
| QUAL-5 | Seed writes a nonexistent job status | 🟡 script fixed; enum promotion deferred |
| JOB-STATUS | `JOB_STATUS` / filter schema missing `REJECTED` | ✅ fixed |

---

## 7. Bulk-import investigation

**Reported symptom:** a second CSV import "shows the content of the first file again," though
candidates were correctly imported.

### What was ruled out

Drove the real running app through a headless browser across four flows — upload → "Import
another" → upload, close/reopen the drawer, the separate Sourcing-page list drawer, and the
Recent Imports panel. All four rendered correctly isolated, per-list data. No React Query
caching bug, no stale query key.

### What was actually wrong

`checkCandidateDuplicate()` silently reuses an existing candidate when a row matches by
email/phone/resume/LinkedIn/GitHub — correct behavior, a person sourced twice shouldn't be
duplicated — but gave zero indication it happened. A second file overlapping even one row
with an earlier import (routine with re-exported lists) would show a name the user just saw,
with nothing distinguishing "reused" from "brand new." Verified live: importing one
overlapping row produced `validCount: 2, errorCount: 0` with no signal at all.

### Fix

Added `CandidateList.linkedCount` / `linkedReport` — mirrors the existing
`errorCount`/`errorReport` pattern. The result screen now shows an "N already existed" badge
and a table of which rows matched an existing candidate and why. Commit `51776ae`.

---

## 8. Open items

These need a decision, not more debugging.

### SEC-3 Stage 2 — per-tenant user identity (deferred)

Today `User.email` is globally unique across every tenant — one person, one platform login.
That's a deliberate choice (simplicity, one account per human), not an oversight, but it
means the same email can't hold separate accounts in two workspaces. The staged alternative
already has its plumbing in place (`Tenant.slug`, workspace-scoped routing) — moving to
per-tenant identity means login resolves the user within a workspace, or an ambiguous email
prompts "which workspace?" This is a login-UX decision as much as a schema one; shouldn't be
rushed into a hotfix.

### QUAL-5 part 2 — promote JobStatus to a real enum (deferred)

This schema has zero enums across all 55 models — every status field, everywhere, is a plain
`String`. Promoting just `JobRequisition.status` would be the first, and is a repo-wide
precedent call (migrate every status-shaped field the same way, or just this one and accept
inconsistency), not a one-field patch.

### Pattern B gap — `Interview.scheduleId` soft-delete index (open)

Same shape as the fixed SEC-2 bug, but latent (not live-reproduced): a cancelled interview's
`scheduleId` stays in a full unique index. Fixing it the same way as `User.email` is blocked —
Prisma requires `@unique` literally on the FK side of a one-to-one relation, so this needs
restructuring `Interview.schedule` to a one-to-many relation, touching every call site that
reads `interview.schedule`. Out of scope for a targeted index fix.

---

## 9. Running it locally

```bash
# infra
docker compose up -d              # postgres:5433, redis:6381

# server (from server/)
npm run prisma:deploy             # applies all migrations
npm run prisma:seed               # roles, permissions, dev users
npm run dev                       # http://localhost:4000

# client (from client/)
npm run dev                       # http://localhost:5173
```

| Account | Credentials |
|---|---|
| Dev superadmin | `admin@agnohire.local` / `Admin@12345` |
| Dev candidate | `candidate@agnohire.local` / `Candidate@12345` |

API health: `GET /api/health` (the bare `/health` falls through to the SPA catch-all in
dev — not a bug, just where the route is mounted).

---

## 10. Repo & remotes — read before you push

| Remote | URL | Rule |
|---|---|---|
| `cloudtest` | `github.com/VarunRK04/AgnoHire_Cloud_Test` | ✅ use this one — local `main` tracks `cloudtest/main` |
| `origin` | `github.com/VarunRK04/AgnoHire.git` | 🚫 do not push — a separate, unrelated repository |

This rule is pinned in `CLAUDE.md` at the repo root — read it first in any new session.

---

## 11. Production gaps (not yet implemented)

| Area | Gap |
|---|---|
| Deployment | No Dockerfile/image, no K8s/Helm manifests, CI builds but doesn't deploy |
| Observability | No Prometheus/OpenTelemetry/Sentry — logs only (Winston) |
| Realtime scale-out | Socket.IO has no Redis adapter — single-instance only |
| Backups | No automated backup / PITR / WAL archiving configured |
| Blob storage | Resumes/proctor shots/attachments live in Postgres, not S3/GCS |
| Security scanning | No WAF, no SAST/DAST in CI |
