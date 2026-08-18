# AgnoHire Project Analysis

## Executive Summary

**AgnoHire** is a comprehensive **Enterprise AI-Powered Applicant Tracking System (ATS)** that unifies the complete hiring lifecycle in a single platform. Built as a **TypeScript monorepo** with a modular architecture, it combines intelligent automation (AI resume parsing, interview generation, video intelligence) with enterprise capabilities (GDPR compliance, audit trails, multi-tenancy, RBAC).

**Status:** All 14 functional modules + cross-cutting infrastructure are **complete and merged to main**.

---

## Project Structure

```
AgnoHire/
├── shared/                 # @agnohire/shared — single source of truth (types, Zod, constants)
├── server/                 # Express API + Prisma ORM + Bull queues
├── client/                 # React SPA (Vite) + Tailwind + TanStack Query
├── docker-compose.yml      # PostgreSQL 15 + Redis 7
├── package.json            # Root npm workspaces
├── tsconfig.base.json      # Shared TypeScript config
├── .env.example            # Environment variable template
└── .github/workflows/ci.yml # Build + typecheck pipeline
```

---

## Technology Stack

### Shared Package (`@agnohire/shared`)
- **TypeScript** — types, Zod schemas, role/permission constants
- **Zod** — schema validation (imported by server & client for consistency)
- **No runtime dependencies** (except Zod)

### Backend (Express API)

| Category | Technologies |
|----------|---------------|
| **Framework** | Express 4.21, Node.js 20+ |
| **Database** | PostgreSQL 15 + Prisma ORM (55 models, 9 migrations) |
| **Cache/Queue** | Redis 7 + Bull 4.16 (async job processing) |
| **Auth** | Passport 0.7 (Google OAuth), JWT, bcrypt |
| **Realtime** | Socket.IO 4.8 |
| **File Processing** | pdf-parse, pdfjs-dist, mammoth, tesseract.js (OCR), FFmpeg (audio) |
| **AI** | OpenAI API (chat, JSON mode, Whisper), provider-agnostic wrapper |
| **Code Execution** | Judge0 (coding assessments) |
| **Email** | Nodemailer 8 (config-driven SMTP) |
| **Logging** | Winston 3.17, Morgan |
| **Security** | Helmet 8, express-rate-limit, isomorphic-dompurify (XSS) |
| **Testing** | Vitest 4.1, Supertest 7.2 (66 integration tests) |

### Frontend (React SPA)

| Category | Technologies |
|----------|---------------|
| **Framework** | React 18.3, Vite 6, React Router 6 |
| **State Management** | Zustand (auth), TanStack Query 5 (remote data) |
| **Forms & Validation** | React Hook Form 7, Zod schemas from `@agnohire/shared` |
| **Styling** | Tailwind CSS 3.4, ShadCN, class-variance-authority |
| **Realtime** | Socket.IO client 4.8 |
| **HTTP** | Axios 1.7 |
| **Visualization** | Recharts 3.8 (analytics), Framer Motion (animations) |
| **Icons** | Lucide React |
| **ML on Client** | TensorFlow.js (BlazeFace face detection), ONNX Runtime |
| **Office Formats** | SheetJS (XLSX parsing/export) |
| **UI Feedback** | React Hot Toast |
| **Editor** | Monaco Editor (code input for assessments) |

---

## Architecture Patterns

### 1. Modular Monolith (not microservices)

- **Single Express process** — all services in code, no network hops between domains
- **42 domain services** — each encapsulates business logic for a functional area
- **Benefits:** transactional integrity, simpler ops, faster delivery
- **Trade-off:** whole-app scaling unit; horizontal scaling via stateless replicas (once containerized)

### 2. Contract-First Type Safety

- **Single `@agnohire/shared` package** — defines all DTOs, Zod schemas, role/permission constants
- **Zero schema drift** — both server (Zod parsing) and client (form validation) use identical schemas
- **Build dependency:** `shared` must build before `server` and `client` can typecheck

### 3. Config-as-Data (Zero Hardcoded Config)

