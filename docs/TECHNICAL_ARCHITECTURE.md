# AgnoHire — Enterprise Technical Architecture Document

> **Document type:** Technical Architecture Document (TAD)
> **System:** AgnoHire — AI-Powered Recruitment Management Platform (Applicant Tracking System)
> **Audience:** Architecture Review Board · CTO Office · Security & Compliance · DevOps/SRE · Technical Due Diligence
> **Basis:** This document describes the system **exactly as implemented** in the source repository. Capabilities not present in the codebase are explicitly marked **Not Yet Implemented (NYI)**.

---

## 1. Cover Page

| | |
|---|---|
| **Product** | AgnoHire |
| **Subtitle** | AI-Powered Recruitment Management Platform / Applicant Tracking System |
| **Classification** | Internal — Confidential |
| **Document Owner** | Enterprise Architecture |
| **Repository** | `git@github.com:VarunRK04/AgnoHire.git` |
| **Primary Branch** | `main` |
| **Architecture Style** | Modular monolith (Express API) + SPA (React) + shared contract package, npm-workspace monorepo |
| **Runtime Targets** | Node.js ≥ 20, PostgreSQL 15, Redis 7 |

---

## 2. Document Control

| Field | Value |
|---|---|
| Status | Baselined against current `main` implementation |
| Confidentiality | Confidential — contains security-control detail |
| Review Cadence | Per major release / per architecture change |
| Source of Truth | Repository code, Prisma schema, route table, and configuration files |
| Authoring Standard | Fortune-500 architecture-review grade; no marketing language |
| Verification Method | Direct codebase inspection (services, schema, routes, middleware, CI, compose) |

---

## 3. Revision History

| Version | Date | Author | Summary |
|---|---|---|---|
| 1.0 | 2026-06-15 | Enterprise Architecture | Initial baseline TAD generated from the implemented system (14 functional modules, 55 data models, 25 API route groups). |

---

## 4. Executive Summary

AgnoHire is an enterprise recruitment platform that automates the complete hiring lifecycle — job requisition, candidate sourcing and screening, AI resume parsing and fit scoring, proctored AI interviews, skill assessments, interview scheduling, video/transcript intelligence, ATS pipeline management, hiring-panel collaboration, offers and onboarding, an AI support chatbot, analytics, security/GDPR compliance, and an administrative console.

The system is engineered as a **modular monolith**: a single Express API process organized into clearly bounded service modules, fronted by a **React single-page application**, with a **shared TypeScript contract package** (`@agnohire/shared`) that defines all cross-tier types, Zod validation schemas, and constants. Persistence is **PostgreSQL** via **Prisma ORM** (55 models, 9 migrations). **Redis** backs asynchronous job processing (Bull queues), rate limiting, and cluster-wide security controls, with graceful in-process fallbacks when Redis is unavailable.

Three architectural properties define the platform:

1. **Sector-scoped multi-tenancy with fail-closed authorization.** Every tenant-bounded query is constrained by the caller's `sectorId`; a non-administrative principal with no sector resolves to *nothing*, never *everything*.
2. **Zero-hardcoded operational configuration.** AI provider credentials, SMTP settings, rate limits, token lifetimes, and proctoring thresholds are stored in the database (`SystemConfiguration`) and resolved at request time through a cached configuration service — not read from environment variables at runtime.
3. **Provider-agnostic AI integration.** All model interactions flow through a single OpenAI-compatible client that targets OpenAI, Google Gemini's compatibility endpoint, Azure OpenAI, or a local gateway, with retry/backoff, JSON-mode parsing, and graceful degradation when no key is configured.

**Maturity snapshot.** Application code, data model, authorization, AI subsystem, queue/event processing, realtime, and security controls are implemented and operational. **Container packaging (application Dockerfile), Kubernetes/Helm manifests, a deployment CI/CD stage, and external observability (metrics/tracing/error aggregation) are Not Yet Implemented** and are called out in the relevant sections as the primary gaps for production hardening.

---

## 5. Business Problem & Objectives

**Problem.** Enterprise hiring is fragmented across disconnected tools (sourcing, ATS, interview scheduling, assessment platforms, e-signature, compliance), producing data silos, manual handoffs, inconsistent candidate evaluation, and weak auditability. AI capabilities, where present, are typically bolted on rather than integrated into the system of record.

**Objectives addressed by the implementation:**

| Objective | Implementation evidence |
|---|---|
| Unify the hiring lifecycle in one system of record | 14 functional modules over a single relational schema (55 models) |
| Apply AI consistently and safely | Single config-driven `openaiService` hub used by resume parsing, fit scoring, interview question generation/scoring, assessment scoring, video intelligence, chatbot, and analytics |
| Enforce tenant isolation | Sector-scoped, fail-closed query scopes across candidate/job/application/pipeline/offer/audit/GDPR domains |
| Provide enterprise authorization | 7 roles, 80+ granular permissions (`PERMISSION_DEFS`), permission-gated routes |
| Maintain auditability and compliance | Append-only `AuditLog`, GDPR request lifecycle (access/deletion/portability), right-to-erasure, retention policies |
| Operate without redeploys for routine tuning | `SystemConfiguration`-driven runtime configuration with cache TTL |

---

## 6. Architecture Philosophy

The platform is built on a set of deliberate, observable principles:

- **Modular monolith over premature microservices.** One deployable API reduces operational surface area and cross-service consistency problems while still enforcing module boundaries in code (service-per-domain). This is a conscious trade-off favoring delivery velocity and transactional integrity over independent scaling of subdomains.
- **Contract-first, single source of truth.** The `shared` package defines every DTO, enum, constant, and Zod schema once. The server parses with these schemas; the client validates forms with the same schemas. Drift between client and server is structurally prevented.
- **Thin controllers, rich services.** Controllers parse/validate input and shape responses; all business logic, persistence, scoping, and side-effects live in services (`server/src/services`, 42 modules). This keeps transport concerns separate from domain logic.
- **Fail-closed security.** Authorization defaults to denial. Missing tenant context yields an empty result set, not an unscoped one. Production refuses to silently degrade cluster-wide security controls.
- **Configuration as data.** Operationally significant knobs live in the database, resolved through a caching layer, enabling per-tenant overrides and live tuning.
- **Graceful degradation.** Redis down → inline job execution + in-memory rate limiting; no AI key → friendly "configure a key" responses instead of 500s; SMTP unset → no-op mailer. The system remains functional under partial infrastructure failure.

---

## 7. High-Level System Architecture

