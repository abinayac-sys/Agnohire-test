# AgnoHire — Session Summary (2026-06-06)

## Project

**GitHub:** git@github.com:VarunRK04/AgnoHire.git (branch: main)
**Working dir:** d:\AgnoHire_Main
**Monorepo:** npm workspaces — `shared`, `server`, `client`

### Stack
- **Backend:** Node.js + Express + TypeScript (strict), Prisma ORM, PostgreSQL, Redis, Bull queues
- **Frontend:** React + Vite + TypeScript, Tailwind CSS, react-hook-form + Zod, Lucide icons, Zustand
- **Auth:** JWT + HTTP-only cookies, Google OAuth via Passport.js
- **AI:** OpenAI (JD generation, interview scoring, resume parsing)

---

## Non-Negotiable Rules (never break these)

1. **TypeScript everywhere** — strict mode; shared types in `/shared` package
2. **Soft deletes only** — never `DELETE` from DB; always `deletedAt = now()`; global Prisma middleware enforces `WHERE deletedAt IS NULL`
3. **All list APIs paginated** — server-side, default 25/page, filters/sort in URL params
4. **Zero hardcoded config** — only permitted `.env` vars: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `SESSION_SECRET`, `ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NODE_ENV`, `PORT`, `CLIENT_URL`. Everything else (SMTP, rate limits, themes, API keys) lives in the DB, edited via Admin Console.

---

## Status at a glance (2026-06-06)

**All 14 modules + "Section B" cross-cutting infra are merged & pushed to `main`.** The full
14-module spec is built: Module 12 (chatbot — staff + candidate portal), Module 13 (Security &
GDPR — audit viewer + requests/consent/retention + complete erasure), and Module 14 (Admin Console
— users, role/permission matrix, sectors/domains, integrations, email templates, system config).
Full-stack integrity last verified live: **66/66 automated tests + a 26-check all-module browser E2E
sweep + cross-module adversarial probes** (typecheck + build clean; cross-sector isolation confirmed
via scoped-HR GDPR + per-resource RBAC bug-hunts). Local stack runs on ALT PORTS (Postgres :5433,
Redis :6380) to avoid a foreign `agnohire_*` deploy on 5432/6379; server :4000, client :5173.
Login admin@agnohire.local / Admin@12345 (dev candidate: candidate@agnohire.local / Candidate@12345).
**OpenAI key is intentionally BLANK** — every AI path degrades gracefully (deterministic fallbacks); no AI output is live-verified.

**Cross-cutting infrastructure ("Section B", on `main`):**
- **Automated test suite** (FIRST in repo) — Vitest + Supertest black-box vs the running server; `npm test --workspace=server`; covers auth/RBAC/sector-isolation/M1–M13/email/attachments/notifications.
- **SMTP email** — DB-configured nodemailer (`mailerService` + `emailTemplates`); interview reminders + offer/panel notifications; graceful no-op when unset; `POST /api/system/email/test`.
- **Real file uploads** — generic `Attachment` model (`/api/files`); offer documents/letters + BGV reports; **sector-scoped downloads** (admin / uploader / same-sector referenced).
- **Realtime** — Socket.IO in-app notification center + live Kanban board (`pipeline:moved`).