**Tier 1: Bootstrap secrets (.env)**
```
DATABASE_URL, REDIS_URL, JWT_SECRET, ENCRYPTION_KEY, GOOGLE_CLIENT_ID
```

**Tier 2: Operational config (database)**
```
AI credentials, SMTP settings, rate limits, token lifetimes, proctoring thresholds, themes
```
- Stored in `SystemConfiguration` table
- Resolved at request-time via `configService` (cached ~30s)
- Changeable from Admin Console without redeploy
- Per-sector overrides supported

### 4. Fail-Closed Multi-Tenancy

```typescript
// Non-admin principal with sectorId = null matches NOTHING, never everything
WHERE sectorId = principal.sectorId  // or WHERE 1=0 if sectorId is null
```

- Every tenant-bounded query applies sector scope via Prisma AND
- Audit logs, GDPR requests, file downloads all sector-scoped
- Non-administrative superadmin see across sectors

### 5. Provider-Agnostic AI

**Single `openaiService` hub:**
- Targets any OpenAI-compatible endpoint (OpenAI, Gemini, Azure, local gateway)
- Methods: `chatCompletion(...)`, `chatJson<T>(...)`, `transcribeAudio(...)`
- Retry/backoff on 429/503
- **Graceful degradation:** with no key → friendly "configure a key" responses, never 500s

### 6. Asynchronous Processing (Bull + Redis)

**Producers → Redis Queue → Workers → Persist**

Offloaded workloads:
- Resume parsing
- Candidate fit scoring
- Interview answer scoring
- Video/transcript analysis
- Scheduled reminders

**Fallback (Redis down):** Workers run inline in-process (correct, latent)

### 7. Fail-Loud Security in Production

```javascript
if (env.isProd && !isRedisAvailable()) {
  logger.error('SECURITY: Redis unavailable → session/token revocation + rate limiting degraded');
}
```

- Per-instance in-memory fallback is unsafe for cluster-wide controls
- Production **refuses to silently degrade**

---

## Key Services & Responsibilities

### Identity & Access Control (authService, tokenService, roleService)
- JWT access tokens (15m TTL, config-driven)
- Rotating httpOnly refresh tokens (7d TTL, stored in DB, revocable)
- Google OAuth 2.0 (Passport)
- Dev email/password login (non-prod only, when OAuth unconfigured)
- 7 roles, 80+ permissions, permission-gated routes

### AI Hub (openaiService)
- Resume parsing → structured JSON (name, email, skills, experience)
- Job description generation
- Candidate↔job fit scoring (0–100, bias-guarded)
- Interview question generation + answer scoring
- Video/transcript intelligence (filler words, WPM, talk ratio, communication score, sentiment)
- Chatbot (FAQ keyword match → OpenAI fallback → canned answer)
- Analytics insights (AI narrative over KPIs)

### Resume Processing (resumeParseService)
- File extraction (PDF, DOCX, images)
- OCR (tesseract.js for scanned documents)
- AI extraction → structured JSON
- Automatic skill enrichment
- Candidate profile population

### Interview System (interviewService, publicInterviewService, interviewScoringService)
- Question generation (AI + template-based)
- Public token-based interview pages (/interview/:token)
- Live interview with video/audio capture
- Proctoring: camera/mic liveness, snapshot capture, face detection, screen-share requirement, violation tracking
- Candidate answer storage (text + recording)
- Interview result scoring (AI + manual)

### Video Intelligence (videoIntelligenceService, reviewService)
- Whisper transcription
- Deterministic metrics: filler words, talk ratio, WPM, speech rate, keywords
- AI analysis (communication, skill relevance, sentiment)
- Transcript storage in Attachment table
- Finite-guarded metrics (no NaN persistence)

### Pipeline & Kanban (pipelineService)
- Stage management (PENDING → HIRED/REJECTED)
- Drag-and-drop stage movement (Socket.IO live updates)
- Application status tracking
- Pipeline notes (threaded comments)

### Compliance & Audit (gdprService, auditService)
- Append-only audit logs (all mutations)
- GDPR data-subject rights (access, deletion, portability)
- Right-to-erasure (anonymize PII across candidate, resumes, interviews, chat)
- Consent management
- Data retention policies (auto-delete after X days)