```
                         ┌──────────────────────────────────────────────┐
                         │                  CLIENTS                      │
                         │  Staff browser (SPA)   Candidate browser (SPA)│
                         │  Public token pages: /interview/:token,       │
                         │                       /assessment/:token      │
                         └───────────────┬──────────────────────────────┘
                                         │ HTTPS (JSON over REST) + WebSocket
                                         ▼
        ┌────────────────────────────────────────────────────────────────────┐
        │                       EXPRESS API (Node 20)                         │
        │  helmet · CORS · cookie-parser · morgan · rate limiter (per /api)   │
        │                                                                     │
        │  Routes (25 groups)  →  Controllers (23)  →  Services (42)          │
        │                                                                     │
        │  Auth/RBAC middleware · Zod validation · global error mapper        │
        │  Socket.IO server (rooms)  ·  Bull queue producers + workers        │
        │  Bull-Board admin dashboard (/api/admin/queues)                     │
        └───────┬───────────────────────┬──────────────────────┬─────────────┘
                │ Prisma                 │ ioredis              │ HTTPS
                ▼                        ▼                      ▼
        ┌──────────────┐        ┌──────────────┐      ┌────────────────────┐
        │ PostgreSQL15 │        │   Redis 7    │      │ External AI provider│
        │ 55 models    │        │ Bull queues  │      │ (OpenAI-compatible: │
        │ file bytes   │        │ rate limit   │      │  OpenAI/Gemini/Azure│
        │ in-DB        │        │ token/session│      │  /local gateway)    │
        └──────────────┘        │ revocation   │      └────────────────────┘
                                └──────────────┘
                                         │
                    Optional outbound: SMTP (nodemailer), Google Calendar API,
                    Judge0 (coding execution), Google OAuth 2.0
```

**Topology notes (as implemented):** the API, SPA build, Postgres, and Redis are the core runtime components. `docker-compose.yml` provisions Postgres and Redis only; the application processes run on the host (dev) or must be packaged by the operator (production — see §19). External dependencies are all **optional** and **config-gated**.

---

## 8. Complete Service Architecture

The server exposes **42 domain services** under `server/src/services`. Representative grouping:

| Domain | Key services | Responsibility |
|---|---|---|
| Identity & access | `authService`, `tokenService`/`tokenHelper`, `adminUserService`, `roleService` | Login (dev + OAuth), JWT issue/rotate, session/refresh management, user/role administration |
| Tenancy | `adminSectorService`, `referenceService` | Sectors/domains CRUD, reference data, scope resolution |
| Jobs & candidates | `jobService`, `candidateService`, `resumeParseService`, `fitScoreService`, `applicationService` | Requisitions, candidate records, resume parsing, AI fit scoring, applications |
| Sourcing | `sourcingService` | Internal search, referrals, sourcing channels (external sync = graceful stub) |
| Interviews | `interviewService`, `publicInterviewService`, `interviewScoringService`, `scheduleService`, `calendarService` | AI question generation, public token interview flow, scoring, scheduling, Google Calendar sync |
| Assessments | `assessmentService`, `assessmentScoringService`, `judge0Service` | MCQ/coding assessments, auto-scoring, code execution |
| Intelligence | `videoIntelligenceService`, `reviewService`, `analyticsService` | Transcript metrics + AI analysis, Whisper transcription, analytics/insights |
| Pipeline & panel | `pipelineService`, `panelService` | Kanban stage management, panel feedback/consensus |
| Offers | `offerService` | Offer lifecycle, documents, onboarding |
| Chatbot | `chatbotService` | FAQ → AI → fallback answer pipeline, transcripts |
| Platform | `configService`, `mailerService`, `notificationService`, `attachmentService`, `integrationService`, `auditService`, `gdprService`, `emailTemplateService` | Config resolution, email, realtime notifications, file storage, integrations, audit, GDPR |
| AI hub | `openaiService` | Single OpenAI-compatible client (chat, JSON mode, Whisper) |

**Internal communication flow:** `Route → middleware (authenticate → requirePermission/requireRole → Zod validate) → Controller → Service(s) → Prisma/Redis/HTTP`. Services compose other services directly (in-process function calls); there is **no internal network hop** between domains — a direct consequence of the modular-monolith choice.

---

## 9. Frontend Architecture

**Stack:** React 18.3, Vite 6, React Router 6, TanStack Query 5 (server state), Zustand 5 (client/auth state), Axios, Tailwind CSS 3.4 (+ class-variance-authority), Recharts 3, Framer Motion 11, React Hook Form 7 + Zod resolvers, Socket.IO client 4.8, lucide-react.

**Layout (`client/src`):**

```
client/src/
  App.tsx              Route tree (role-scoped staff areas + candidate portal + public token pages)
  main.tsx             Bootstrap (providers, router)
  layouts/             AppLayout (sidebar nav + shell)
  routes/              ProtectedRoute (authenticated), RoleRoute (role-gated)
  pages/               One folder per module (jobs, candidates, interviews, assessments,
                       pipeline, panel, offers, analytics, reviews, chatbot, audit,
                       compliance, admin, candidate, screening, sourcing, schedule)
  components/          ui/ (design-system primitives) + common/ (composite)
  services/            API clients (one per domain) + api.ts (Axios wrapper, unwrap())
  store/               Zustand auth store (access token, identity)
  config/              navigation.tsx (per-role, permission-gated nav), rolePaths
  providers/           React Query + app providers
  styles/, lib/, utils/
```