| # | Module | Status | Headline |
|---|--------|--------|----------|
| 1 | Job Requisition & JD Management | ✅ main | CRUD + approval workflow + templates + AI JD (graceful) |
| 2 | Resume Parsing & Candidate Screening | ✅ main | Candidate CRUD, resume upload→Bull parse, AI fit score (graceful), bulk import, recruiter assignment |
| 3 | Candidate Sourcing | ✅ main | Referrals, channels, curated lists + bulk assign, talent search; LinkedIn scaffolded |
| 4 | AI Interview Engine | ✅ main | Question banks (+AI gen), token public interview route, anti-cheat, MCQ auto-grade + AI Q&A scoring |
| 5 | Interview Scheduling | ✅ main | UTC slot engine, working-hours guard, conflict detection, reminders (Bull); Google Calendar scaffolded |
| 6 | Skill Assessment | ✅ main | Builder from banks, bulk assignment, token take page, auto + AI scoring (FIRST migration since foundation) |
| 7 | AI Analytics & Reporting | ✅ main | KPI dashboard, cumulative funnel, time-series, breakdowns, CSV export, snapshots, AI insights (graceful) |
| 8 | Video Interview Intelligence | ✅ main | Transcript intake, deterministic metrics + AI intelligence (graceful), proctoring integrity report, reviewer workflow |
| 9 | ATS Pipeline / Kanban | ✅ main | Drag-drop board over JobApplication.stage, stage→status sync, append-only pipeline notes (no migration) |
| 10 | Hiring Panel | ✅ main | Panelist assignment + accept/decline, structured star feedback, weighted consensus, finalised decision (no migration) |
| 11 | Offer & Onboarding | ✅ main | Draft→send→accept lifecycle, documents, auto onboarding checklist + BGV, advance to HIRED (no migration) |
| 12 | AI Chatbot | ✅ main | "Agno" FAQ-match → AI fallback (graceful) → canned; staff demo + FAQ admin + transcript viewer **and** candidate portal (`/candidate/support`); no migration |
| 13 | Security & GDPR Compliance | ✅ main | audit-log viewer (filter/detail/CSV, sector-scoped) + GDPR ACCESS/PORTABILITY/DELETION lifecycle, complete erasure, consent, retention policies; no migration, no new perms |
| 14 | Admin Console | ✅ main | users CRUD + role/permission matrix + sectors/domains CRUD + integrations (encrypted secrets) + email templates + system config/SMTP test; per-resource RBAC; no migration, no new perms |

### Migrations applied (in order)
- `20260603092027_module6_skill_assessment` — 4 self-contained tables (Assessment/AssessmentQuestion/AssessmentAssignment/AssessmentAnswer), plain-FK refs.
- `20260603121032_module8_video_intelligence` — additive only: `Interview.transcript`; `InterviewResult.{transcriptSummary, recommendation, reviewerNotes, reviewedAt, reviewedById}`.
- `20260605095201_module_b_attachments` (Section B) — new `Attachment` model (fileData bytes, mimeType, fileSize, uploadedById) for real file uploads.

> Modules 9–14 added **no** migrations beyond the above (they reuse pre-existing schema models).

---

## Module 1 — Job Requisition & JD Management (COMPLETE)

**Committed:** 2026-06-01 · 117 files · 18,102 insertions · pushed to `main`

### Files Delivered

**Shared (`shared/src/`)**
- `schemas/job.ts` — Zod schemas: `createJobSchema`, `updateJobSchema`, `jobFiltersSchema`, `submitJobSchema`, `approveJobSchema`, `rejectJobSchema`, `generateJdSchema`, `createJobTemplateSchema`, `updateJobTemplateSchema`
- `types/job.ts` — `JobListItem`, `JobDetail`, `ApprovalWorkflowItem`, `JobTemplate`, `JobApprover`

**Server (`server/src/`)**
- `routes/job.routes.ts` — 15 endpoints (CRUD + workflow + templates + approvers + AI JD)
- `controllers/job.controller.ts` — all 15 handlers
- `services/jobService.ts` — business logic with domain/sector validation
- `routes/reference.routes.ts` — sectors, domains, users for dropdowns

**Client (`client/src/`)**
- `pages/jobs/JobsPage.tsx` — stats cards, filter bar, URL-persisted state
- `pages/jobs/JobDrawer.tsx` — create/edit multi-step drawer (3 steps)
- `pages/jobs/JobDetailPanel.tsx` — full detail + approve/reject/close/reopen actions
- `pages/jobs/components/JobTable.tsx` — sortable table, smart windowed paginator
- `pages/jobs/components/StatusBadge.tsx` — status + work mode badges
- `services/jobApi.ts` — 14 typed API functions
- `services/referenceApi.ts` — sectors/domains API calls
- `config/navigation.tsx` — Jobs nav item gated on `PERMISSIONS.JOB_VIEW`

### Bugs Fixed