### Configuration (configService)
- Loads `SystemConfiguration` from DB
- Caches with ~30s TTL
- Per-sector overrides
- AES-256-GCM decryption of secrets
- Secrets masked on read (`••••••••`)

---

## Data Model (55 Models, 9 Migrations)

### Core Entities

**Users & Roles:**
- `User` (fullName, email, passwordHash, roleId, sectorId, loginAttempts, lockedUntil)
- `Role` (7 roles)
- `Permission` (80+ granular permissions)
- `RolePermission` (role ↔ permission mapping)
- `OAuthAccount`, `UserSession`, `RefreshToken`

**Tenancy:**
- `Sector` (tenant/business unit)
- `Domain` (optional sub-grouping, hierarchical via parentId)

**Jobs & Candidates:**
- `JobRequisition` (title, description, skills, status: DRAFT/APPROVED/OPEN/CLOSED)
- `Candidate` (fullName, email, phone, sectorId, domainId)
- `Resume` (fileData: bytes, parsedData: JSON, parseStatus)
- `JobApplication` (job ↔ candidate, status tracking)

**Interviews:**
- `Interview` (candidateId, jobId, status, scheduledAt, violations)
- `InterviewQuestion`, `Question` (from question bank or AI-generated)
- `CandidateAnswer` (answer text + audio recording)
- `ProctorShot` (snapshot image bytes, timestamp)
- `InterviewSchedule` (interview ↔ interviewer ↔ calendar event)
- `PanelMember` (interview ↔ panelists)
- `InterviewResult` (AI scores, transcript summary)
- `InterviewFeedback` (panel feedback, scoring)

**Assessments:**
- `Assessment` (MCQ + coding)
- `AssessmentQuestion`, `AssessmentAnswer`
- `AssessmentAssignment` (candidate ↔ assessment, progress)

**Offers & Onboarding:**
- `Offer` (candidate, job, salary, startDate, status)
- `OfferDocument` (offer letter, contract, BGV report — stored as Attachment)
- `Onboarding` (1:1 with Offer, checklist tasks)

**Chatbot:**
- `ChatbotConversation` (per candidate + staff)
- `ChatMessage`
- `ChatbotFaq`

**Platform:**
- `SystemConfiguration` (config-as-data, category + key + value)
- `Theme` (light/dark, color palette)
- `Integration` (encrypted configJson for third-party services)
- `Notification` (in-app bell)
- `EmailTemplate` (offer, reminder, panel notifications)
- `EmailLog` (audit trail of sent emails)
- `Attachment` (generic file storage: bytes in DB)
- `AuditLog` (append-only, sector-scoped)
- `GdprRequest` (data-subject access/deletion requests)
- `DataRetentionPolicy` (auto-delete rules)
- `AnalyticsSnapshot` (KPI snapshots)

---

## API Architecture

### 25 Route Groups

| Route | Purpose |
|-------|---------|
| `/auth` | Login (dev/OAuth), token refresh, logout |
| `/system` | System config, themes, integrations |
| `/jobs` | Job requisitions CRUD, approval workflows |
| `/candidates` | Candidate records, bulk upload |
| `/applications` | Job applications, status |
| `/sourcing` | Sourcing channels, referrals, candidate lists |
| `/question-banks` | Question bank CRUD |
| `/interviews` | Interview setup, scheduling, management (staff) |
| `/interview` | **Public** interview page (token-authenticated) |
| `/schedules` | Interview scheduling, availability |
| `/assessments` | Assessment CRUD, assignments |
| `/assessment` | **Public** assessment page (token-authenticated) |
| `/reviews` | Interview reviews, transcripts, intelligence |
| `/pipeline` | Kanban board, stage movement |
| `/panels` | Panel assignment, feedback, consensus |
| `/offers` | Offer creation, documents, acceptance |
| `/analytics` | Funnel, KPIs, insights, CSV export |
| `/reference` | Lookup reference data (job roles, industries, etc.) |
| `/files` | File upload/download (generic Attachment store) |
| `/notifications` | In-app notification bell |
| `/chatbot` | Chatbot FAQ, conversations |
| `/audit` | Audit logs, search, export |
| `/gdpr` | GDPR requests, data export, deletion |
| `/admin` | Admin console (users, roles, sectors, config) |
| `/me` | Current user profile |