**Design decisions:**
- **Server state vs. client state are separated.** TanStack Query owns all remote data (caching, invalidation, optimistic updates — e.g., the chatbot's optimistic message append); Zustand holds only auth/session identity.
- **Routing guards are declarative.** `ProtectedRoute` enforces authentication; `RoleRoute` enforces role membership; navigation items are filtered by permission at render time so the menu reflects the caller's exact grants.
- **Public, unauthenticated surfaces** (`/interview/:token`, `/assessment/:token`) render outside the authenticated layout and rely on opaque server-issued tokens rather than sessions.
- **Form validation reuses server Zod schemas** from `@agnohire/shared`, eliminating client/server validation drift.

**Candidate interview client (production-grade media handling).** The candidate interview is the most browser-intensive surface. `useMediaProctor` owns a single `getUserMedia` stream, exposes liveness flags (`cameraLive`/`micLive`) driven by track `ended`/`mute`/`unmute` events and a `devicechange` listener, provides a downscaled JPEG `capture()` for proctoring evidence, and tears down the prior stream + metering loop before any re-acquisition. The shared video-element callback ref is hardened against React mount/unmount ordering so capture survives transitions across the multi-step setup wizard and the live interview header.

---

## 10. Backend Architecture

**Stack:** Express 4.21, Prisma 5.22 (`@prisma/client`), Bull 4.16 + ioredis 5, Socket.IO 4.8, Zod 3.23, Winston 3.17, Helmet 8, express-rate-limit 7 + rate-limit-redis 4, Passport 0.7 + passport-google-oauth20, jsonwebtoken 9, bcrypt 5, nodemailer 8, multer, pdf-parse/pdfjs-dist/mammoth/tesseract.js (resume + OCR), `@bull-board/express`.

**Bootstrap sequence (`server/src/app.ts`):**

```
assertEncryptionKey()      // fail fast on bad ENCRYPTION_KEY before anything else
→ connectDatabase()        // Prisma connect
→ connectRedis()           // ioredis; optional — degrades gracefully
→ configService.reload()   // warm the SystemConfiguration cache
→ configurePassport()      // OAuth strategy wiring
→ [prod guard] warn loudly if Redis unavailable (security controls degraded)
→ express app: helmet · trust proxy · CORS · cookie-parser · morgan
→ rate limiter on /api
→ Bull-Board mounted at /api/admin/queues (permission-gated)
→ registerWorkers()        // queue processors (inline fallback if no Redis)
→ /api routes
→ notFoundHandler · global errorHandler
→ http.createServer + Socket.IO init
→ listen(PORT)
→ graceful shutdown (drain in-flight, close queues/DB) on SIGTERM/SIGINT
```

**Layering (`server/src`):** `config/` (database, redis, env, logger, encryption, passport, socket, bullBoard) · `routes/` (mount table) · `controllers/` (23) · `services/` (42) · `middlewares/` (auth, rbac, rate limiter, error, validation) · `jobs/` (queues, workers, dispatch) · `utils/` (response envelope, error classes, storage, OCR) · `prisma/` (schema, migrations, seed).

**Error handling.** A single `errorHandler` maps domain error classes (`BadRequestError`→400, `UnauthorizedError`→401, `ForbiddenError`→403, `NotFoundError`→404) and **Prisma error codes** (`P2002`→409 conflict, `P2003`→400 invalid reference, `P2025`→404) to the standard envelope. This centralization is why, for example, a unique-email race returns a clean `409` rather than a raw `500`.

---

## 11. API Architecture

**Conventions:**
- **Base path:** `/api`. **Transport:** JSON over REST. **Auth:** `Authorization: Bearer <accessToken>`; refresh via httpOnly cookie.
- **Response envelope:** `{ "success": true, "data": ... }` or `{ "success": false, "error": { "code", "message" } }`.
- **Pagination:** `Paginated<T> = { items: T[], meta: { total, totalPages, page, pageSize } }`.
- **Validation:** Zod at the controller boundary; failures → `400` with structured error.

**Route groups (25 mounts under `/api`):**

```
/auth          /system        /jobs          /candidates    /applications
/sourcing      /question-banks /interviews   /interview*    /schedules
/assessments   /assessment*   /reviews       /pipeline      /panels
/offers        /analytics     /reference     /files         /notifications
/chatbot       /audit         /gdpr          /admin         /me
                       (* = public, token-authenticated)
```

Health/readiness are served at `/api/health` (liveness) and `/api/ready` (readiness).

**Request example — authenticated, paginated list:**

```http
GET /api/candidates?page=1&pageSize=20 HTTP/1.1
Authorization: Bearer eyJhbGciOiJIUzI1Ni␣...
```
```json
{
  "success": true,
  "data": {
    "items": [ { "id": "…", "fullName": "Jordan Candidate", "sectorId": "…" } ],
    "meta": { "total": 137, "totalPages": 7, "page": 1, "pageSize": 20 }
  }
}
```

**Request example — public interview (no auth, token in path):**

```http
GET /api/interview/ZwfaX8MPcgNvV2o8u98UeLlo2Mebwcxh HTTP/1.1
```
```json
{
  "success": true,
  "data": { "interview": {
    "id": "…", "status": "SCHEDULED", "candidateName": "Jordan Candidate",
    "questions": [ /* … */ ],
    "antiCheat": { "maxWarnings": 2, "proctoringEnabled": true,
                   "cameraRequired": true, "micRequired": true,
                   "snapshotIntervalSec": 15, "screenShareRequired": false }
  } }
}
```

**Error example:**
```json
{ "success": false, "error": { "code": "INVALID_REFERENCE", "message": "Unknown sector" } }
```

---

## 12. Database Architecture

**Engine:** PostgreSQL 15. **ORM:** Prisma 5.22. **Models:** 55. **Migrations:** 9 (history below).

**Migration history:**
```
20260601092813_init
20260602051040_module2_resume_filedata          (resume bytes in-DB)
20260603092027_module6_skill_assessment
20260603121032_module8_video_intelligence
20260605095201_module_b_attachments              (generic Attachment store)
20260608120000_audit_log_indexes
20260611065559_add_user_profile_fields
20260612045349_interview_proctoring
20260612124500_candidate_answer_unique           (interviewId+questionId unique)
```

**Domain model grouping (selected relationships):**

```
User ──┬─< UserSession                     Sector ──< Domain
       ├─< RefreshToken                     Sector ──< (scopes most tenant data)
       └─< OAuthAccount                     Role ──< RolePermission >── Permission
Role ──< User

JobRequisition ──< JobApplication >── Candidate
Candidate ──┬─< Resume (fileData bytes, parsedData JSON, parseStatus)
            ├─< JobApplication ──< PipelineNote
            ├─< Interview ──┬─< InterviewQuestion >── Question
            │               ├─< CandidateAnswer  (UNIQUE interviewId+questionId)
            │               ├─< ProctorShot      (image bytes)
            │               ├─< InterviewSchedule
            │               ├─< PanelMember
            │               ├── InterviewResult (1:1, AI scores/transcript summary)
            │               └─< InterviewFeedback
            ├─< Assessment ──< AssessmentQuestion / AssessmentAnswer / AssessmentAssignment
            ├─< Offer ──< OfferDocument ; Offer ── Onboarding (1:1)
            └─< ChatbotConversation ──< ChatMessage

QuestionBank ──< Question ; QuestionBank ──< QuestionBankAssignment
Integration (encrypted configJson) ; WebhookLog
AuditLog ; GdprRequest ; DataRetentionPolicy
SystemConfiguration ; Theme ; AnalyticsSnapshot ; Notification ; EmailTemplate ; EmailLog
Attachment (generic file bytes) ; SourcingChannel ; Referral ; CandidateList(+Item) ; CandidateAssignment ; RecruiterSkill
```

**Design decisions and implications:**
- **Binary blobs stored in PostgreSQL** (`Resume.fileData`, `ProctorShot.imageData`, `Attachment` bytes) rather than object storage. *Rationale:* zero external dependency, transactional consistency, simple backup. *Trade-off:* database size growth and row-size pressure; an object-store offload (S3/GCS) is the natural future optimization. A `MAX_SHOTS_PER_INTERVIEW` cap (240) and per-upload size ceilings bound growth.
- **Soft-delete middleware** auto-injects `deletedAt: null` on reads and converts deletes to updates for soft-deletable models. Queries that must see deleted rows opt out with an explicit top-level `deletedAt: { not: null }`. A raw `PrismaClient` bypasses the middleware (used only by maintenance scripts).
- **JSON columns** carry semi-structured data (`Resume.parsedData`, `Interview.violations`, `Integration.configJson` [encrypted], `Onboarding` checklist, sentiment/keyword analysis).
- **Targeted indexing** (e.g., `audit_log_indexes` migration) supports audit query/filter performance.

---

## 13. Authentication & Authorization

**Authentication mechanisms (as implemented):**
- **JWT access tokens** (Bearer), default TTL **15 minutes** (`ACCESS_TOKEN_TTL_MIN`, config-driven).
- **Refresh tokens**, default TTL **7 days** (`REFRESH_TOKEN_TTL_DAYS`), delivered as an **httpOnly cookie** and rotated on use; persisted/revocable via `RefreshToken`/`UserSession`.
- **Google OAuth 2.0** via Passport (`passport-google-oauth20`), enabled only when `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set.
- **Dev email/password login** (`/api/auth/dev-login`) — enabled only when `NODE_ENV !== production` **and** Google OAuth is unconfigured (`devLoginEnabled`). bcrypt password hashing.
- **Public token authentication** for candidate interview/assessment pages — opaque per-interview `accessToken` in the URL path, no session.

**Authentication flow:**
```
Client ── POST /auth/dev-login {email,password}
        OR  /auth/google → Google → /auth/callback
Server  ── verify credentials / OAuth profile
        ── issue access JWT (15m)  + refresh token (7d, httpOnly cookie)
        ── persist UserSession / RefreshToken
Client  ── Authorization: Bearer <access>  on each call
        ── on 401/expiry → POST /auth/refresh (cookie) → new access token (rotated refresh)
        ── POST /auth/logout → revoke session + clear cookie
```

**Authorization model:**
- **7 roles:** `SUPERADMIN`, `ADMIN`, `HR`, `RECRUITER`, `HIRING_MANAGER`, `PANEL_MEMBER`, `CANDIDATE`.
- **80+ granular permissions** defined in `PERMISSION_DEFS` (e.g., `candidate.view`, `interview.decide`, `offer.manage`, `audit.view`, `gdpr.manage`, `user.manage`, `role.manage`, `chatbot.manage`), mapped to roles via `RolePermission`.
- **Middleware primitives:** `authenticate`, `requirePermission(p)`, `requireAnyPermission(...)`, `requireRole(...)`. Only `SUPERADMIN` bypasses role checks.
- **Tenant scoping (fail-closed):** non-admin principals are constrained to their `sectorId`; a non-admin with `sectorId = null` matches **nothing**. Scopes are combined under Prisma `AND` to avoid top-level `OR` key collisions.

**Secrets at rest:** integration credentials and secret config values are encrypted with **AES-256-GCM** (`config/encryption.ts`), key from `ENCRYPTION_KEY` (must base64-decode to exactly 32 bytes; validated at boot via `assertEncryptionKey()`). Secret-looking keys are masked (`••••••••`) on read; a mask sentinel is preserved on update so a masked value is never written back over a real secret.

---

## 14. AI/ML Architecture

**Principle:** all AI is **config-driven and provider-agnostic**. There are no model keys or endpoints hardcoded in source; credentials live in `SystemConfiguration` (category `AI`) and are resolved per request, with per-sector overrides.

**Hub — `openaiService.ts`:**
- `chatCompletion(...)` — chat with retry/backoff on `429`/`503`, honoring provider retry-delay; disables Gemini 2.5 "thinking" via `reasoning_effort: none`.
- `chatJson<T>(...)` — JSON-mode with fenced-JSON fallback parsing; numeric outputs are finite-guarded before persistence.
- `transcribeAudio(...)` — Whisper transcription via `${baseUrl}/audio/transcriptions`.
- Targets any **OpenAI-compatible** endpoint (`OPENAI_BASE_URL`): OpenAI, Google Gemini (compat), Azure OpenAI, or a local gateway.

**AI configuration keys (category `AI`):** `ai.enabled`, `ai.provider_type`, `ai.openai_api_key` (secret), `ai.openai_base_url`, `ai.openai_model`, `ai.openai_whisper_model`, `ai.temperature`, `ai.max_tokens`, plus per-feature model overrides.

**AI features and owning services:**

| Feature | Service | Behavior |
|---|---|---|
| Job description generation | `jobService` | Structured JD from requisition inputs |
| Resume parsing | `resumeParseService` | Text via pdf-parse/pdfjs/mammoth + OCR (tesseract.js) → `chatJson` → structured `parsedData`; enriches candidate skills |
| Candidate↔job fit scoring | `fitScoreService` | Bias-guarded prompt; score clamped 0–100; persists best score |
| Interview question gen + scoring | `interviewService`, `interviewScoringService` | AI questions/follow-ups; AI answer scoring |
| Assessment scoring (incl. coding) | `assessmentScoringService`, `judge0Service` | MCQ auto-score; coding executed via Judge0 |
| Video/transcript intelligence | `videoIntelligenceService` | Deterministic metrics (filler words, talk ratio, WPM, keywords) **always**; AI communication/skill/sentiment scores + summary when a key is present; finite-guarded to never persist `NaN` |
| Audio transcription | `reviewService` + `openaiService.transcribeAudio` | Fetches recording (internal `Attachment` id or external URL, 25 MB cap) → Whisper → persists transcript → re-runs intelligence |
| Chatbot answering | `chatbotService` | FAQ keyword/tag match → OpenAI fallback → canned graceful fallback; never 500s |
| Analytics insights | `analyticsService` | AI narrative over funnel/KPI data |

**Graceful degradation:** with `ai.enabled=false` or no key, AI endpoints return actionable "configure a key" responses; deterministic paths (e.g., transcript metrics) still run. **Note:** AI is inference-only against external providers — there is **no in-house model training/serving** (no ML pipeline, feature store, or model registry); none is claimed.

**ML Ops tooling (model registry, eval harness, drift monitoring): Not Yet Implemented.**

---

## 15. Queue / Event Architecture

**Engine:** Bull 4.16 over Redis (ioredis). **Producers:** `jobs/dispatch.ts`. **Consumers:** `jobs/workers.ts` (`registerWorkers()`). **Admin:** Bull-Board UI at `/api/admin/queues`, permission-gated (`SYSTEM_CONFIG_MANAGE`).

**Asynchronous workloads (offloaded from the request path):** resume parsing, candidate fit scoring, interview answer scoring, video/transcript analysis, and scheduled reminders.

```
HTTP request ──> dispatchX()
                   │  Redis up?
            ┌──────┴───────┐
        yes │              │ no
            ▼              ▼
     enqueue to Bull   run INLINE in-process (fallback)
            │
            ▼
     worker picks up ──> service processor ──> Prisma persist
                                   │
                                   └─> may emit Socket.IO event (e.g., notification)
```

**Design decisions:** processors must **not** import `jobs/dispatch` (prevents an import cycle); the **inline fallback** guarantees correctness without Redis at the cost of request latency for those operations. This makes Redis a performance/scaling dependency rather than a correctness dependency for job execution.

**Event bus beyond Bull (e.g., Kafka/NATS): Not Yet Implemented** — eventing is intra-process plus Bull/Redis.

---

## 16. Realtime Communication Architecture

**Engine:** Socket.IO 4.8 (server in `config/socket.ts`, client via `socket.io-client`).

**Events (`shared/src/constants/notifications.ts`):**
```
notification:new      → emitted to a per-user room when a Notification is created
pipeline:subscribe    → client joins a pipeline/board room
pipeline:moved        → emitted to the board room when an application changes stage
```

```
notificationService.notify(userId, …)
   ├─ persist Notification row
   └─ io.to(user:<id>).emit('notification:new', payload)   ──► NotificationCenter bell (unread badge)

pipelineService.moveApplication(…)
   └─ io.to(board:<…>).emit('pipeline:moved', payload)      ──► Kanban refetch/update
```

**Decisions & implications:** rooms scope delivery to the relevant user/board (no broadcast storms). Realtime is **additive** — the UI also works via standard request/response, so a dropped socket degrades to manual refresh rather than breaking workflows. Cross-instance fan-out at scale requires a **Socket.IO Redis adapter**, which is **Not Yet Implemented** (single-instance realtime today).

---

## 17. Security Architecture

**Implemented controls:**

| Control | Implementation |
|---|---|
| Transport headers | `helmet` (security headers), `trust proxy` for correct client IPs behind a proxy |
| CORS | Configured origin (`CLIENT_URL`) with credentials |
| Rate limiting | `express-rate-limit` on `/api`, **Redis-backed** (`rate-limit-redis`) with in-memory fallback; window/max are config-driven (`RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX` default 300); `/health` & `/ready` skipped; `429` on breach |
| AuthN | JWT access (15m) + rotating httpOnly refresh (7d); Google OAuth; bcrypt hashing |
| AuthZ | 7 roles, 80+ permissions, fail-closed sector scoping |
| Input validation | Zod schemas at every controller boundary |
| Output sanitization | `isomorphic-dompurify` for user-supplied HTML/text |
| Secrets at rest | AES-256-GCM for integration/config secrets; masked on read; boot-time key validation |
| Audit | Append-only `AuditLog` of mutations (actor, action, before/after, device) |
| Data subject rights | GDPR access/deletion/portability + right-to-erasure that scrubs PII across candidate, resumes, chat, interview transcripts, and notes |
| Resource authorization | File/attachment downloads scoped to sector/owner (404, not 403, to avoid existence disclosure) |
| Prod fail-loud | Production warns loudly if Redis (security control backing) is unavailable |

**Authentication/authorization sequence (defense in depth):**
```
request → rate limiter → authenticate (verify JWT, load principal)
        → requirePermission / requireRole (deny by default)
        → Zod validate body/query
        → service applies sector scope (AND) → Prisma
        → audit on mutation
```

**Threat-model posture:** IDOR is mitigated by server-side ownership/scoping (e.g., candidate-portal data is resolved from the token's identity, not client-supplied ids); tenant isolation is fail-closed; secrets never returned in cleartext. **NYI hardening:** WAF, automated dependency/secret scanning in CI, SAST/DAST gating, and centralized security event monitoring.

---

## 18. Infrastructure Architecture

**Current footprint (as implemented):**
- **Stateful services via `docker-compose.yml`:** PostgreSQL `15-alpine` and Redis `7-alpine`, each with named volumes (`postgres_data`, `redis_data`), healthchecks (`pg_isready`, `redis-cli ping`), and `restart: unless-stopped`. Ports are env-parameterized (`POSTGRES_PORT`, `REDIS_PORT`).
- **Application processes:** the Express API and the Vite-built SPA are **not containerized in the repository** — there is no application `Dockerfile`. In development they run on the host via npm scripts; in production the operator must supply process management and a static host/CDN for the SPA build.

```
┌──────────────────────────── Host / VM ────────────────────────────┐
│  Node API process(es) :PORT     SPA static build (served by host/  │
│                                 CDN/reverse proxy)                 │
│            │                                                        │
│            ├── Prisma ──► docker: agnohire-postgres :5432          │
│            └── ioredis ─► docker: agnohire-redis    :6379          │
└────────────────────────────────────────────────────────────────────┘
   (Reverse proxy / TLS termination / load balancer: operator-provided, NYI in repo)
```

**Not Yet Implemented (infrastructure):** application container image(s), reverse-proxy/TLS config, load balancer, autoscaling, infrastructure-as-code (Terraform/Pulumi), and secrets manager integration.

---

## 19. Kubernetes / Docker Deployment

**Docker (implemented):** `docker-compose.yml` for **Postgres + Redis only**. Root scripts: `db:up` (compose up postgres redis), `docker:up`/`docker:down`.

```yaml
# docker-compose.yml (verbatim intent)
services:
  postgres:
    image: postgres:15-alpine
    ports: ["${POSTGRES_PORT:-5432}:5432"]
    volumes: [postgres_data:/var/lib/postgresql/data]
    healthcheck: { test: ["CMD-SHELL","pg_isready -U ${POSTGRES_USER:-agnohire}"], interval: 5s, retries: 5 }
  redis:
    image: redis:7-alpine
    ports: ["${REDIS_PORT:-6379}:6379"]
    volumes: [redis_data:/data]
    healthcheck: { test: ["CMD","redis-cli","ping"], interval: 5s, retries: 5 }
volumes: { postgres_data: {}, redis_data: {} }
```

**Kubernetes / Helm: Not Yet Implemented.** No manifests, charts, or `deploy/` directory exist. The application already exposes the primitives a future K8s deployment needs:
- **Liveness probe →** `GET /api/health` (dependency-free, returns `{status:'ok',ts}`).
- **Readiness probe →** `GET /api/ready` (hard-fails `503` if Postgres is unreachable within 2s; reports Redis but never blocks on it).
- **Graceful shutdown** on `SIGTERM` (drains in-flight requests, closes queues and DB) — compatible with rolling deployments.

**Recommended (not present) production packaging:** a multi-stage Node image for the API, a static SPA artifact behind a CDN/reverse proxy, externalized Postgres/Redis (managed services), and a Socket.IO Redis adapter for multi-replica realtime.

---

## 20. CI/CD Pipeline

**Implemented — `.github/workflows/ci.yml` (single job):**
```
name: CI
on: { push: { branches: [main] }, pull_request: {} }
job build (ubuntu-latest):
  - checkout
  - setup-node 20 (npm cache)
  - npm ci
  - npm run build      # shared (tsc) → server (prisma generate + tsc) → client (vite build)
```
This gate validates **types and build integrity across all three workspaces** on every push to `main` and every PR. No database or secrets are required because nothing is executed — only compiled.

**Explicitly deferred (documented in the workflow):** the **server test suite is black-box** and runs against a **live** API + Postgres + Redis (`TEST_BASE_URL`); it is **not** wired into CI and requires standing up the stack with service containers first.

**Not Yet Implemented:** automated test execution in CI, lint/format gating, security scanning, image build/publish, and any **deployment stage** (the pipeline builds but does not deploy).

---

## 21. Observability & Monitoring

**Implemented:**
- **Structured application logging** via **Winston** (`config/logger.ts`) across services (info/warn/error with contextual metadata).
- **HTTP request logging** via **morgan**.
- **Queue visibility** via **Bull-Board** at `/api/admin/queues`.
- **Health/readiness endpoints** for external probes.

**Not Yet Implemented:** metrics (Prometheus), distributed tracing (OpenTelemetry), error aggregation (Sentry), dashboards (Grafana), uptime/alerting integrations. There are **no** such dependencies in the codebase. This is the single largest production-readiness gap alongside container/K8s packaging.

**Recommended alerting strategy (for when metrics are added):** alert on readiness `503` rate, `5xx` ratio, Bull job failure/backlog depth, rate-limit `429` spikes, DB connection saturation, and AI provider error/`429` rates.

---

## 22. Logging & Audit Architecture

**Operational logging:** Winston structured logs + morgan access logs (stdout; aggregation operator-provided).

**Security/compliance audit:** `auditService` writes **append-only** `AuditLog` entries on mutations, capturing actor, action, target entity, before/after state, and device/context. Audit entries are **sector-scoped** (`AuditLog.sectorId`), filterable by action/entity/date/search, support a **detail view** (before/after JSON), and **CSV export**. The `audit_log_indexes` migration provides query performance for these access patterns. The audit stream is the substrate for compliance review and forensic reconstruction.

---

## 23. Performance Engineering

**Implemented techniques:**
- **Asynchronous offload** of heavy work (AI parsing/scoring, transcription, video analysis) to Bull workers, keeping request latency bounded.
- **Configuration caching** (`configService`, ~30s TTL) avoids a DB read per config lookup on the hot path.
- **Targeted DB indexing** (audit indexes; unique constraints prevent duplicate-row scans, e.g., `CandidateAnswer(interviewId, questionId)`).
- **AI cost/latency controls:** prompt truncation (e.g., transcript sliced to 12 000 chars), bounded `max_tokens`, retry/backoff, and per-day quota short-circuiting.
- **Client-side caching** via TanStack Query (dedup, background refetch, optimistic updates).
- **Payload bounds:** upload size ceilings, snapshot size limits, and a per-interview snapshot cap (240).

**Considerations / known costs:** in-DB binary storage increases row/IO pressure; the inline job fallback (no Redis) shifts heavy work onto the request thread; single-instance realtime caps WebSocket fan-out. Cursor-based pagination for very large lists is a noted future optimization.

---

## 24. Scalability Strategy

**Horizontal scaling readiness:**
- The API is **stateless per request** (JWT auth; no server-side session affinity required for REST), enabling multiple replicas behind a load balancer **once containerized**.
- **Redis-backed** rate limiting, session/token revocation, and Bull queues are designed for **cluster-wide** correctness across replicas (the production guard explicitly fails loud if Redis is absent, precisely because these controls would otherwise degrade to per-process).
- **Bull workers** scale independently of the web tier (more worker processes consume the same queues).

**Current limits to address before scale-out:** (1) no application container/orchestration (§19); (2) Socket.IO requires a **Redis adapter** for multi-replica realtime (NYI); (3) in-DB blob storage should move to object storage for storage scalability; (4) Postgres read scaling (replicas) is operator-provided.

---

## 25. Disaster Recovery

**Implemented foundations:** Postgres data persists on a Docker named volume; Prisma migrations are versioned and reproducible (`db:deploy`); the seed path (`db:seed`) reconstructs baseline reference data, roles, and permissions. Graceful shutdown prevents request loss during planned restarts.

**Not Yet Implemented:** automated backups, point-in-time recovery (PITR/WAL archiving), cross-region replication, documented RPO/RTO targets, and DR runbooks/failover automation. For production, these must be provided at the managed-database layer.

---

## 26. Backup Strategy

**As implemented:** no automated backup tooling exists in the repository; durability relies on the Postgres volume and re-runnable migrations/seed. **Recommended (NYI):** scheduled `pg_dump`/managed snapshots with retention, WAL archiving for PITR, periodic restore drills, and encrypted off-site backup storage. Because user-uploaded files (resumes, proctor shots, attachments) are stored **inside** PostgreSQL, a database backup currently captures all binary artifacts as well — a simplifying property to preserve if blob storage is later externalized.

---

## 27. Multi-Tenancy Design

**Model:** **shared-database, shared-schema** multi-tenancy keyed on **`Sector`** (tenant/business unit), with optional **`Domain`** sub-grouping.

**Isolation mechanics:**
- Most tenant-bounded entities carry a `sectorId`. Services derive a **scope** from the caller's principal and apply it under Prisma `AND`.
- **Fail-closed:** a non-admin principal with `sectorId = null` matches **nothing** (never an unscoped read). Admin/superadmin see across sectors by design.
- Cross-cutting concerns honor the boundary: audit logs, GDPR request resolution, and file downloads are all sector-scoped; GDPR/consent operations resolve candidate ownership within the sector before acting.
- Configuration supports **per-sector overrides** (e.g., AI keys, proctoring thresholds, rate limits) resolved by `configService`.

```
Principal {sub, role, sectorId}
   ├─ SUPERADMIN/ADMIN ─► cross-sector (no scope)
   └─ HR/RECRUITER/…  ─► WHERE sectorId = principal.sectorId
                         (sectorId null ⇒ WHERE 1=0  // fail closed)
```

---

## 28. Source Code Structure

```
AgnoHire/
├─ package.json                 # npm workspaces: shared, server, client; root scripts
├─ docker-compose.yml           # Postgres 15 + Redis 7 (infra only)
├─ tsconfig.base.json
├─ .env.example                 # canonical env var catalog
├─ .github/workflows/ci.yml     # typecheck + build (all workspaces)
│
├─ shared/                      # @agnohire/shared — single source of truth
│  └─ src/{types, schemas, constants}   # DTOs, Zod schemas, roles/permissions/enums
│
├─ server/
│  ├─ prisma/{schema.prisma, migrations/, seed.ts}   # 55 models, 9 migrations
│  └─ src/
│     ├─ app.ts                 # bootstrap, middleware chain, listen, shutdown
│     ├─ config/                # database, redis, env, logger, encryption, passport, socket, bullBoard
│     ├─ routes/index.ts        # 25 route-group mounts + /health, /ready
│     ├─ controllers/  (23)     # thin transport layer
│     ├─ services/     (42)     # domain logic, persistence, scoping, AI
│     ├─ middlewares/           # auth, rbac, rateLimiter, error, validation
│     ├─ jobs/                  # queues, workers, dispatch (Bull)
│     ├─ types/ , utils/
│
└─ client/
   └─ src/                      # React SPA (see §9 for full layout)
```

**Module/communication flow:** `shared` is built first and consumed by both `server` and `client`; the server composes services in-process; the client calls the API through per-domain Axios clients and subscribes to Socket.IO for realtime.

---

## 29. Environment Configuration

**Two-tier configuration model:**
1. **Bootstrap/secret config — environment variables** (`.env`, loaded by `config/env.ts`): infrastructure connection strings and cryptographic secrets required before the app can run.
2. **Operational config — database** (`SystemConfiguration`, resolved by `configService`): AI keys/models, SMTP, rate limits, token TTLs, proctoring thresholds, theme/branding — changeable at runtime, per-sector, without redeploy.

**Environment variables (`.env.example`):**

| Variable | Required | Purpose |
|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` / `POSTGRES_PORT` | compose | Postgres container parameters |
| `DATABASE_URL` | **Yes** | Prisma connection string |
| `REDIS_PORT` / `REDIS_URL` | optional | Redis connection (defaults to `redis://localhost:6379`) |
| `JWT_SECRET` | **Yes** | Access-token signing |
| `SESSION_SECRET` | optional | Express session (falls back to `JWT_SECRET`) |
| `ENCRYPTION_KEY` | **Yes** | AES-256-GCM key — **must base64-decode to 32 bytes**; validated at boot |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optional | Enables Google OAuth; absence enables dev login (non-prod) |
| `NODE_ENV` | optional | `development` \| `production` |
| `PORT` | optional | API port (default 4000) |
| `CLIENT_URL` | optional | CORS origin / SPA base (default `http://localhost:5173`) |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` | optional | Bootstrap AI config (runtime AI config normally lives in `SystemConfiguration`) |

**Operational guardrails:** the server **fails fast** at boot on a malformed `ENCRYPTION_KEY` and on a missing required variable; production logs a **loud security warning** if Redis is unavailable.

---

## 30. Compliance & Governance

**Implemented:**
- **Audit trail:** append-only, sector-scoped `AuditLog` with export.
- **GDPR / data-subject rights:** `gdprService` handles **access**, **deletion**, and **portability** requests; **right-to-erasure** anonymizes/scrubs PII across the candidate record, resumes, chatbot conversations/messages, interview transcripts/recordings, and application notes within a transaction; consent capture and listing; **data-retention policies** (CRUD) and a compliance summary.
- **Tenant isolation** ensures one sector's controllers cannot view or act on another's data.
- **Secret hygiene:** encryption at rest + masking; cryptographic key validated at startup.

**Governance posture:** the platform provides the technical substrate for SOC 2 / ISO 27001 / GDPR programs (auditability, access control, data-subject workflows). **Formal certification artifacts, DPIA documentation, and policy enforcement automation are organizational/NYI**, not code concerns.

---

## 31. Operational Runbooks

**First-time setup**
```
npm run setup        # install → build shared → db:up → db:migrate → db:seed
npm run dev          # API (:4000) + SPA (:5173) concurrently
```

**Routine operations**
```
npm run db:up        # start Postgres + Redis containers
npm run db:migrate   # apply new migrations (dev)
npm run db:deploy    # apply migrations (non-interactive / prod-style)
npm run db:seed      # (re)seed reference data, roles, permissions
npm run db:studio    # Prisma Studio (data inspection)
npm run build        # typecheck + build all workspaces (CI parity)
```

**Health & triage**
- Liveness: `GET /api/health` → `{status:'ok'}`.
- Readiness: `GET /api/ready` → `503` if Postgres unreachable (orchestrator should stop routing); Redis reported but non-blocking.
- Queue inspection: `/api/admin/queues` (requires `SYSTEM_CONFIG_MANAGE`).

**Common incidents**
| Symptom | Likely cause | Action |
|---|---|---|
| Saving a secret (API key) returns 500 / `ENCRYPTION_KEY must decode to 32 bytes` | Invalid `ENCRYPTION_KEY` | Set `openssl rand -base64 32`; restart. Now caught at boot. |
| Heavy operations slow / synchronous | Redis down → inline fallback | Restore Redis to re-enable async workers |
| Rate-limit `429` during bulk/test runs | In-memory limiter counter | Restore Redis (shared counter) or raise `RATE_LIMIT_MAX` config |
| Realtime not updating across instances | No Socket.IO Redis adapter | Single-instance only today; adapter is NYI |
| Candidate camera/mic not detected | Non-secure context (LAN IP over http) | Use `https://` or `http://localhost` (getUserMedia requirement) |

---

## 32. Architecture Decisions (ADR digest)

| # | Decision | Rationale | Consequence |
|---|---|---|---|
| ADR-1 | Modular monolith (not microservices) | Transactional integrity, lower ops surface, faster delivery | Whole-app scaling unit; module boundaries enforced in code, not network |
| ADR-2 | Shared contract package | Eliminate client/server type & validation drift | `shared` must be rebuilt before types propagate |
| ADR-3 | Config-as-data (`SystemConfiguration`) | Runtime tuning, per-tenant overrides, no redeploy | Config cache TTL introduces brief propagation delay |
| ADR-4 | Provider-agnostic AI hub | Avoid vendor lock-in; OpenAI-compatible | Feature parity depends on chosen provider |
| ADR-5 | Fail-closed sector scoping | Tenant data-leak prevention | Null-sector principals must be provisioned correctly |
| ADR-6 | Binary blobs in PostgreSQL | Zero external storage dep; transactional; simple backup | DB size/IO growth; object-store offload is future work |
| ADR-7 | Redis optional with inline fallback | Correctness without Redis in dev | Heavy work runs on request thread when Redis absent |
| ADR-8 | AES-256-GCM secrets + boot validation | Protect credentials at rest; fail fast | Key rotation invalidates previously encrypted values |
| ADR-9 | JWT access + rotating httpOnly refresh | Stateless auth, revocable sessions | Refresh/session state in Redis/DB for revocation |

---

## 33. Technical Trade-offs

- **Delivery velocity vs. independent scalability** — the monolith accelerates development and guarantees cross-module consistency, at the cost of fine-grained scaling. Mitigated by stateless API design that permits replica scaling once containerized.
- **Operational simplicity vs. storage scalability** — in-DB blobs remove an external dependency and unify backup, but pressure the database; the cap/size limits bound this until an object-store migration.
- **Resilience vs. latency** — the Redis-optional inline fallback keeps the system correct under partial failure but increases request latency for offloaded work.
- **Flexibility vs. determinism** — config-as-data enables live tuning and per-tenant behavior but introduces a small cache-propagation window and more runtime states to reason about.
- **Provider neutrality vs. provider-specific features** — the OpenAI-compatible abstraction avoids lock-in but constrains usage to the common surface across providers.

---

## 34. Appendices

**Appendix A — Technology versions (selected, verbatim from manifests):** Express 4.21, Prisma/`@prisma/client` 5.22, Bull 4.16, ioredis 5.4, Socket.IO 4.8, Winston 3.17, Helmet 8, express-rate-limit 7.5 + rate-limit-redis 4.3, Passport 0.7, jsonwebtoken 9, bcrypt 5.1, nodemailer 8, Zod 3.23, `@bull-board/express` 6.5, pdf-parse 1.1, tesseract.js 7, mammoth 1.12 · React 18.3, React Router 6.28, TanStack Query 5.62, Zustand 5, Axios 1.7, socket.io-client 4.8, Recharts 3.8, React Hook Form 7.54, Framer Motion 11.15.

**Appendix B — API route groups (25):** `/auth /system /jobs /candidates /applications /sourcing /question-banks /interviews /interview /schedules /assessments /assessment /reviews /pipeline /panels /offers /analytics /reference /files /notifications /chatbot /audit /gdpr /admin /me` (+ `/health`, `/ready`).

**Appendix C — Data models (55):** User, Role, Permission, RolePermission, OAuthAccount, UserSession, RefreshToken, Sector, Domain, RecruiterSkill, JobRequisition, JobTemplate, ApprovalWorkflow, Candidate, JobApplication, CandidateList, CandidateListItem, CandidateAssignment, Resume, Interview, ProctorShot, InterviewSchedule, PanelMember, InterviewResult, InterviewFeedback, QuestionBank, QuestionBankAssignment, Question, InterviewQuestion, CandidateAnswer, Assessment, AssessmentQuestion, AssessmentAssignment, AssessmentAnswer, PipelineNote, SourcingChannel, Referral, Offer, OfferDocument, Onboarding, ChatbotConversation, ChatMessage, ChatbotFaq, Notification, EmailTemplate, EmailLog, Integration, WebhookLog, AuditLog, GdprRequest, DataRetentionPolicy, SystemConfiguration, Theme, AnalyticsSnapshot, Attachment.

**Appendix D — Functional modules (14):** Jobs & Requisitions · Resume Parsing & Screening · Candidate Sourcing · AI Interview Engine · Interview Scheduling · Skill Assessment · AI Analytics & Reporting · Video Interview Intelligence · ATS Pipeline · Hiring Panel · Offer & Onboarding · AI Chatbot · Security & GDPR Compliance · Admin Console.

**Appendix E — Consolidated "Not Yet Implemented" register:** application Dockerfile/container image · Kubernetes/Helm manifests · CI/CD deployment stage & automated test/scan jobs · external observability (Prometheus/OTel/Sentry/Grafana) · Socket.IO Redis adapter (multi-replica realtime) · automated backups/PITR & DR automation · object-store offload for blobs · WAF/SAST/DAST · ML Ops tooling · external sourcing connectors (LinkedIn/job-board live sync) · biometric face *matching* (enrollment frame captured; no matching).

---

## 35. Glossary

| Term | Definition |
|---|---|
| **Sector** | Tenant / business unit; primary multi-tenancy key |
| **Domain** | Optional sub-grouping within a Sector |
| **Fail-closed scoping** | Authorization that yields *nothing* (not *everything*) when tenant context is missing |
| **`@agnohire/shared`** | Workspace package holding all cross-tier types, Zod schemas, and constants |
| **`SystemConfiguration`** | Database table holding runtime operational config (config-as-data) |
| **`configService`** | Cached resolver for `SystemConfiguration` with per-sector overrides |
| **`openaiService`** | Single OpenAI-compatible AI client (chat, JSON mode, Whisper) |
| **Bull / Bull-Board** | Redis-backed job queue and its admin dashboard |
| **Soft delete** | `deletedAt` marking with middleware that hides deleted rows by default |
| **Response envelope** | `{ success, data }` / `{ success, error:{code,message} }` standard |
| **`Paginated<T>`** | `{ items, meta:{ total, totalPages, page, pageSize } }` |
| **Public token page** | Unauthenticated candidate surface authorized by an opaque per-record token |
| **NYI** | Not Yet Implemented |

---

*End of document. This TAD reflects the system as implemented at baseline (2026-06-15). All sections were derived from direct inspection of the repository; absent capabilities are labeled Not Yet Implemented rather than assumed.*