| # | Bug | Fix |
|---|-----|-----|
| 1 | `GET /jobs/templates` captured as `GET /jobs/:id` | Moved all static routes before `/:id` in `job.routes.ts` |
| 2 | `aiGeneratedJd` flag not wired end-to-end | Added to shared schema → form state → API payload → DB field → detail badge |
| 3 | Sector change didn't clear domain on edit (useEffect fires on `form.reset()` too) | Replaced useEffect with `prevSectorRef` + intercepted `onChange` on sector Select |
| 4 | `workMode = ''` rejected by Zod enum | Controller `onChange` converts `e.target.value \|\| undefined` |
| 5 | Optional selects couldn't be cleared | Removed `disabled` from placeholder `<option value="">` |
| 6 | No server-side domain/sector mismatch check | Added `domain.sectorId !== data.sectorId` guard in `jobService.createJob` |
| 7 | Paginator only showed first 7 pages hardcoded | Replaced with 5-page window centered on current page |

---

## Modules 9–11 (COMPLETE — built this session, no migrations)

All three reuse pre-existing schema models, so **no new migrations** were needed.

### Module 9 — ATS Pipeline / Kanban (`c21c464`)
Kanban over existing `JobApplication.stage` + `PipelineNote`. Stages: SOURCED/APPLIED/SCREENING/INTERVIEW/OFFER/HIRED/REJECTED.
- **Shared:** `schemas/pipeline.ts`, `types/pipeline.ts`, `PIPELINE_STAGES`.
- **Server:** `pipelineService.ts` (sector scope via `job.sectorId`, fail-closed; `getBoard` grouped-by-stage for one job; `moveApplication` syncs `status` via `STAGE_TO_STATUS` map so the M7 funnel stays consistent; append-only notes, private notes author-only) + controller + `/api/pipeline` routes (GET `/board`, GET/POST `/applications/:id/notes`, PATCH `/applications/:id/stage`).
- **Client:** `pipelineApi.ts` + `pages/pipeline/{PipelinePage (native HTML5 drag-drop + optimistic cache move), PipelineCardDrawer, pipelineMeta}`.

### Module 10 — Hiring Panel (`9d7c5bc`, polish `e7be42e`)
Panelist assignment + structured feedback + weighted consensus over LIVE/PANEL interviews. Added **PANEL_MANAGE** permission → DB re-seeded.
- **Shared:** `schemas/panel.ts`, `types/panel.ts`; new `requireAnyPermission` rbac helper.
- **Server:** `panelService.ts` — `panelScope` (OR fallback combined under AND, no OR-collision); consensus weights SH=2/H=1/NH=-1/SNH=-2; one-feedback-per-reviewer upsert w/ auto-enrol; accept/decline status; `recordDecision` writes `InterviewResult.decision` (separate from M4) + controller + `/api/panels` routes.
- **Client:** `panelApi.ts` + `pages/panel/{PanelReviewsPage, PanelDetailPanel}` (4-tab drawer: Decision / Feedback / Panelists / My-feedback star form + accept-decline banner + finalize-decision buttons).

### Module 11 — Offer & Onboarding (`a38a2e9`)
Offer lifecycle + documents + post-acceptance onboarding. Added `BGV_STATUS` enum (free-text column, no migration).
- **Shared:** `schemas/offer.ts`, `types/offer.ts` (`OfferListItem` carries `applicationId` for create-picker dedupe).
- **Server:** `offerService.ts` — `offerScope` (application.job.sectorId, fail-closed); create draft from application (one active offer/app); draft-only edit; send; respond accept/decline; **on accept** → signature/signedAt/IP + auto-create onboarding (default 5-item checklist) + **advance application to HIRED** (M9 pipeline integration); documents add/remove; onboarding status + BGV; checklist replace + per-item toggle + controller + `/api/offers` routes (onboarding gated ONBOARDING_MANAGE).
- **Client:** `offerApi.ts` + `pages/offers/{OffersPage (CreateOfferDrawer excludes apps with an active offer), OfferDetailPanel, offerMeta}` (3-tab drawer Offer/Documents/Onboarding; same page powers `/offers` + `/onboarding` mode).

### Post-review bug fixes (`5a39f1c`)
1. **M9 stage↔status divergence** — every stage now maps to a status (SOURCED→APPLIED) so `moveApplication` keeps status in lockstep (M7 funnel consistent).
2. **Fail-closed sector scopes** — non-admin with null sectorId now matches nothing (was unscoped `{}` = see-all) across candidate/application/job/candidate-list/pipeline/offer scopes; question banks fall back to public-only.
3. **M11 create-offer picker** excludes apps with an active offer.