**Health/Readiness:**
- `/api/health` — liveness (process up?)
- `/api/ready` — readiness (DB reachable? Redis available?)

### Response Envelope

```json
{
  "success": true,
  "data": { ... }
}
```

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REFERENCE",
    "message": "...",
    "details": { "field": ["error1", "error2"] }
  }
}
```

### Pagination

```json
{
  "items": [ ... ],
  "meta": {
    "page": 1,
    "pageSize": 25,
    "total": 137,
    "totalPages": 6
  }
}
```

---

## Authentication & Authorization

### Authentication Flows

**Dev Email/Password (non-prod):**
1. `POST /api/auth/dev-login { email, password }`
2. Verify bcrypt hash
3. Issue JWT access token (15m) + httpOnly refresh token (7d)

**Google OAuth:**
1. `GET /api/auth/google` → redirect to Google
2. Google → `/api/auth/callback?code=...`
3. Verify code, fetch Google profile
4. Create or update User + OAuthAccount
5. Issue JWT + refresh token

**Token Refresh:**
1. `POST /api/auth/refresh` (cookie sent automatically)
2. Verify refresh token (check revocation in DB)
3. Issue new access token + rotated refresh token

**Logout:**
1. `POST /api/auth/logout`
2. Revoke session + refresh token
3. Clear httpOnly cookie

### Authorization Model

**7 Roles:**
- `SUPERADMIN` — unrestricted, cross-sector
- `ADMIN` — sector admin
- `HR` — hiring operations
- `RECRUITER` — sourcing & pipeline
- `HIRING_MANAGER` — job approval, panel decisions
- `PANEL_MEMBER` — interview feedback
- `CANDIDATE` — public portal access

**80+ Permissions** (e.g., `job.view`, `interview.decide`, `offer.manage`, `gdpr.manage`)

**Enforcement:**
```
authenticate → requirePermission() → Zod validate → service applies sector scope → Prisma
```

---

## Configuration & Secrets

### Environment Variables (.env)

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | **Yes** | Prisma PostgreSQL connection |
| `REDIS_URL` | Optional | Redis (defaults to `redis://localhost:6379`) |
| `JWT_SECRET` | **Yes** | Access token signing |
| `ENCRYPTION_KEY` | **Yes** | AES-256-GCM (must base64-decode to 32 bytes) |
| `GOOGLE_CLIENT_ID` | Optional | Enables Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Optional | Google OAuth secret |
| `NODE_ENV` | Optional | `development` or `production` |
| `PORT` | Optional | API port (default 4000) |
| `CLIENT_URL` | Optional | CORS origin (default `http://localhost:5173`) |

### Database Configuration (`SystemConfiguration`)

**Categories:** AI, SMTP, Limits, Tokens, Proctoring, UI

**Examples:**
- `ai.enabled` (bool)
- `ai.openai_api_key` (secret, encrypted)
- `ai.openai_model` (string)
- `email.host`, `email.port`, `email.user`, `email.password` (secrets, encrypted)
- `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`
- `ACCESS_TOKEN_TTL_MIN`, `REFRESH_TOKEN_TTL_DAYS`
- `MAX_WARNINGS`, `SNAPSHOT_INTERVAL_SEC`

---

## Security Controls

| Control | Implementation |
|---------|----------------|
| **Transport Security** | Helmet (security headers), trust proxy for client IPs |
| **CORS** | Whitelist origin, credentials flag |
| **Rate Limiting** | express-rate-limit + rate-limit-redis; 300ms window, 300 req/min default |
| **Authentication** | JWT (15m) + rotating httpOnly refresh (7d) |
| **Authorization** | Fail-closed sector scoping, permission-gated routes |
| **Input Validation** | Zod at controller boundary |
| **Output Sanitization** | isomorphic-dompurify (XSS prevention) |
| **Secrets at Rest** | AES-256-GCM encryption; masked on read; key validated at boot |
| **Audit Trail** | Append-only `AuditLog` (actor, action, before/after, device) |
| **Data Subject Rights** | GDPR access/deletion/portability; right-to-erasure |
| **Resource Scoping** | File downloads scoped to sector/owner (404, not 403) |
| **Production Safeguard** | Fail-loud if Redis unavailable in prod (security controls degraded) |

---

## Functional Modules (14 Complete)

### 1. Job Requisition & JD Management
- Create requisitions (DRAFT → APPROVED → OPEN → CLOSED)
- Approval workflows (multi-level)
- AI-generated JD
- Headcount tracking, budget ranges, skill tags

### 2. Resume Parsing & Candidate Screening
- File upload (PDF, DOCX, images)
- AI parsing → structured candidate data
- OCR support
- Bulk upload with CSV mapping
- Candidate profile auto-creation

### 3. Candidate Sourcing
- Internal search
- Referrals (with referrer tracking)
- Sourcing channels
- Candidate lists (create, manage, export)

### 4. AI Interview Engine
- Question generation (AI + templates)
- Question banks
- Live interview with video/audio
- Proctoring (camera/mic liveness, snapshots, face detection)
- Anti-cheat (violations, max warnings)

### 5. Interview Scheduling
- Availability matching
- Google Calendar sync
- Auto-scheduling algorithm
- Interview reminders

### 6. Skill Assessment
- MCQ assessments
- Coding assessments (Judge0 execution)
- Auto-scoring
- Assignment tracking

### 7. AI Analytics & Reporting
- Funnel metrics
- KPIs (conversion rates, time-to-hire)
- AI insights (narrative over data)
- CSV export

### 8. Video Interview Intelligence
- Whisper transcription
- Deterministic metrics (filler words, WPM, talk ratio)
- AI analysis (communication, sentiment, skills)
- Transcript storage

### 9. ATS Pipeline / Kanban
- Drag-and-drop stages
- Live Socket.IO updates
- Application tracking
- Threaded notes

### 10. Hiring Panel
- Panel assignment
- Feedback forms
- Consensus view
- Decision notifications

### 11. Offer & Onboarding
- Offer creation & PDF letters
- Document upload
- Public acceptance page (token-authenticated)
- Onboarding checklist

### 12. AI Chatbot
- FAQ seeding
- Keyword matching → OpenAI fallback
- Conversation history
- Graceful degradation (no AI key)

### 13. Security & GDPR Compliance
- Audit logs (append-only, searchable)
- GDPR requests (access, deletion, portability)
- Right-to-erasure (PII scrub)
- Consent management
- Data retention policies

### 14. Admin Console
- User/role/permission management
- Sector management
- System configuration
- Email templates
- Integrations
- Themes
- Queue monitoring (Bull-Board)

---

## Notable Implementation Details

### Media Handling

**Interview Proctoring Hook (useMediaProctor):**
- Single getUserMedia stream
- Liveness flags (cameraLive, micLive) from track events + devicechange listener
- Downscaled JPEG `capture()` for evidence
- Hardened against React mount/unmount reordering
- Track teardown before re-acquisition

**Audio Processing:**
- FFmpeg (child_process) converts WebM → MP3 before Whisper
- Whisper transcription via OpenAI API
- Transcript persisted in Attachment table

### Graceful Degradation

| Scenario | Behavior |
|----------|----------|
| Redis down | Bull workers run inline (correct, latent); rate limiting per-process |
| No AI key | "Configure a key" response; deterministic paths still work |
| SMTP unset | Email no-op; no errors |
| DB timeout on /ready | Return 503 (orchestrator stops routing) |

### Error Handling

Single `errorHandler` maps domain errors → HTTP status:
- `BadRequestError` → 400
- `UnauthorizedError` → 401
- `ForbiddenError` → 403
- `NotFoundError` → 404
- Prisma errors → appropriate codes

### Configuration Caching

`configService`:
- Loads `SystemConfiguration` from DB on boot
- Caches with ~30s TTL
- Resolves per-sector overrides
- Decrypts secrets (AES-256-GCM)
- Masks secrets on read