Also resolved the **OR-collision cross-sector leak class** (`34044bd`) — `candidateService.listCandidates`/`searchCandidates`, `reviewService.reviewableWhere`/`listReviews` now combine scope + search under `AND:[scope, {OR:search}]` instead of a colliding duplicate `OR` key.

---

## Section B — Cross-cutting infrastructure (COMPLETE, on `main`)

A targeted pass at the highest-leverage "operate-it-for-real" gaps. Commits `b388da3` (tests), `837b57a` (SMTP), `35c3e91` (files), `f72b465` (realtime).

1. **Automated test suite** — first in the repo. Vitest + Supertest run black-box against the running server (`npm test --workspace=server`; `TEST_BASE_URL` overrides). Files in `server/tests/`: auth, modules (M1–M13 reads), isolation, pipeline sync, email, attachments, notifications, chatbot, compliance.
2. **SMTP email** — `mailerService.ts` (DB-config nodemailer, signature-cached transport, graceful no-op when unset) + `emailTemplates.ts`; wired into interview reminders, offer-sent, and panel-assignment; `POST /api/system/email/test`; `resetMailer()` on `email.*` config change. Verified end-to-end via an Ethereal account.
3. **Real file uploads** — generic `Attachment` model (`migration module_b_attachments`); `/api/files` upload + download; offer documents/letters + onboarding BGV reports are real uploads (shared `fileRef` validator accepts an absolute URL **or** an internal `/api/files/<id>/download` path); client `FileUploadButton`. **Downloads are sector-scoped** (admin / uploader / same-sector referenced — see bug fixes below).
4. **Realtime** — Socket.IO extended beyond theme broadcast: `notificationService` (uses the pre-existing `Notification` model, no migration) pushes `notification:new` to a user room; in-app notification center (bell + unread badge); live Kanban via `pipeline:subscribe`/`pipeline:moved`.

---

## Module 12 — AI Chatbot (COMPLETE, on `main`)

Built **demo-first**, then completed with the candidate portal (**Phase B**). No migration — reuses `ChatbotConversation`/`ChatMessage`/`ChatbotFaq` + pre-seeded `ai.chatbot_name`/`ai.chatbot_system_prompt`. Commits `59fbe15` (feature), `ca607b2` + `4491c07` (bug fixes), `61e629a` (Phase B candidate portal).