---

## Development & Deployment

### Quick Start

```bash
cp .env.example .env              # Edit secrets
npm install                       # Install all workspaces
npm run build:shared              # Shared types must build first
npm run db:up                     # Start Postgres + Redis
npm run db:migrate                # Apply migrations
npm run db:seed                   # Seed roles, permissions, dev admin
npm run dev                       # API (:4000) + SPA (:5173)
```

### Database Commands

| Command | Purpose |
|---------|---------|
| `npm run db:up` | Start Postgres + Redis containers |
| `npm run db:migrate` | Apply pending migrations (dev) |
| `npm run db:deploy` | Apply migrations (non-interactive, prod-style) |
| `npm run db:reset` | Drop all, replay migrations, reseed |
| `npm run db:seed` | Re-seed reference data |
| `npm run db:studio` | Prisma Studio (inspect data) |

### Build & Test

```bash
npm run build              # Typecheck + build all workspaces
npm run test --workspace=server  # Run 66 integration tests
```

### CI/CD

**Implemented:** `.github/workflows/ci.yml`
- Trigger: push to main, PR
- Actions: checkout, setup Node 20, npm ci, npm run build
- Validates types & build integrity across all workspaces
- **Test suite is NOT in CI** (requires live DB + Redis)

**Not Yet Implemented:**
- Automated test execution in CI
- Lint/format gating
- Security scanning
- Container build/publish
- Deployment stage

---

## Production Readiness Assessment

### ✅ Complete & Operational

- Application code (routes, controllers, services)
- Data model (55 models, 9 migrations, reproducible)
- Authentication & authorization (JWT, OAuth, RBAC)
- AI subsystem (provider-agnostic OpenAI wrapper)
- Queue/event processing (Bull + Redis)
- Realtime notifications (Socket.IO)
- Security controls (encryption, audit, GDPR)
- Documentation (README, TECHNICAL_ARCHITECTURE.md)

### ⚠️ Not Yet Implemented (Production Gaps)

- **Container packaging** — No application Dockerfile; only docker-compose for stateful services
- **Kubernetes/Helm** — No K8s manifests or Helm charts
- **CI/CD deployment** — Builds but doesn't deploy
- **Observability** — No Prometheus, OpenTelemetry, Sentry, Grafana
- **Socket.IO Redis adapter** — Single-instance realtime only
- **Automated backups** — No backup tooling; depends on managed DB layer
- **Object storage** — Blobs in PostgreSQL (scalable offload to S3/GCS is future work)
- **WAF/SAST/DAST** — Security scanning not gated
- **Biometric face matching** — Enrollment frame captured, but no matching logic

---

## Key Takeaways

1. **Unified System of Record** — 14 functional modules across hiring lifecycle, not bolt-on tools
2. **Enterprise-Grade Security** — Audit trails, GDPR compliance, fail-closed authorization, encrypted secrets
3. **AI-First, Provider-Neutral** — Consistent AI integration via configurable OpenAI-compatible endpoint
4. **Config-as-Data** — Operational knobs (AI keys, SMTP, rate limits) in database, changeable at runtime
5. **TypeScript Monorepo** — Single source of truth for types/schemas; eliminates client/server drift
6. **Modular but Monolithic** — Services in code, transactional integrity, simpler ops than microservices
7. **Multi-Tenant by Design** — Sector-scoped, fail-closed; prevents accidental data leaks
8. **Production-Ready Code** — Complete application layer; containerization & observability are operator responsibilities

---

## Where to Start

1. **Review the codebase structure:** `/server/src/services` (domain logic), `/client/src/pages` (UI)
2. **Understand the data model:** `server/prisma/schema.prisma`
3. **Trace an API flow:** e.g., `/api/jobs` → jobRoutes → jobController → jobService → Prisma
4. **Run locally:** `npm run setup && npm run dev`
5. **Explore admin console:** Visit `/admin` (dev admin: admin@agnohire.local / Admin@12345)
6. **Check the docs:** README.md, TECHNICAL_ARCHITECTURE.md, TECHNOLOGIES.md