- **Backend** `chatbotService.ts` — owner-agnostic conversations (demo `sessionId="demo:<userId>"`, candidate later `"portal:<candidateId>"`). Answer pipeline: **FAQ keyword/tag match first** (threshold scales to query length) → **OpenAI fallback** (graceful via `openaiService`) → **canned fallback**; never 500s; persists messages with `metadata.source`. FAQ CRUD (hard delete). Sector-scoped transcript viewer (DEMO chats visible to `CHATBOT_VIEW`). `/api/chatbot` routes; 8 seeded starter FAQs.
- **Shared** — `CHATBOT_VIEW`/`CHATBOT_MANAGE` permissions (granted ADMIN/HR/RECRUITER/HIRING_MANAGER → re-seeded, 41 perms); `schemas/chatbot.ts` + `types/chatbot.ts`.
- **Frontend (staff)** — `ChatbotDemoPage` ("Try Agno" with FAQ/AI/Fallback badges + AI-off note), `FaqAdminPage` (CRUD + tags + active toggle), `ConversationsPage` (transcript viewer); new "Chatbot" nav section.
- **Phase B — candidate portal (`61e629a`):** `chatbotService.resolveCandidateOwner` links the signed-in candidate by `Candidate.userId` (falls back to a unique email match + back-fills `userId`; throws a friendly 403 when no profile is linked) → owner `portal:<candidateId>`, channel `PORTAL`. New `GET /chatbot/me/conversation` + `POST /chatbot/me/messages` gated `requireRole(CANDIDATE)`; `pages/candidate/ChatbotSupportPage.tsx` at `/candidate/support` (branded chat, **no** internal source badges — candidates don't see faq/ai/fallback). Seeded a dev candidate login. Hardened `sendMessageSchema` with `.trim()` (whitespace-only → 400). The owner-agnostic service needed no rework.

### Module 12 + Section B bug fixes
- **`ca607b2`** — chatbot FAQ match threshold scales to query length (short paraphrases match; nonsense still falls back); `getOrCreateConversation` is an atomic `upsert` (closes a `sessionId` create race).
- **`4491c07` (security)** — `/api/files/:id/download` was authentication-only → cross-sector IDOR. Now authorized by admin / uploader / same-sector referencing record (offer doc, offer letter, BGV report); unauthorized → 404 (no existence disclosure); null-sector non-admins fail closed.

---

## Module 13 — Security & GDPR Compliance (COMPLETE, on `main`)

Audit-log viewer + GDPR/data-subject tooling over the existing `AuditLog`, `GdprRequest`, and `DataRetentionPolicy` models and the app-wide `recordAudit` stream. **No migration, no new permissions** (reuses `AUDIT_LOG_VIEW` / `GDPR_MANAGE`). Commit `e81cb7c`.

- **Backend — `auditService` (extended):** `listAuditLogs` / `getAuditLog` / `getAuditFacets` / `exportAuditLogs` (CSV), sector-scoped fail-closed via `AuditLog.sectorId`; a date-only `to` filter is treated as inclusive of the whole day.
- **Backend — `gdprService` (new):** request lifecycle (create → process: fulfil/reject). `ACCESS`/`PORTABILITY` build a portable bundle (candidate + resumes[meta] + applications + interviews + offers + conversations, binary excluded). `DELETION` performs a **complete** right-to-erasure in one transaction — anonymizes the candidate, scrubs résumés, deletes chat conversations/messages, nulls interview transcripts/recordings + application notes, sets `gdprDeletedAt` + soft-deletes. Plus consent set/list, retention-policy CRUD, compliance summary. New `/api/audit` (`AUDIT_LOG_VIEW`) + `/api/gdpr` (`GDPR_MANAGE`).
- **Frontend:** `AuditLogsPage` (filter by action/entity/date/search, before/after detail drawer + device info, CSV export, pagination) and `CompliancePage` (summary cards + Requests / Consent / Retention tabs). Routes replace the Module 13 placeholders.
- **Shared:** `schemas/audit.ts` + `schemas/gdpr.ts` + `types/audit.ts` + `types/gdpr.ts`.

### Module 13 bug fixes (code-review pass, in `e81cb7c`)
- 🔴 **Incomplete erasure** — `eraseCandidate` originally scrubbed only the candidate row + résumés, leaving free-text PII in `ChatMessage.content`, `Interview.transcript`/recording URLs, and `JobApplication.notes`. Now erasure also deletes the candidate's conversations/messages (collect ids first — no cascade) and nulls interview transcripts + application notes. Verified live (all scrubbed to null/0).
- 🟡 **Audit `to` date filter dropped the target day** — a date-input coerces to UTC midnight, so `lte:midnight` excluded that day's entries; a midnight `to` is now extended to end-of-day.

### Testing (M13)
60/60 vitest (+9 new `compliance.test.ts`); live GDPR lifecycle + erasure-completeness smoke; browser E2E 17/17; an **adversarial bug-hunt (36 probes, 0 issues)** that created sector-scoped HR users to prove GDPR sector isolation (HR-B blocked from a Default candidate's request/export/consent/process, null-sector HR fails closed), plus validation, injection-safety, and erasure correctness.

---

## Module 14 — Admin Console (COMPLETE, on `main`)

The final module. CRUD + management UI over the platform's foundational models, **no migration, no new permissions** (reuses USER_MANAGE / ROLE_MANAGE / SECTOR_MANAGE / INTEGRATION_MANAGE / SYSTEM_CONFIG_MANAGE).

- **Backend (5 services + controller + `/api/admin/*` routes, each sub-resource gated by its own permission):** `adminUserService` (CRUD + role/sector assign + activate + reset-password; guards: dup email→409, can't deactivate/role-change self, can't remove last active superadmin), `roleService` (permission-matrix editor, replace-in-transaction; SUPERADMIN immutable, unknown key→400), `adminSectorService` (sectors+domains CRUD, soft-delete, orphan guard — can't archive a sector/domain that still owns users/candidates; exports `assertSectorExists`), `integrationService` (CRUD; configJson encrypted at rest; secret-looking keys masked via segment-aware matcher; mask sentinel preserved on update), `emailTemplateService` (CRUD, one-default-per-type). System config UI reuses the existing `/api/system` endpoints.
- **Hardening:** `error.middleware.ts` now maps Prisma known errors (P2002→409, P2003→400, P2025→404) instead of leaking a 500 — platform-wide.
- **Frontend:** `adminApi.ts` + `pages/admin/{UsersPage, RolesPage, SectorsPage, IntegrationsPage, EmailTemplatesPage, SystemConfigPage}`; routes replace the last placeholders; nav adds Roles / Integrations / Email Templates.

### Module 14 bug-fix pass (7 found + fixed in a code review)
Unvalidated `sectorId` FK → 500 (now 400 via `assertSectorExists` on 6 paths); Prisma errors unmapped → generic 500 (now P2002/P2003/P2025 → 409/400/404); createUser email TOCTOU → 409 via the mapper; `deleteSector`/`deleteDomain` orphan guard; self role-change lockout block; last-superadmin same-role no-op allowed; integration secret-mask over-matching tightened to whole key-segments.

### Testing (M14)
66/66 vitest (+6 new `admin.test.ts`); live API + guard smoke (14 checks); browser E2E 16/16; **adversarial bug-hunt ~38 probes / 0 issues** — built a custom `user.manage`-only role to prove per-resource RBAC gating, plus validation edges, guard-rail regression, secret encryption/masking/preservation, one-default-per-type, and injection safety.

---

## The 14-module spec is complete

All modules 1–14 + Section B infrastructure are on `main`. Remaining work is enhancement, not spec gaps: activating the graceful AI/SMTP/Calendar paths with live credentials, and the deferred scaffolds (LinkedIn sourcing, Google Calendar sync, Whisper transcription).

---

## Technical Patterns & Gotchas

### 1. Express Route Ordering (CRITICAL)
Static/prefix routes MUST be declared before parameterized `/:id` routes.

```
router.get('/approvers', ...)       // statics first
router.post('/generate-jd', ...)
router.get('/templates', ...)
router.post('/templates', ...)
router.get('/templates/:id', ...)
router.patch('/templates/:id', ...)
router.delete('/templates/:id', ...)
router.get('/', ...)                // base CRUD next
router.post('/', ...)
router.get('/:id', ...)             // parameterized last
router.patch('/:id', ...)
router.delete('/:id', ...)
router.post('/:id/action', ...)     // sub-actions after /:id
```

### 2. Shared Package Must Be Rebuilt
Server reads `shared/dist/` (compiled JS), not live TypeScript.
After ANY change to `shared/src/`: `npm run build --workspace=shared`
"Property X does not exist" TS errors in server = stale dist.

### 3. Sector → Domain Cascade (useRef, NOT useEffect)
`useEffect` on sectorId also fires during `form.reset()` — clears domain on edit pre-population.
Fix: intercept `onChange` on the sector Select with a ref guard.

```tsx
const prevSectorRef = useRef<string>('');

// In open effect, set before form.reset():
prevSectorRef.current = job?.sector.id ?? '';
form.reset({ ... });

// On sector Select:
onChange={(e) => {
  if (e.target.value !== prevSectorRef.current) {
    setValue('domainId', '', { shouldValidate: false });
  }
  prevSectorRef.current = e.target.value;
  field.onChange(e);
}}
```

### 4. workMode Empty String
`z.enum([...]).optional()` rejects `''`. Fix in Controller onChange:
```tsx
onChange={(e) => field.onChange(e.target.value || undefined)}
```
Also remove `disabled` from `<option value="">` so the placeholder can be re-selected.

### 5. Zod base + refine Pattern
```ts
const jobBase = z.object({ ... });
export const createJobSchema = jobBase.refine(...).refine(...);
export const updateJobSchema = jobBase.partial(); // .partial() fails on ZodEffects
```
Always extract base before chaining `.refine()` if update schema needs `.partial()`.

### 6. `z.input<typeof schema>` for FormValues
Use `z.input` (not `z.infer`) as RHF's `FormValues` type — fields with `.default()` are optional
in input but required in output, which keeps zodResolver generics aligned.

### 7. react-hook-form Controller prop override
Spreading `{...field}` then re-providing `onChange` overrides it (last JSX prop wins).
For selective override: spread field first, then override just `onChange`.

### 8. Smart Paginator
```ts
const WINDOW = 5;
let start = Math.max(1, cur - Math.floor(WINDOW / 2));
const end = Math.min(total, start + WINDOW - 1);
start = Math.max(1, end - WINDOW + 1); // shift left if window cut short on right
// then prepend [1, …] if start > 1, append […, total] if end < total
```

---

## Patterns & Gotchas added in Modules 2–8

### 9. Local stack runs on ALT PORTS (foreign deploy conflict)
A separate `agnohire_*` Docker deployment holds the default ports 5432/6379 with **different credentials**.
This project's compose stack runs on **5433 / 6380**. Bring up: `POSTGRES_PORT=5433 REDIS_PORT=6380 docker compose up -d`.
Run server with overrides: `DATABASE_URL=postgresql://agnohire:agnohire@localhost:5433/agnohire?schema=public`,
`REDIS_URL=redis://localhost:6380`, `PORT=4000`. Client vite :5173.

### 10. 🚨 Migration `.env` trap (data-safety critical)
`.env` `DATABASE_URL` points to **localhost:5432** (the FOREIGN deploy), NOT our 5433 stack. The
`npm run prisma:migrate` script uses `dotenv -e ../.env` → would target the wrong database. ALWAYS override:
from `server/`, kill :4000 first (Windows dll lock), then
`DATABASE_URL="postgresql://agnohire:agnohire@localhost:5433/agnohire?schema=public" npx prisma migrate dev --name <name>`.

### 11. Windows EPERM on `prisma generate` / `migrate dev`
The running dev server holds `query_engine-windows.dll.node`. Kill by PORT via PowerShell
(`(Get-NetTCPConnection -LocalPort 4000 -State Listen).OwningProcess | Stop-Process -Force`) before generating.
git-bash `pkill -f "tsx"` does NOT match the Windows process.

### 12. Graceful AI degrade (OpenAI key blank everywhere)
Every AI path falls back without a key: JD gen / resume parse / fit score 400 with a helpful message;
interview & assessment TEXT/CODE scoring skip (MCQ still auto-grades); analytics insights return deterministic
highlights (`generated:false`); M8 video intelligence returns deterministic transcript metrics (AI fields null).
Pattern: `configService.isConfigured(CONFIG_KEYS.OPENAI_API_KEY, sectorId)` gates the AI branch.

### 13. Plain-FK pattern (self-contained migrations)
References to existing models stored as plain `String` FK columns (no Prisma `@relation`), resolved via a
secondary "nameMap" query. Used by InterviewSchedule, Referral, all Module 6 cross-model refs, and Module 8's
transcript/analytics reads. Keeps new migrations from touching core models.

### 14. Queue-or-inline dispatch + processor import rule
Bull queue when Redis is up, inline fallback otherwise (`jobs/dispatch.ts`). **Processor services must NOT import
`jobs/dispatch.js`** (avoids an import cycle) — e.g. interviewScoringService, assessmentScoringService,
videoIntelligenceService. M8 reuses the pre-existing `TRANSCRIPT` queue.

### 15. Cross-module isolation guarantees (verified by smoke)
- **M4 vs M5/M8:** the shared `Interview` table is partitioned by `type` — M4 surfaces scope `type:'AI'` so LIVE/PANEL never leak.
- **M8 vs M4 fields:** M8 writes its OWN `recommendation`/`reviewerNotes`/`reviewedAt`/`reviewedById`; it never clobbers M4's `decision`/`recruiterNotes`.
- **Sealed token namespaces:** plural staff routes registered before singular public ones; `/interview/:token` and `/assessment/:token` 404 on each other's tokens.

### 16. Analytics has no new model
Module 7 reused the pre-existing `AnalyticsSnapshot` model and `ANALYTICS_VIEW`/`ANALYTICS_GLOBAL` permissions —
zero migration, zero re-seed. Aggregates are computed on the fly, sector-scoped (global holders may pin any sector).
