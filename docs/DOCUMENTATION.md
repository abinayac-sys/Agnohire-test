# AgnoHire — Project Report & Technical Documentation

**Enterprise AI-Powered Applicant Tracking System (ATS) & AI Interview Platform**

| | |
|---|---|
| **Project name** | AgnoHire |
| **Document type** | Project Report + Technical Documentation |
| **Version** | **2.0 — Multi-tenant SaaS.** The v1.x single-deployment ATS became a true SaaS product: **tenants (workspaces)** above the existing sector model, a **plan / subscription / quota** entitlement system with **Razorpay** billing, a **platform-operator console** (plans, workspace accounts, approval queue, maintenance windows), **self-serve registration** with an approval gate, **self-service password reset**, and **PostgreSQL Row-Level Security** as a second isolation layer beneath the application. |
| **Prior version** | 1.1 — 14-module spec + cross-cutting infrastructure ("Section B"); Google Calendar/Meet dynamic config, scheduling lifecycle, bidirectional Screening↔Pipeline sync, HR Approval Queue, contextual chatbot. The **Hiring Panel module (M10) was removed** in that line and remains removed. |
| **Status** | Feature-complete and in active hardening. **97/97 automated tests across 17 files passing.** An end-to-end audit of the running app (see `ISSUES_AND_SOLUTIONS.md`) closed 4 critical/high issues; **3 high/medium isolation issues remain open** — see [§21](#21-roadmap--future-scope). |
| **Last updated** | 2026-07-14 |
| **Repository** | `https://github.com/VarunRK04/AgnoHire_Cloud_Test` (remote `cloudtest`, branch `main`) — the cloud-testing line. The v1.x product repo is `https://github.com/VarunRK04/AgnoHire.git`. |
| **License** | Proprietary |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Introduction](#2-introduction)
   - 2.1 [Background & Motivation](#21-background--motivation)
   - 2.2 [Problem Statement](#22-problem-statement)
   - 2.3 [Objectives](#23-objectives)
   - 2.4 [Scope](#24-scope)
3. [Requirements Specification](#3-requirements-specification)
   - 3.1 [Functional Requirements](#31-functional-requirements)
   - 3.2 [Non-Functional Requirements](#32-non-functional-requirements)
4. [System Architecture](#4-system-architecture)
5. [Technology Stack](#5-technology-stack)
6. [Repository Structure](#6-repository-structure)
7. [Core Design Principles](#7-core-design-principles)
8. [Security & Access Control](#8-security--access-control)
9. [Data Model](#9-data-model)
10. [User Roles & Personas](#10-user-roles--personas)
11. [Module Reference](#11-module-reference)
12. [Key Workflows](#12-key-workflows)
13. [API Surface](#13-api-surface)
14. [Testing & Quality Assurance](#14-testing--quality-assurance)
15. [Development Methodology & Timeline](#15-development-methodology--timeline)
16. [Local Development & Setup](#16-local-development--setup)
17. [Deployment Guide](#17-deployment-guide)
18. [Operational Notes & Known Gotchas](#18-operational-notes--known-gotchas)
19. [Challenges & Solutions](#19-challenges--solutions)
20. [Results & Outcomes](#20-results--outcomes)
21. [Roadmap & Future Scope](#21-roadmap--future-scope)
22. [Glossary](#22-glossary)
23. [Appendices](#23-appendices)

---

## 1. Executive Summary

**AgnoHire** is a full-lifecycle, multi-tenant recruitment platform that carries a hiring
organization from **job requisition** all the way through **sourcing, screening,
AI-assisted interviewing, scheduling, analytics, offer, and onboarding**. It is an
enterprise-grade Applicant Tracking System (ATS) augmented with an AI interview engine,
video-interview intelligence, an FAQ-grounded support chatbot, and a built-in compliance
(audit + GDPR) toolkit.

The platform was delivered as an incremental implementation of a **14-module specification**.
All 14 modules were built, individually live-verified, and merged to `main`, alongside a
cross-cutting infrastructure layer ("Section B": automated tests, SMTP email, real file
uploads, and realtime notifications). After feature completion the codebase was hardened
through **four successive production-readiness audits** covering stability, authentication/
session security, access control & tenant isolation, and business-logic integrity.

### What changed in v2.0 — from product to SaaS

v1.x was a single-organization deployment whose unit of isolation was the **sector** (a business
unit inside one company). v2.0 adds a **tenant** (customer-facing name: **workspace**) *above*
the sector, turning the same application into a multi-customer SaaS product. Concretely:

- **Tenancy.** A `Tenant` model now owns nearly every row. Isolation is enforced at a **single
  Prisma choke point** (`server/src/config/database.ts`) that stamps `tenantId` onto creates and
  merges it into every read/update/delete `where` — so a service *cannot forget* to scope a query.
  Tenant identity comes from an `AsyncLocalStorage` context set from the **verified JWT**, never
  from a client-supplied header or body.
- **Defense in depth: PostgreSQL Row-Level Security.** Beneath the application, the app connects
  as a **restricted DB role** (`agnohire_app`) and every tenant table carries an RLS policy keyed
  on the `app.tenant_id` / `app.bypass` transaction-scoped GUCs the choke point sets per query.
  If an application-layer scope were ever missed, the database itself still refuses the row.
  Migrations run separately under a privileged role via `DIRECT_URL`.
- **Plans, quotas & billing.** `Plan` / `Subscription` / `UsageCounter` back a central
  `entitlementService`. Five plan tiers (`FREE`, `STARTER`, `PRO`, `ENTERPRISE`,
  `LEGACY_ENTERPRISE`) meter five usage metrics (`USERS`, `CANDIDATES`, `ACTIVE_JOBS`,
  `INTERVIEWED_CANDIDATES`, `SCHEDULES`) plus storage and AI/proctoring feature flags. **Limits
  are enforced server-side at the write path** (HTTP 402 on breach); the client only mirrors the
  state for UX. **Razorpay** provides subscriptions, a signature-verified webhook, and checkout.
- **Two new roles.** `TENANT_OWNER` (owns a workspace: billing, config, users) and
  `PLATFORM_SUPERADMIN` (the cross-tenant operator). The legacy `SUPERADMIN` was scoped down to
  its own tenant.
- **Platform console + go-to-market flow.** Operators get a console for **plans**, **workspace
  accounts** (with usage), an **approval queue**, workspace impersonation ("log into workspace"),
  owner-password reset, and **scheduled maintenance notices**. Self-serve signups land in
  `PENDING` and stay inert until marketing approves them — free-email domains are flagged for
  triage rather than blocked.
- **Per-workspace role customization.** Roles stay global, but a `TenantRolePermission` override
  table lets each workspace edit its own permission grants without leaking the change to others.
- **Accounts.** Self-service **password reset** (forgot/reset) and email verification, plus
  superadmin-triggered owner reset.

**Key characteristics:**

- **Two-level, fail-closed tenancy** — **tenant (workspace)** is the hard isolation boundary,
  enforced twice (Prisma choke point **and** Postgres RLS); **sector** remains the finer-grained
  business-unit scope *within* a tenant. A user scoped to one tenant/sector provably cannot see
  another's candidates, jobs, pipelines, offers, or audit logs.
- **AI as an optional layer, never a hard dependency** — every AI feature (JD generation,
  résumé parsing, interview/assessment scoring, analytics insights, video intelligence,
  chatbot) degrades gracefully to deterministic behavior when no API key is configured.
- **Provider-agnostic AI** — the AI layer speaks the OpenAI API contract but is base-URL
  configurable, so OpenAI, **Google Gemini** (verified end-to-end), Azure OpenAI, or a local
  gateway all work with zero code change.
- **Zero hardcoded configuration** — only infrastructure secrets live in `.env`; everything
  else (SMTP, API keys, rate limits, themes, integrations, permissions) lives in the database
  and is edited from the Admin Console, with secrets encrypted at rest (AES-256-GCM).

**Scale of the system (verified figures, 2026-07-14):** **70 Prisma data models** · **41 granular
permissions** across 13 functional groups (the two `PANEL_*` permissions are inert) · **9 user
roles** · ~45 backend service modules · ~70 frontend pages · **35 database migrations** ·
**97/97 automated integration tests across 17 files passing**, alongside a live end-to-end audit
of the running application (server + client + Postgres + Redis) whose findings and fixes are
tracked in `ISSUES_AND_SOLUTIONS.md`.

---

## 2. Introduction

### 2.1 Background & Motivation

Hiring is a high-stakes, high-volume, multi-stakeholder process. A modern recruiting
organization juggles requisition approvals, résumé screening, candidate sourcing, multiple
interview formats (automated, live, panel), assessments, scheduling across time zones, offer
negotiation, background verification, onboarding, and a growing burden of data-protection
compliance (GDPR/data-subject rights). Off-the-shelf ATS products tend to be either rigid
SaaS suites that resist customization or thin trackers that punt on AI, compliance, and
multi-tenant isolation.

AgnoHire was built to demonstrate that a **single, coherent, type-safe codebase** can cover
the entire recruiting lifecycle while staying:

- **Safe** — multi-tenant from the ground up, security-audited, compliance-aware.
- **AI-native but AI-optional** — leveraging LLMs where they add value without making the
  product unusable when the key is absent or the provider is down.
- **Operable** — observable, gracefully degrading, and configurable at runtime without code
  deploys.

### 2.2 Problem Statement

> Build an enterprise recruitment management platform that manages the **complete** hiring
> lifecycle for **multiple isolated business sectors** within one deployment, integrates AI
> assistance at every stage **without** becoming dependent on it, enforces strict
> role-based access control and data-protection compliance, and can be configured and
> operated entirely at runtime through an admin console rather than code changes.

### 2.3 Objectives

| # | Objective | Outcome |
|---|-----------|---------|
| O1 | Cover the full hiring lifecycle (requisition → onboarding) | ✅ 14 modules delivered |
| O2 | Enforce multi-sector data isolation that fails closed | ✅ sector scoping in every service, regression-tested |
| O3 | Layer optional AI on deterministic behavior | ✅ every AI path graceful-degrades |
| O4 | Make AI provider-agnostic | ✅ OpenAI-compatible, verified on Gemini |
| O5 | Granular RBAC with no privilege-escalation paths | ✅ 41 permissions, escalation guards audited |
| O6 | Runtime configuration with secrets encrypted at rest | ✅ DB-backed config, AES-256-GCM |
| O7 | Built-in compliance (audit trail + GDPR rights) | ✅ Module 13 |
| O8 | Operate-for-real infrastructure (email, files, realtime, tests) | ✅ Section B |
| O9 | Production-readiness hardening | ✅ four audits, all fixes additive |
| O10 | **(v2)** Serve many customer organizations from one deployment | ✅ `Tenant` model + Prisma tenancy choke point |
| O11 | **(v2)** Make isolation survive a developer mistake | ✅ PostgreSQL RLS as a second, independent layer |
| O12 | **(v2)** Monetize with metered plans and self-serve signup | ✅ plans/quotas/entitlements + Razorpay + approval gate |

### 2.4 Scope

**In scope (delivered — v2 SaaS layer):**
- Multi-tenant workspaces with a two-layer isolation guarantee (Prisma choke point + Postgres RLS)
- Plans, subscriptions, metered usage quotas, and entitlement enforcement at the write path
- Razorpay billing (subscription create/change/cancel, signature-verified webhook, checkout)
- Platform-operator console: plans, workspace accounts, approval queue, impersonation, maintenance windows
- Self-serve registration + email verification + marketing approval gate; self-service password reset
- Per-workspace role/permission overrides (`TenantRolePermission`)

**In scope (delivered — v1 hiring product):**
- Job requisition & JD management with approval workflow
- Résumé parsing & candidate screening
- Candidate sourcing (referrals, channels, curated lists)
- AI interview engine (token-based public interviews, anti-cheat, auto-grading, AI scoring)
- Interview scheduling (UTC slot engine, conflict detection, reminders)
- Skill assessments (builder, assignment, scoring)
- AI analytics & reporting (KPIs, funnel, time-series, CSV export, snapshots)
- Video interview intelligence (transcript metrics + AI scoring + reviewer workflow)
- ATS pipeline / Kanban board (bidirectional status ↔ stage sync with Screening)
- HR Approval Queue (post-interview review → approve/reject before offer)
- Offer & onboarding (lifecycle, documents, BGV, checklist)
- AI chatbot (staff demo, FAQ admin, candidate portal, transcripts)
- Security & GDPR compliance (audit-log viewer, data-subject requests, consent, retention)
- Admin console (users, roles/permissions, sectors/domains, integrations, email templates, system config)
- Cross-cutting infrastructure: SMTP email, real file uploads, realtime notifications, automated test suite

**Out of scope / deferred (documented, not spec gaps — see [§21](#21-roadmap--future-scope)):**
- Live LinkedIn sourcing integration (scaffolded)
- Google Calendar **two-way** sync — one-way write (event + Meet link creation, and event
  deletion on cancel) is **live and config-driven** as of v1.1; inbound sync from Google is deferred
- Whisper-based automatic transcription (scaffolded; transcripts are ingested as text today)
- Cursor/keyset pagination for the highest-volume lists (currently OFFSET-based)
- A public candidate e-signature portal for offers (staff currently records acceptance)

---

## 3. Requirements Specification

### 3.1 Functional Requirements

Functional requirements map one-to-one onto the module reference ([§11](#11-module-reference)).
Summarized by module:

| Module | Core functional requirement |
|--------|-----------------------------|
| M1 Job Requisition | Create/manage jobs with multi-step approval, reusable templates, configurable approvers, AI JD generation |
| M2 Résumé & Screening | Candidate CRUD, résumé upload + async parse, AI fit-scoring, bulk import, recruiter assignment |
| M3 Sourcing | Referrals, sourcing channels, curated candidate lists with bulk assign, talent search |
| M4 AI Interview Engine | Question banks, token-based public interview, anti-cheat proctoring, MCQ auto-grade, AI Q&A scoring |
| M5 Scheduling | UTC slot engine, working-hours guards, conflict detection, automated reminders |
| M6 Assessments | Assessment builder, bulk assignment, token-based take page, auto + AI scoring |
| M7 Analytics | KPI dashboard, hiring funnel, time-series, breakdowns, CSV export, savable snapshots, AI insights |
| M8 Video Intelligence | Transcript metrics (always-on) + AI scoring, proctoring integrity, reviewer workflow |
| M9 Pipeline | Drag-and-drop Kanban over application stages, append-only notes, **bidirectional** stage↔status sync with Screening |
| ~~M10 Panel~~ | **Removed** in a post-1.0 revision (was: panelist assignment, structured feedback, weighted consensus, final decision) |
| HR Approval | Post-interview HR review queue → consolidated report → approve/reject before offer |
| M11 Offer & Onboarding | Offer lifecycle, signature capture, document management, BGV, onboarding checklist |
| M12 Chatbot | FAQ-grounded assistant, AI fallback, staff demo + candidate portal, transcript viewer |
| M13 Compliance | Audit-log viewer, GDPR ACCESS/PORTABILITY/DELETION, consent, retention policies |
| M14 Admin Console | Users, roles/permissions matrix, sectors/domains, integrations, email templates, system config |

### 3.2 Non-Functional Requirements

| Category | Requirement | How it's met |
|----------|-------------|--------------|
| **Security** | RBAC with least privilege; no privilege escalation | 41 permissions, `requirePermission`/`requireAnyPermission` guards, escalation guards (§8) |
| **Tenancy** | Strict tenant isolation, fail-closed, defense-in-depth | **(1)** Prisma choke point stamps/merges `tenantId` on every query; **(2)** Postgres RLS policies on every tenant table, enforced against a restricted DB role. Sector scoping nests inside a tenant; null sector ⇒ matches nothing |
| **Entitlements** | Plan limits cannot be bypassed from the client | `entitlementService` checks quotas server-side at the write path; HTTP 402 on breach. The client mirrors state for UX only |
| **Confidentiality** | Secrets encrypted at rest; tokens not stored in plaintext | AES-256-GCM for config secrets; refresh tokens SHA-256 hashed |
| **Availability** | Graceful degradation when dependencies are down | AI optional; Redis-optional (inline queue fallback, in-memory rate limit); readiness probe |
| **Reliability** | No silent data corruption; atomic multi-write flows | Prisma `$transaction` for offer-accept, role-permission replace, GDPR erasure |
| **Performance** | Paginated lists; indexed hot tables | Server-side pagination everywhere; `AuditLog` composite indexes |
| **Maintainability** | Single source of truth for contracts | `shared/` Zod schemas + types consumed by client and server |
| **Operability** | Runtime config without redeploys | DB-backed `SystemConfiguration`, edited from Admin Console |
| **Observability** | Structured logging; liveness + readiness probes | Winston; `/health` (liveness), `/api/ready` (DB hard, Redis soft) |
| **Compliance** | Auditability + data-subject rights | App-wide `recordAudit` stream; GDPR export/erasure/consent/retention |
| **Portability** | Provider-agnostic AI | OpenAI-compatible client with configurable base URL |

---

## 4. System Architecture

AgnoHire is a **TypeScript monorepo** with three npm workspaces — `shared`, `server`, and
`client` — sharing a single contract layer.

```
┌─────────────┐     imports types/schemas     ┌─────────────┐
│   client/   │ ◀──────────────────────────── │   shared/   │
│ React + Vite│                                │ types + Zod │
└──────┬──────┘                                └──────┬──────┘
       │ HTTP (/api proxy) + WebSocket               │ imports
       ▼                                              ▼
┌──────────────────────────────────────────────────────────┐
│                        server/                             │
│  Express · Prisma · Bull queues · Passport · Socket.IO     │
│  ┌────────────┐  ┌────────────┐  ┌──────────────────────┐  │
│  │  routes/   │→ │controllers/│→ │      services/       │  │
│  │ (mount)    │  │ (HTTP I/O) │  │ (business + scoping) │  │
│  └────────────┘  └────────────┘  └─────────┬────────────┘  │
│  middlewares: authenticate · rbac · soft-delete · error    │
└───────────┬───────────────────────────────┬──────────────┘
            ▼                                ▼
     ┌────────────┐                   ┌────────────┐
     │ PostgreSQL │                   │   Redis    │
     │  (Prisma)  │                   │ (Bull/cache│
     │            │                   │  /rate-lim)│
     └────────────┘                   └────────────┘
```

**Layered request flow (server):**
`route → middleware (authenticate → tenant context → rbac → entitlements) → controller → service
→ Prisma tenancy choke point → PostgreSQL (RLS) `.
Business rules live in the **service** layer; **tenant** isolation is *not* left to services — it
is applied centrally (see below), and sector scoping nests inside it.

### The tenancy choke point (v2 — the most important design decision)

Rather than trusting ~45 services to remember `where: { tenantId }`, isolation is enforced in one
place and backstopped by the database:

```
auth.middleware  ──▶  AsyncLocalStorage TenantContext { tenantId, bypass }
   (from verified JWT — NEVER a client header/body)
                          │
                          ▼
config/database.ts  ──▶  Prisma $extends + $use middleware
   • CREATE  : stamps  data.tenantId = ctx.tenantId
   • READ/UPDATE/DELETE : merges where.tenantId = ctx.tenantId (or '__none__' ⇒ fail closed)
   • per query, opens a tx and runs:
        SELECT set_config('app.tenant_id', <tenant>, true),
               set_config('app.bypass',    on|off,   true)
                          │
                          ▼
PostgreSQL  ──▶  Row-Level Security policies on every tenant table,
                 evaluated for the restricted role `agnohire_app`
```

`runAsPlatform()` opens a deliberate cross-tenant window for platform operators and system jobs;
`runWithTenant(tenantId, …)` is how background workers act on behalf of one tenant. Both are
explicit and greppable — the default is always "scoped".

- **`shared`** is the contract: Zod schemas + TypeScript types + role/permission/enum
  constants, consumed by both server and client. The server reads the **compiled**
  `shared/dist`, so the shared package must be rebuilt after any change.
- **`server`** exposes a REST API under `/api`, persists through Prisma, and offloads
  long-running work (résumé parsing, transcript analysis, reminders) to **Bull queues backed
  by Redis**, falling back to **inline execution** when Redis is unavailable. Realtime updates
  (notifications, live Kanban) are pushed over **Socket.IO**.
- **`client`** is a single-page React application that proxies `/api` to the server in
  development and subscribes to Socket.IO rooms for live updates.

**Vertical-slice organization.** Each feature is a vertical slice — a route file, a
controller, a service, shared schemas/types, and a client page + API client — so a module can
be reasoned about (and audited) end-to-end in isolation.

---

## 5. Technology Stack

### Backend (`server/`)
- **Runtime:** Node.js 20+, TypeScript (strict)
- **Web framework:** Express
- **ORM:** Prisma → PostgreSQL 15
- **Queues/cache:** Redis 7 + Bull
- **Tenancy:** `AsyncLocalStorage` tenant context + a Prisma choke point, backed by **PostgreSQL
  Row-Level Security** against a restricted DB role (app uses `DATABASE_URL`; migrations use a
  privileged `DIRECT_URL`)
- **Billing:** **Razorpay** (`razorpay` SDK) — subscriptions, checkout, signature-verified webhook
- **Auth:** Passport.js — Google OAuth + JWT (access token) with an HTTP-only refresh cookie;
  **bcrypt** password hashing; token-based email verification + password reset
- **Realtime:** Socket.IO
- **Logging:** Winston
- **Security headers:** Helmet
- **Crypto:** AES-256-GCM for secrets at rest; SHA-256 for refresh-token hashing
- **Email:** Nodemailer (DB-configured SMTP, per-workspace branding/logo)
- **Documents:** `pdfkit` (generation), `pdf-parse` / `pdfjs-dist` (résumé extraction)
- **Calendar:** `googleapis` (Google Calendar + Meet)
- **Rate limiting:** `express-rate-limit` + `rate-limit-redis` (Redis store with in-memory fallback)

### Frontend (`client/`)
- **Framework:** React 18 + Vite
- **Styling:** Tailwind CSS (token-based theme via CSS custom properties) + ShadCN-style components
- **State/data:** Zustand (client state) + TanStack Query (server state)
- **Forms:** react-hook-form + Zod resolver
- **Routing:** React Router
- **Realtime:** socket.io-client
- **UX:** lucide-react icons, react-hot-toast, framer-motion

### Shared (`shared/`)
- TypeScript types, Zod validation schemas, and role/permission/enum/config-key constants —
  the single source of truth for request/response shapes.

### AI
- OpenAI-compatible chat-completions client (JD generation, résumé parsing, interview/
  assessment scoring, analytics insights, video intelligence, chatbot). **Base-URL
  configurable** — verified end-to-end against **Google Gemini** (`gemini-2.5-flash`) via its
  `/v1beta/openai` compatibility endpoint. All AI is **optional** and gated on a configured key.

### Tooling / Ops
- **Testing:** Vitest + Supertest (black-box integration tests against a live server)
- **CI:** GitHub Actions (typecheck + build across all three workspaces)
- **Containers:** Docker Compose (PostgreSQL + Redis)

---

## 6. Repository Structure

```
AgnoHire/
├── shared/
│   └── src/
│       ├── constants/   roles (9), permissions (41), enums, configKeys, themes
│       ├── schemas/     Zod schemas (job, candidate, pipeline, offer, audit, gdpr, billing, …)
│       └── types/       API response/DTO types (incl. billing.ts — plans, usage, workspaces)
├── server/
│   ├── prisma/
│   │   ├── schema.prisma   70 models
│   │   ├── migrations/     35 additive, ordered migrations (incl. the 4-phase RLS rollout)
│   │   └── seed.ts         idempotent seed (roles, perms, plan catalogue, theme, config, users, …)
│   └── src/
│       ├── routes/       Express routers (mounted under /api)
│       ├── controllers/  request handlers (HTTP I/O only)
│       ├── services/     business logic (~45 modules; entitlements, billing/, sector scoping)
│       ├── middlewares/  authenticate, tenant, rbac, entitlements, error handling, rate limiter
│       ├── jobs/         Bull queue definitions + dispatch (queue-or-inline)
│       ├── config/       database.ts (Prisma singleton + tenancy choke point + soft-delete),
│       │                 tenantContext.ts (AsyncLocalStorage), socket, encryption
│       └── utils/        token helpers, errors, etc.
│   └── tests/            17 Vitest+Supertest integration files (97 tests)
├── client/
│   └── src/
│       ├── pages/        ~70 feature pages (jobs, candidates, pipeline, offers, admin, platform/, …)
│       ├── services/     typed API clients (one per domain)
│       ├── config/       navigation, route gating
│       ├── components/   shared UI (ErrorBoundary, StatCard, FileUploadButton, NotificationCenter, …)
│       ├── layouts/      AppLayout (sidebar + navbar + routed Outlet)
│       └── styles/       globals.css (theme tokens)
├── .github/workflows/ci.yml   typecheck + build gate
├── docker-compose.yml          PostgreSQL + Redis
├── .env.example                infrastructure-secret template
├── README.md
├── CLAUDE.md                   repo rules (remote pinning)
└── docs/
    ├── DOCUMENTATION.md        (this file)
    ├── ISSUES_AND_SOLUTIONS.md live-audit findings, fixes, and open issues
    ├── SAAS_MIGRATION_RUNBOOK.md
    ├── SESSION_SUMMARY.md      running build log
    └── rls-defense-in-depth-spike.md
```

---

## 7. Core Design Principles

These are **non-negotiable** invariants enforced across the codebase:

1. **TypeScript everywhere, strict mode.** Shared types live in `shared/` and are the single
   source of truth for request/response shapes. The same Zod schema validates a request on the
   server and powers the form resolver on the client.

2. **Soft deletes only.** No row is ever hard-`DELETE`d for soft-delete models; instead
   `deletedAt = now()` is set, and a global Prisma middleware adds `WHERE deletedAt IS NULL`
   to every read. The middleware is **model-scoped** via a `SOFT_DELETE_MODELS` set —
   join/child tables that are append-only (e.g. `PipelineNote`, `PanelMember`,
   `InterviewFeedback`, `OfferDocument`, `Onboarding`) are intentionally excluded and have
   no `deletedAt` column.

3. **All list APIs are paginated** — server-side, with filters and sort passed as URL params.
   The response shape is uniform: `{ items, meta: { page, pageSize, total, totalPages } }`.
   (Consume `data.meta.total`, not `data.total`.)

4. **Zero hardcoded config.** The only values read from `.env` are infrastructure secrets:
   `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `SESSION_SECRET`, `ENCRYPTION_KEY`,
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NODE_ENV`, `PORT`, `CLIENT_URL`. Everything
   else — SMTP, third-party API keys, rate limits, themes, permissions — lives in the
   database and is edited from the Admin Console. Secrets at rest are AES-256-GCM encrypted.

5. **Graceful AI degradation.** Every AI branch is gated on
   `configService.isConfigured(CONFIG_KEYS.OPENAI_API_KEY, sectorId)`. Without a key the
   system returns deterministic fallbacks (helpful 400s for generation, skipped scoring with
   MCQ auto-grading still active, deterministic analytics highlights, transcript metrics with
   null AI fields, canned chatbot answers).

6. **Sector scoping is centralized in services.** Both REST and WebSocket entry points pass
   through the same service-layer scope computation, so isolation can't be bypassed by a
   channel that forgot to apply it.

7. **(v2) Tenant isolation is never a service's responsibility.** `tenantId` is applied by the
   Prisma choke point, not by hand-written `where` clauses, and is derived only from the verified
   JWT. Any cross-tenant read must be an explicit, greppable `runAsPlatform()` / `runWithTenant()`.
   Postgres RLS independently enforces the same boundary, so an application-layer mistake is
   contained rather than exploitable.

8. **(v2) Entitlements are enforced server-side at the write path.** The client mirrors plan
   limits purely for UX (disabled buttons, usage meters); the authoritative check lives in
   `entitlementService` and returns **402** when a quota is exhausted or the subscription is
   inactive. A workspace suspended by an operator is read-only.

---

## 8. Security & Access Control

### Authentication
- **Login:** `POST /api/auth/dev-login` (`{ email, password }`) — password login is gated by the
  `ALLOW_PASSWORD_LOGIN` flag; Google OAuth is the production path.
- **Registration (v2):** `POST /api/auth/register` creates a workspace + owner. Signups land in
  `approvalStatus = PENDING` and are **inert until a platform operator approves** them — the
  client shows a "workspace under review" holding page rather than a session. Free-email domains
  (`isFreeEmailDomain`) are **flagged for triage, not blocked**. Paid plans return a Razorpay
  `CheckoutBootstrap`.
- **Password reset (v2):** self-service `POST /api/auth/forgot-password` → `POST
  /api/auth/reset-password` (single-use, expiring token), plus an operator-triggered
  `POST /api/platform/workspaces/:id/reset-owner-password`. Passwords are bcrypt-hashed.
- **Email verification (v2):** `POST /api/auth/verify-email`.
- **Tokens:** short-lived JWT access token returned in `data.accessToken` (held in memory on
  the client, never in `localStorage`); refresh token in an HTTP-only cookie (`secure` +
  `sameSite=strict` in production).
- **Refresh tokens are stored hashed** (SHA-256) at rest — a DB read never yields usable
  session tokens. Rotation is single-flight; replaying a rotated token revokes the whole
  token family (theft signal).
- **Session revocation** (`authService.revokeUserSessions`) is wired into logout **and** into
  admin deactivate / role-change / password-reset, so access is cut immediately rather than
  lingering until the access token expires. The revocation flag's TTL derives from
  `ACCESS_TOKEN_TTL_MIN` (it can't expire before the token it revokes). Backed by Redis.

### Authorization (RBAC)
- Permissions are defined in `shared/constants/permissions.ts` (`PERMISSIONS`,
  `PERMISSION_DEFS`, `DEFAULT_ROLE_PERMISSIONS`) — **41 permissions across 13 functional
  groups** (see [Appendix A](#appendix-a--permission-catalogue)). The seed is **idempotent** —
  re-running it syncs permissions and role mappings.
- Route guards:
  - `requirePermission(...all)` — caller must hold **all** listed permissions.
  - `requireAnyPermission(...any)` — caller must hold **at least one** (added in Module 10).
  - **SUPERADMIN** bypasses all checks.

### Multi-Tenant Data Isolation (v2) — two independent layers

**Layer 1 — the Prisma choke point** (`server/src/config/database.ts`). Every query for a model
carrying a `tenantId` is rewritten centrally: creates are **stamped** with the caller's tenant;
reads/updates/deletes have `tenantId` **merged into the `where`**. A context with no tenant
resolves to the sentinel `'__none__'`, which matches nothing — **fail closed**. The tenant comes
from an `AsyncLocalStorage` context populated from the **verified JWT only**; no header or body
field can influence it.

**Layer 2 — PostgreSQL Row-Level Security.** Rolled out across migrations
`20260708130000_rls_phase1_restricted_role` → `…_phase4_enable_remaining`:

1. **Phase 1** — the app connects as a **restricted role** (`agnohire_app`) that cannot bypass
   RLS; migrations/seeds use a separate privileged connection (`DIRECT_URL`).
2. **Phase 2** — the choke point sets transaction-scoped GUCs on the same connection as the query
   (`set_config('app.tenant_id', …, true)`, `set_config('app.bypass', …, true)`), using Prisma's
   array-form `$transaction` so the config and the statement share one connection.
3. **Phase 3** — tenant-isolation **policies** keyed on those GUCs.
4. **Phase 4** — RLS **enabled** on all tenant tables; pre-auth/public paths (login, registration,
   public interview/assessment tokens, webhooks) explicitly bypass.

The two layers are deliberately redundant: layer 1 is convenient and fast; layer 2 means a
forgotten scope is a *failed query*, not a data breach. (Design notes:
`docs/rls-defense-in-depth-spike.md`.)

### Multi-Sector Data Isolation (within a tenant)
Sector remains the finer-grained scope *inside* a workspace. Every list/read service computes a
**sector scope** (a Prisma `where` fragment) from the caller's `sectorId` and merges it into
queries. Two hard rules protect against leaks:

1. **Fail closed.** A non-admin whose `sectorId` is `null` matches **nothing**
   (`{ id: { in: [] } }`), never an unscoped `{}` (which would mean "see everything").

2. **No OR-collision.** When both a sector scope and a search filter need a top-level `OR`,
   they must be combined under an `AND` array — `AND: [scope, { OR: search }]` — never spread
   into the same object literal (a duplicate `OR` key silently overwrites the scope, causing
   a cross-sector leak). This bug class was found and fixed across `candidateService`,
   `reviewService`, and verified clean in all other services.

Both rules are regression-tested with live cross-sector fixtures.

### Privilege-escalation guards
- Only a **SUPERADMIN** may assign the SUPERADMIN role (`adminUserService.assertCanAssignRole`)
  — a `USER_MANAGE` holder can no longer mint or promote superadmins.
- `roleService.setRolePermissions` rejects granting any permission the caller does not already
  hold (unless they're a SUPERADMIN) — no self-amplification of one's own role.
- A user cannot deactivate or change the role of **their own** account; the **last active
  superadmin** cannot be removed.
- **Realtime isolation:** websocket `pipeline:subscribe` requires an authenticated user and
  verifies sector access (`pipelineService.canAccessJobPipeline`) before joining a room, so the
  socket channel can't bypass the REST sector scoping. Sockets also disconnect at token expiry.

### Hardening summary (production-readiness audits)
Four review passes hardened the system beyond feature-completeness; **all fixes are additive**
(no architecture/ORM/framework/contract changes — a deliberate constraint).

- **Audit 1 — Stability/reliability:** React `ErrorBoundary` (root + per-route), process-level
  `unhandledRejection`/`uncaughtException` nets, complete graceful shutdown, Prisma pool limits
  (`connection_limit`/`pool_timeout`), a `/api/ready` readiness probe (DB hard, Redis soft),
  Redis-backed rate limiting with in-memory fallback, `AuditLog` indexes, socket lifecycle
  tied to token expiry, multer upload caps mapped to clean 400s.
- **Audit 2 — Auth/session security:** websocket pipeline authz (`canAccessJobPipeline`),
  session revocation on admin actions, refresh-token hashing at rest, loud SECURITY warning if
  prod runs with Redis down, refresh-token reuse revokes the family.
- **Audit 3 — Access control / tenant isolation / supply chain:** SUPERADMIN-assignment guard,
  role-permission self-amplification guard, sector-scoped referrals, `nodemailer` upgraded past
  SMTP-injection advisories.
- **Audit 4 — Business-logic integrity:** offer-accept wrapped in a single `$transaction`
  (offer → ACCEPTED + onboarding upsert + application → HIRED), CI gate added.
- **Verified clean (not vulnerable):** no SQL-injection surface (parameterized Prisma only;
  the single raw query is `SELECT 1`), no `dangerouslySetInnerHTML`/XSS sinks, no
  mass-assignment, no PII/secrets in logs, 192-bit public interview/assessment tokens,
  sector-scoped file downloads, CSRF mitigations (refresh cookie httpOnly + secure-prod +
  sameSite=strict), AES-256-GCM secret encryption.

### v2 SaaS-era hardening (live audit — see `ISSUES_AND_SOLUTIONS.md`)
A fifth pass audited the **running** application (real HTTP against a live stack), not the source.

**Fixed:**
- **SEC-1 (Critical)** — the **workspace-approval gate was bypassed on every login**: a `PENDING`
  workspace's owner could sign in normally, defeating the approval flow entirely. Now enforced at
  the login path (`9e3981b`).
- **BUG-1 (High)** — the `ACTIVE_JOBS` quota counted **lifetime** jobs created rather than *open*
  jobs, so workspaces hit a spurious **402** on job approval once they'd churned enough
  requisitions (`e173f4c`).
- **BUG-2 (High)** — `db:seed` crashed under RLS (the seed ran as the restricted role), blocking
  `setup`/`sync` (`9e3981b`).
- **GAP-1 (High)** — no password reset existed for tenants; self-service + operator-triggered
  reset shipped (`3042ff4`).

**Open (tracked, see [§21](#21-roadmap--future-scope)):**
- **SEC-2 (High)** — a **soft-deleted user permanently squats their email address**: the unique
  constraint ignores `deletedAt`, so the address can never be re-registered.
- **SEC-3 (High)** — **`User.email` is globally unique across all tenants**, meaning one workspace
  can probe for (and block) another's user emails. This is a genuine cross-tenant leak of
  existence, and is harder than an index change because the login lookup is email-first with no
  tenant in hand. (The equivalent issue on `Candidate.email` was fixed with a per-tenant partial
  index — `84135ba`.)
- **RISK-1 (Medium)** — token refresh does **not** re-check the approval gate, so a session
  established before a workspace is rejected/suspended survives until the refresh token expires.

> ⚠️ **Committed secrets.** The tracked `.env.example` currently contains **real credentials** (a
> live OpenAI API key, a Google Calendar OAuth client secret + refresh token, and a real
> `ENCRYPTION_KEY`). These must be treated as **compromised**: rotate them, scrub the file back to
> placeholders, and purge them from git history. Nothing in the app depends on their being there.

---

## 9. Data Model

The Prisma schema (`server/prisma/schema.prisma`) defines the full domain in **70 models**.
Key entities grouped by domain:

| Domain | Models |
|--------|--------|
| **Tenancy & billing (v2)** | `Tenant`, `Plan`, `Subscription`, `UsageCounter`, `PaymentEvent`, `Invoice`, `TenantInvite`, `TenantRolePermission` (per-workspace permission overrides), `MaintenanceWindow`, `AiToolUsage` |
| **Org & access** | `User`, `Role`, `Permission`, `RolePermission`, `OAuthAccount`, `UserSession`, `RefreshToken`, `Sector`, `Domain`, `RecruiterSkill` |
| **Jobs (M1)** | `JobRequisition`, `JobTemplate`, `ApprovalWorkflow` |
| **Candidates (M2)** | `Candidate`, `JobApplication` (`status` + `stage`), `Resume`, `CandidateAssignment` |
| **Sourcing (M3)** | `SourcingChannel`, `Referral`, `CandidateList`, `CandidateListItem` |
| **Interviews (M4)** | `Interview` (partitioned by `type`: AI/LIVE/PANEL), `InterviewResult`, `QuestionBank`, `QuestionBankAssignment`, `Question`, `InterviewQuestion`, `CandidateAnswer` |
| **Scheduling (M5)** | `InterviewSchedule` |
| **Assessments (M6)** | `Assessment`, `AssessmentQuestion`, `AssessmentAssignment`, `AssessmentAnswer` |
| **Analytics (M7)** | `AnalyticsSnapshot` |
| **Pipeline (M9)** | `JobApplication.stage`, `PipelineNote` (append-only) |
| ~~**Panel (M10)**~~ | `PanelMember`, `InterviewFeedback` — tables **remain in the schema but are unused** after the module's removal (no migration dropped them) |
| **Offer (M11)** | `Offer`, `OfferDocument`, `Onboarding` |
| **Chatbot (M12)** | `ChatbotConversation`, `ChatMessage`, `ChatbotFaq` |
| **Compliance (M13)** | `AuditLog`, `GdprRequest`, `DataRetentionPolicy` |
| **Platform / config** | `SystemConfiguration`, `Integration`, `WebhookLog`, `Theme`, `EmailTemplate`, `EmailLog`, `Notification` |
| **Infra (Section B)** | `Attachment` (generic file store) |

### Entity-relationship overview (selected)

```
Sector ──< User >── Role ──< RolePermission >── Permission
  │                  │
  │                  └──< UserSession / RefreshToken / OAuthAccount
  │
  ├──< JobRequisition ──< JobApplication >── Candidate ──< Resume
  │         │                  │                  │
  │         │                  │                  └──< CandidateAssignment
  │         │                  ├── stage (Kanban) ──< PipelineNote
  │         │                  ├──< Interview ──< InterviewResult
  │         │                  │        │             └──< InterviewFeedback (panel)
  │         │                  │        └──< PanelMember
  │         │                  └──< Offer ──< OfferDocument
  │         │                          └──── Onboarding
  │         └──< ApprovalWorkflow
  │
  └──< AuditLog (sector-scoped)   GdprRequest ··(plain FK)·· Candidate
```

### Tenancy in the ER graph (v2)

```
Tenant ─┬─< Sector ──< User ──── Role ──< RolePermission >── Permission
        │                                      │
        │                          TenantRolePermission (per-workspace override)
        ├─── Plan ──< Subscription ──< Invoice / PaymentEvent
        ├─< UsageCounter (USERS · CANDIDATES · ACTIVE_JOBS · INTERVIEWED_CANDIDATES · SCHEDULES)
        ├─< TenantInvite
        └─< (nearly every domain row: JobRequisition, Candidate, Interview, Offer, AuditLog, …)
```
Every model above carrying a `tenantId` is subject to **both** the Prisma choke point and an RLS
policy. `Tenant` / `Plan` / `Subscription` / `UsageCounter` are themselves **not** tenant-scoped
models (they *define* tenancy), which is why `entitlementService` reads them inside
`runAsPlatform()`.

### Migrations applied (35 total)

**v1 foundation and hiring modules (through 2026-06-23):**

| Migration | Purpose |
|-----------|---------|
| `20260601092813_init` | Foundation: org/access, jobs, candidates, interviews, etc. |
| `20260602051040_module2_resume_filedata` | Résumé binary storage (`fileData` in Postgres) |
| `20260603092027_module6_skill_assessment` | 4 self-contained assessment tables (plain-FK refs) |
| `20260603121032_module8_video_intelligence` | Additive: `Interview.transcript`; `InterviewResult.{transcriptSummary, recommendation, reviewerNotes, reviewedAt, reviewedById}` |
| `20260605095201_module_b_attachments` | Generic `Attachment` store backing real uploads at `/api/files` |
| `20260608120000_audit_log_indexes` | Additive `CREATE INDEX`: `AuditLog(sectorId, createdAt)` + `AuditLog(createdAt)` |
| `20260611065559_add_user_profile_fields` | Additive user profile fields |
| `20260612045349_interview_proctoring` | Interview anti-cheat / proctoring fields |
| `20260612124500_candidate_answer_unique` | Uniqueness constraint on candidate answers |
| `20260618133216_interview_ai_integration` | AI interview engine integration fields |
| `20260618155355_code_language_and_result_email_dedupe` | Code-answer language + result-email de-dupe |
| `20260619102742_email_log_entity_dedupe` | Email-log entity de-duplication |
| `20260619160000_assessment_proctoring` | Assessment proctoring fields |
| `20260620120000_abinaya_hr_workflow_offer` | HR Approval workflow + offer fields |
| `20260620140000_assessment_job_requisition` | Link assessments to job requisitions |
| `20260622052357_interview_round_number` | Nullable `roundNumber` on `Interview` + `InterviewSchedule` |

**v2 SaaS + RLS migrations (2026-06-23 → 2026-07-08):**

| Migration | Purpose |
|-----------|---------|
| `20260623145948_harikaran_offer_acceptance_round_sync` | Offer-acceptance / interview-round sync |
| `20260626054831_` *(unnamed)* | Schema sync from a merged feature branch |
| `20260629073020_add_order` | Explicit ordering column |
| `20260630130000_candidate_list_assigned_to` | Assignment on curated candidate lists |
| **`20260702000001_multi_tenant_saas`** | **The tenancy migration** — `Tenant`, `Plan`, `Subscription`, `UsageCounter`, `Invoice`, `PaymentEvent`, `TenantInvite` + `tenantId` across the domain |
| `20260703000001_tenant_not_null_tightening` | Makes `tenantId` **NOT NULL** once backfilled |
| `20260703100000_interview_result_feedback_columns` | `InterviewResult` feedback columns |
| `20260706063755_plan_candidate_schedule_limits` | Adds candidate + schedule quota limits to `Plan` |
| `20260706073205_tenant_created_by` | Tracks the operator who provisioned a workspace |
| `20260706090000_tenant_role_permission_override` | Per-workspace role/permission overrides |
| `20260707000000_origin_pipeline_reject_and_ai_tables` | Pipeline reject fields + AI tool tables |
| `20260707093559_maintenance_window` | Scheduled maintenance notices |
| `20260707114123_drop_assessment_limit` | Drops the unused assessment quota |
| `20260707120000_tenant_approval_gate` | `approvalStatus` (PENDING/APPROVED/REJECTED) + phone |
| `20260708120000_candidate_email_tenant_scoped` | **Per-tenant** partial unique index on `Candidate.email` (was global) |
| **`20260708130000_rls_phase1_restricted_role`** | Restricted `agnohire_app` DB role; migration/runtime URL split |
| **`20260708140000_rls_phase3_policies`** | Tenant-isolation RLS policies |
| **`20260708150000_rls_phase4_enable_candidate`** | Enables RLS on `Candidate` |
| **`20260708160000_rls_phase4_enable_remaining`** | Enables RLS on all remaining tenant tables |

> **RLS Phase 2 needed no migration** — it's the runtime GUC-setting logic in the Prisma choke
> point (`34fecaa`).

> **Modules 9 & 13–14 required no schema migrations** — they reuse pre-existing models. Module 11
> added a background-verification status as a free-text column; Module 12 added
> `CHATBOT_VIEW`/`CHATBOT_MANAGE` permissions (re-seed). Later revisions added the proctoring,
> AI-interview, HR-workflow, and round-number migrations listed above. **Google Calendar / Meet
> configuration is purely config-driven (System Config rows) and required no migration.** The
> permission catalogue totals **42** (the two `PANEL_*` permissions are now inert after the
> Hiring Panel module's removal).

### Plain-FK pattern
References to existing models from self-contained modules are stored as plain `String` FK
columns (no Prisma `@relation`) and resolved via a secondary "nameMap" query. This keeps new
migrations from touching core models and is used by `InterviewSchedule`, `Referral`, all
Module 6 cross-model refs, Module 8's transcript/analytics reads, and `GdprRequest`'s
`candidateId`.

---

## 10. User Roles & Personas

AgnoHire ships **9 roles** (7 product roles + 2 SaaS tenancy roles added in v2). Roles are
collections of permissions; the seed wires default role→permission mappings, and each workspace
can re-map them within escalation guards — those edits are **isolated per workspace** via the
`TenantRolePermission` override table, so one customer's role tweak never leaks to another.

| Role | Persona | Typical permissions | Scope |
|------|---------|---------------------|-------|
| **PLATFORM_SUPERADMIN** *(v2)* | Platform operator (us) | Cross-tenant: plans, workspace accounts, approval queue, impersonation, maintenance windows | **Cross-tenant** (`bypass`) |
| **TENANT_OWNER** *(v2)* | Customer workspace owner | Billing/subscription, workspace config, users + roles, all product permissions | Their tenant |
| **SUPERADMIN** | Legacy top-level admin — **scoped down to its own tenant in v2** (`b0f5b67`) | All product permissions (bypasses permission checks *within* its tenant) | Their tenant |
| **ADMIN** | Org administrator | User/role/sector/integration/system management, audit view | Tenant-wide |
| **HR** | HR generalist | Candidates, offers, onboarding, compliance (GDPR), pipeline, HR approval queue | Sector-scoped |
| **RECRUITER** | Sourcer / screener | Jobs, candidates, sourcing, interviews, pipeline, chatbot | Sector-scoped |
| **HIRING_MANAGER** | Hiring manager / decision-maker | Pipeline view, interview review | Sector-scoped |
| **PANEL_MEMBER** *(inert)* | Interview panelist — role still defined but unused after the Hiring Panel module's removal | — | Sector-scoped |
| **CANDIDATE** | Applicant | Candidate portal, support chatbot, public interview/assessment via token | Self only |

**Persona notes:**
- **Every non-platform role is tenant-scoped first.** `PLATFORM_SUPERADMIN` is the only role that
  crosses tenants, and it does so through the explicit `bypass` flag on the tenant context — which
  is also the only thing that satisfies the `app.bypass` GUC in the RLS policies.
- A **sector-scoped** role sees only data whose sector matches the user's `sectorId` *within their
  tenant*; a `null` sector means they see nothing (fail-closed).
- **HR** is the only sector-scoped role that holds `GDPR_MANAGE`, which is why GDPR tooling is
  tested specifically for sector isolation.
- **CANDIDATE** is deliberately the narrowest role — the candidate portal resolves the signed-in
  candidate server-side (never trusting a client-supplied id), so there is no IDOR surface.

---

## 11. Module Reference

### Module 1 — Job Requisition & JD Management ✅
CRUD for jobs with a multi-step approval workflow, reusable templates, configurable
approvers, and AI-assisted JD generation (graceful without a key). Sector/domain validation
guards prevent mismatched assignments. Smart windowed paginator on the client.

### Module 2 — Résumé Parsing & Candidate Screening ✅
Candidate CRUD, résumé upload → Bull parse queue, AI fit-scoring (graceful), bulk import, and
recruiter assignment. Sector-scoped candidate lists and search. Résumé binaries are stored in
Postgres (`Resume.fileData`).

### Module 3 — Candidate Sourcing ✅
Referrals, sourcing channels, curated candidate lists with bulk assign, and talent search.
Referrals are **sector-scoped** (hardened in Audit 3). LinkedIn sourcing is scaffolded.

### Module 4 — AI Interview Engine ✅
Question banks (with AI generation), a token-based public interview route, anti-cheat
proctoring, MCQ auto-grading, and AI Q&A scoring for TEXT/CODE answers. The `Interview` table
is partitioned by `type='AI'` so LIVE/PANEL interviews never leak into M4 views. Public tokens
are 192-bit (`randomBytes(24)`).

### Module 5 — Interview Scheduling ✅
UTC slot engine with working-hours guards, conflict detection, and reminders dispatched via
Bull, plus a full schedule lifecycle and **live Google Calendar / Google Meet integration**.
- **Google Calendar / Meet** are **dynamically configurable from System Config → Integrations**
  (the same key-value pattern as the AI provider — see §16). `calendarService.resolveCalendar()`
  reads OAuth client-id/secret/refresh-token from config first (falling back to the legacy
  `Integration` model), exchanges the refresh token for short-lived access tokens automatically,
  and writes events to the configured calendar ID (`primary` by default). Secrets are encrypted
  at rest and masked on read. A `POST /api/system/calendar/test` endpoint reports connection
  status with the precise Google error if creds are wrong.
- **On-demand Meet links:** scheduling an interview can mint a Google Meet link via
  `conferenceData.createRequest`; `generateMeetForInterview()` also backfills a link on demand
  (idempotent — it won't double-mint). When creds are absent the interview stays local — no crash.
- **Schedule lifecycle:** `SCHEDULED → IN_PROGRESS → COMPLETED | CANCELLED`. A schedule can be
  **auto-completed** after the meeting end time (config flag `SCHEDULE_AUTO_COMPLETE_ENABLED`,
  default on) or **marked complete manually** (`POST /:id/complete`). **Cancelling a schedule
  deletes its Google Calendar event and clears the Meet link** (the link effectively expires);
  this fires for admin/HR-initiated cancellations too.

### Module 6 — Skill Assessment ✅
Assessment builder from question banks, bulk assignment, token-based take page, automatic
scoring plus AI scoring for open answers. (First migration since the foundation; 4
self-contained tables via plain-FK refs.)

### Module 7 — AI Analytics & Reporting ✅
KPI dashboard, cumulative hiring funnel, time-series (day/week/month), breakdowns, CSV export
of five report types, savable snapshots, and AI insights (graceful). Reuses the existing
`AnalyticsSnapshot` model — zero migration, sector-scoped aggregates computed on the fly.

### Module 8 — Video Interview Intelligence ✅
Transcript intake with **always-on deterministic metrics** (word count, WPM, fillers,
questions, speaker talk-ratio, top keywords) plus an AI intelligence layer (communication/
skill scores, sentiment, summary) that degrades gracefully. Proctoring integrity report from
M4 anti-cheat violations and a reviewer workflow. M8 writes its **own** result fields and
never clobbers M4's decision data.

### Module 9 — ATS Pipeline / Kanban ✅ *(no migration)*
A drag-and-drop Kanban board over the existing `JobApplication.stage` plus an append-only
`PipelineNote`. Stages: `SOURCED → APPLIED → SCREENING → INTERVIEW → OFFER → HIRED → REJECTED`.
- **Sector scope** via `job.sectorId` (fail-closed).
- `getBoard` groups applications by stage for a single job.
- **Bidirectional status ↔ stage sync.** `moveApplication` (dragging a card) maps every stage
  to an application `status` via a `STAGE_TO_STATUS` table, keeping the M7 analytics funnel
  consistent. The reverse also holds: changing a candidate's **status on the Screening page**
  derives the matching pipeline **stage** (`STATUS_TO_STAGE` in `candidateService.updateApplication`),
  so the Kanban card moves columns to match. A `SOURCED` card is preserved on a no-op
  re-save of `APPLIED` (SOURCED ≡ APPLIED in the funnel); statuses with no pipeline column
  (HR-approval / offer sub-states) leave `stage` untouched. The client cross-invalidates both
  query caches (`['applications']` ↔ `['pipeline-board']`) so each view refreshes immediately
  despite the global 30 s `staleTime`.
- Notes are append-only; private notes are visible only to their author.
- Client: native HTML5 drag-drop with optimistic cache moves, job selector, search, fit
  badges, note counts, and **live updates** (`pipeline:moved` Socket.IO room).

### Module 10 — Hiring Panel ❌ *removed in a post-1.0 revision*
The Hiring Panel module (panelist assignment, structured star-rating feedback, weighted
consensus, finalized decision) was **removed** from the product. Its services, routes, shared
schemas/types, and UI pages were deleted; the `PANEL_MANAGE` / `PANEL_FEEDBACK` permissions and
the `PANEL_MEMBER` role remain declared in the shared constants as **inert leftovers** (no code
path references them). Interview outcomes are now driven by the AI engine (M4) and the
video-intelligence reviewer workflow (M8). *(Historical note: this module was originally
delivered and is preserved in git history.)*

### Module 11 — Offer & Onboarding ✅ *(no migration)*
Full offer lifecycle plus post-acceptance onboarding.
- **Lifecycle:** draft → send → respond (accept/decline). Only DRAFT offers are editable;
  one active offer per application.
- **On accept (atomic `$transaction`):** captures signature/`signedAt`/IP, auto-creates an
  `Onboarding` record with a default 5-item checklist, and **advances the application to HIRED**
  (Module 9 pipeline integration).
- **Documents:** add/remove offer documents (real file uploads via Section B).
- **Onboarding:** status + background-verification (BGV) tracking, checklist replace, and
  per-item toggle.
- Client: a 3-tab drawer (Offer / Documents / Onboarding); the same page powers both
  `/offers` and an `/onboarding` mode. The create-offer picker excludes applications that
  already have an active offer.

### Module 12 — AI Chatbot ✅ *(no migration)*
"Agno", an FAQ-grounded support assistant, serving both staff and candidates.
- **Answer pipeline:** FAQ keyword/tag match first → OpenAI fallback (graceful) → canned
  fallback. Never errors without an AI key; every assistant message records its `source`
  (`faq` / `ai` / `fallback`).
- **Owner-agnostic conversations:** a `sessionId`+`channel` identifies the chat — `demo:<userId>`
  (staff demo) and `portal:<candidateId>` (candidate portal) share one backend pipeline.
- **Candidate portal:** `/candidate/support` resolves the signed-in candidate (by `Candidate.userId`,
  falling back to a unique email match, fail-closed when no profile is linked) and serves a
  branded chat with no internal source badges.
- **Staff UI:** a "Try Agno" demo chat, an FAQ knowledge-base admin (CRUD + tags + active
  toggle), and a sector-scoped transcript viewer (staff see the FAQ/AI/fallback provenance).
- **Contextual assistant widget** (post-1.0): a floating, page-aware chat widget available
  across the app. Each open mints a fresh `sessionKey`, and the user's current route is passed
  as context so answers can reference the page they're on; backed by an expanded
  `knowledgeBase.json`.
- **Permissions:** `CHATBOT_MANAGE` (FAQ admin), `CHATBOT_VIEW` (transcripts); the demo is open
  to any authenticated staff user, the portal is gated to the `CANDIDATE` role.

### HR Approval Queue ✅ *(post-1.0; migration `20260620120000_abinaya_hr_workflow_offer`)*
An automated HR-approval workflow that sits between interviews and offers. Candidates who clear
their interviews surface in an **HR Approval Queue** (`GET /api/hr/queue`), where HR reviews a
consolidated report and approves/rejects (`POST /api/hr/process/:interviewId`); processed items
move to a separate history (`GET /api/hr/processed`). The UI mirrors the Schedule page styling.

### Module 13 — Security & GDPR Compliance ✅ *(no migration, no new permissions)*
An audit-log viewer plus GDPR/data-subject tooling over the existing `AuditLog`, `GdprRequest`,
and `DataRetentionPolicy` models and the app-wide `recordAudit` stream.
- **Audit-log viewer:** filter by action / entity / actor / date range / free-text search,
  a detail drawer with the before/after JSON snapshots and device info, and CSV export. All
  sector-scoped (fail-closed) for non-admins.
- **GDPR requests:** the `ACCESS` / `PORTABILITY` / `DELETION` lifecycle (raise → fulfil/reject).
  `ACCESS`/`PORTABILITY` assemble a portable data bundle (candidate + résumés [metadata only,
  binary excluded] + applications + interviews + offers + conversations).
- **Right to erasure:** `DELETION` performs a *complete* erasure in one transaction — anonymizes
  the candidate, scrubs résumés, deletes chat conversations/messages, nulls interview
  transcripts/recordings and application notes, sets `gdprDeletedAt`, and soft-deletes the record.
- **Consent & retention:** record/withdraw processing consent per candidate, and CRUD for
  per-entity data-retention policies; a headline compliance summary.
- **Permissions:** `AUDIT_LOG_VIEW` (viewer), `GDPR_MANAGE` (requests/consent/retention).

### Module 14 — Admin Console ✅ *(no migration, no new permissions)*
CRUD + management UI over the platform's foundational models, each area gated by its own
permission.
- **Users** (`USER_MANAGE`) — list/create/update, role + sector assignment, activate/deactivate,
  reset password. Guard rails: duplicate email → 409, you can't deactivate or change your own
  role, the last active superadmin can't be removed, and only a SUPERADMIN can assign the
  SUPERADMIN role.
- **Roles & Permissions** (`ROLE_MANAGE`) — a permission-matrix editor that replaces a role's
  grants in a transaction. The superadmin role is immutable (always holds every permission);
  unknown keys are rejected; you cannot grant a permission you don't hold.
- **Sectors & Domains** (`SECTOR_MANAGE`) — CRUD with soft-delete and an orphan guard: a
  sector/domain that still owns users or candidates can't be archived until they're reassigned.
- **Integrations** (`INTEGRATION_MANAGE`) — third-party connections with **config encrypted at
  rest**; secret-looking keys are masked on read and the mask sentinel is preserved on update so
  secrets aren't accidentally cleared.
- **Email Templates** (`SYSTEM_CONFIG_MANAGE`) — CRUD with one default per type (7 prebuilt
  starters seeded).
- **System Configuration** (`SYSTEM_CONFIG_MANAGE`) — the DB-backed runtime settings (secrets
  masked) plus an SMTP delivery test, over the `/api/system` endpoints.
- **Error handling:** the global handler maps Prisma known errors (P2002 → 409, P2003 → 400,
  P2025 → 404) to clean responses platform-wide.

### SaaS Platform Layer ✅ *(v2 — the major addition since 1.1)*

Everything that turns the hiring product into a multi-customer service. Gated to
`PLATFORM_SUPERADMIN` except where noted.

**Tenancy & isolation** — covered in [§4](#4-system-architecture) and [§8](#8-security--access-control):
the `Tenant` model, the Prisma choke point, and the four-phase PostgreSQL RLS rollout.

**Plans & entitlements** (`entitlementService`, `shared/types/billing.ts`)
- **Five plan tiers:** `FREE`, `STARTER`, `PRO`, `ENTERPRISE`, `LEGACY_ENTERPRISE` (the last for
  grandfathered accounts). The catalogue is seeded automatically by `db:seed` (`753861e`).
- **Structured limits:** `maxUsers`, `maxCandidates`, `maxActiveJobs`, `maxInterviewedCandidates`,
  `maxSchedules`, `storageMb` (`null` = unlimited), plus `aiEnabled` / `proctoringEnabled` feature
  flags. Marketing bullets ride alongside as `features[]`.
- **Five metered metrics:** `USERS`, `CANDIDATES`, `ACTIVE_JOBS`, `INTERVIEWED_CANDIDATES`,
  `SCHEDULES`, tracked in `UsageCounter` and surfaced at `GET /api/tenant/usage`.
- **Enforcement:** `assertActiveSubscription` + per-metric quota checks run **server-side at the
  write path** → **402** on breach. A workspace an operator has `SUSPENDED`/`CANCELLED` goes
  **read-only**. `ACTIVE_JOBS` counts *open* jobs, not lifetime jobs created (`e173f4c`).
- The client mirrors this state to disable create actions and show usage meters (`700e4d5`) —
  UX only, never the security boundary.

**Billing (Razorpay)** — `/api/billing`
- `GET /config`, `GET /subscription`, `POST /change-plan`, `POST /cancel`, `POST /verify`.
- **Webhook** (`POST /api/billing/webhook`, mounted in `app.ts` ahead of the JSON body parser so
  the raw body survives) — **signature-verified**; a bad signature is rejected with `BAD_SIGNATURE`
  before anything is processed.
- Subscription lifecycle: `CREATED → PENDING → TRIALING → ACTIVE → PAST_DUE → HALTED → CANCELLED`,
  covered by a dedicated state-machine test suite (`billingStateMachine.test.ts`, 8 tests) and
  signature tests (`billingSignatures.test.ts`).

**Registration & the approval gate** — `/api/auth/register`
- Self-serve signup creates a `Tenant` + `TENANT_OWNER` in `approvalStatus = PENDING`. The
  workspace is **inert until approved** — the client shows a "workspace under review" page.
- **Free-email domains are flagged, not blocked** (`isFreeEmailDomain`), so marketing can
  prioritise corporate signups in the queue. A phone number is collected at signup — the number to
  call for the qualifying conversation.
- Paid plans return a `CheckoutBootstrap` (Razorpay subscription + `shortUrl` + `keyId`).

**Platform console** — `/api/platform`
- **Plans** — `GET/POST /plans`, `PATCH /plans/:id`: full CRUD over the plan catalogue, including
  Razorpay plan-id mapping (monthly/yearly) and a live `tenantCount`.
- **Workspace accounts** — `GET /workspaces` (usage, plan, owner, counts), `GET/PATCH
  /workspaces/:id`, `POST /workspaces` (operator-provisioned, returns a one-time
  `setPasswordToken`), `DELETE /workspaces/:id`.
- **Approval queue** — `POST /workspaces/:id/approve` · `POST /workspaces/:id/reject`.
- **Impersonation** — `POST /workspaces/:id/login` logs an operator into a workspace they created,
  returning a scoped session (`createdByMe` gates this).
- **Owner password reset** — `POST /workspaces/:id/reset-owner-password`.
- **Status control** — `PATCH /workspaces/:id/status` (`ACTIVE` / `SUSPENDED` / `CANCELLED`).
- **Maintenance windows** — `GET/POST /maintenance`, `DELETE /maintenance/:id`: scheduled notices
  broadcast to workspaces (`df37b44`).

**Workspace self-management** — `/api/tenant`
- `GET /usage` (the usage meters the UI renders), `POST/GET /invites`, `POST /invites/accept`.
- Workspace-scoped routing and branding: a workspace's **own logo** is used in outgoing emails
  (`652627b`), and the React Query cache is cleared on workspace switch/logout so no data bleeds
  across a switch (`ecde43e`).

### Cross-cutting infrastructure — "Section B" ✅
A pass at the "operate-it-for-real" layer, independent of any single module.
- **Automated test suite** — Vitest + Supertest integration tests (the first in the repo),
  run black-box against the running server; **97 tests across 17 files** covering auth, RBAC, tenant + sector isolation,
  M1–M14 flows, email, attachments, and notifications.
- **Email (SMTP):** DB-configured nodemailer with graceful no-op when unset; wired into
  interview reminders and offer/panel notifications; `POST /api/system/email/test`.
- **File uploads:** a generic `Attachment` store (bytes in Postgres) at `/api/files`; offer
  documents, offer letters, and BGV reports are real uploads. **Downloads are sector-scoped**
  (admin / uploader / a same-sector record that references the file).
- **Realtime:** Socket.IO in-app notification center (bell + unread badge, live updates) and a
  live Kanban board (`pipeline:moved`), using the pre-existing `Notification` model.

---

## 12. Key Workflows

### 12.1 Authentication & session lifecycle
```
Client                         Server                         Store
  │  POST /auth/dev-login        │                               │
  ├─────────────────────────────▶  verify credentials           │
  │                              ├──────────────────────────────▶  read User + Role + perms
  │   accessToken (in memory)    │  issue JWT + refresh cookie   │
  │ ◀────── refresh cookie ──────┤  store refresh (SHA-256 hash) │
  │                              │                               │
  │  …access token expires…      │                               │
  │  POST /auth/refresh (cookie) │                               │
  ├─────────────────────────────▶  match hashed token, rotate    │
  │   new accessToken            │  (replay ⇒ revoke family)     │
```

### 12.2 Candidate application lifecycle (pipeline)
```
SOURCED → APPLIED → SCREENING → INTERVIEW → OFFER → HIRED
                                    │                  ▲
                                    └──────▶ REJECTED  │
                                                       │
   offer accepted (atomic txn) advances application ───┘
```
Each Kanban move calls `moveApplication`, which maps the new stage to a `status` via
`STAGE_TO_STATUS`, persists the move, emits `pipeline:moved` to the job's Socket.IO room, and
keeps the analytics funnel consistent.

### 12.3 Offer acceptance (atomic)
```
respondOffer(ACCEPT)  ─┐
                       ├─ prisma.$transaction([
                       │     offer.update    → status ACCEPTED + signature/signedAt/IP
                       │     onboarding.upsert → default 5-item checklist
                       │     application.update → stage/status HIRED
                       │  ])
                       └─ idempotent: a second accept is rejected by the status guard
```

### 12.4 GDPR right-to-erasure (complete, one transaction)
```
process(DELETION) ─ prisma.$transaction([
    candidate      → anonymize PII, set gdprDeletedAt + deletedAt, userId = null
    resumes        → scrub
    chatMessages   → delete (collect convo ids → deleteMany messages → delete convos)
    interviews     → null transcript/transcriptUrl/recordingUrl
    applications   → null notes
])  ⇒ re-request for the same candidate returns 404 (record erased)
```

### 12.5 AI answer pipeline (chatbot — graceful)
```
user message
   │
   ├─ FAQ keyword/tag match (score ≥ 2)?  ── yes ─▶ answer, source = "faq"
   │
   ├─ OpenAI key configured?              ── yes ─▶ LLM answer, source = "ai"
   │
   └─ else ─────────────────────────────────────▶ canned answer, source = "fallback"
```

---

## 13. API Surface

All routes are mounted under `/api`. Representative endpoints by area:

| Area | Base | Notable endpoints |
|------|------|-------------------|
| Auth | `/api/auth` | `GET /config`, `POST /dev-login`, `POST /refresh`, `POST /logout`, `GET /me`, `GET/PATCH /profile` |
| **Registration (v2)** | `/api/auth` | `POST /register` (workspace + owner; approval-gated), `POST /verify-email`, `POST /forgot-password`, `POST /reset-password` |
| **Tenant (v2)** | `/api/tenant` | `GET /usage` (plan limits + metered usage), `POST/GET /invites`, `POST /invites/accept` |
| **Billing (v2)** | `/api/billing` | `GET /config`, `GET /subscription`, `POST /change-plan`, `POST /cancel`, `POST /verify`; **`POST /api/billing/webhook`** (Razorpay, signature-verified, mounted in `app.ts`) |
| **Platform (v2)** | `/api/platform` | `/plans` (+ `PATCH /plans/:id`), `/workspaces` (+ `/:id`, `/:id/approve`, `/:id/reject`, `/:id/status`, `/:id/login`, `/:id/reset-owner-password`), `/maintenance` |
| Jobs | `/api/jobs` | CRUD, `/templates`, `/approvers`, `/generate-jd`, workflow actions |
| Candidates | `/api/candidates` | CRUD, search, bulk import, assignment |
| Sourcing | `/api/sourcing` | referrals, channels, lists |
| Interviews | `/api/interviews` | banks, public token route, scoring |
| Scheduling | `/api/schedules` | slots, conflicts, reminders, `POST /:id/generate-meet`, `POST /:id/complete`, cancel (expires Meet link) |
| Assessments | `/api/assessments` | builder, assignment, take/score |
| Analytics | `/api/analytics` | dashboard, insights, CSV export, snapshots |
| Reviews (M8) | `/api/reviews` | list/detail, set media, reanalyze, submit review |
| Pipeline (M9) | `/api/pipeline` | `GET /board`, `GET/POST /applications/:id/notes`, `PATCH /applications/:id/stage` (status sync is also driven from `PATCH /api/applications/:id`) |
| HR Approval | `/api/hr` | `GET /queue`, `GET /processed`, `GET /report/:candidateId`, `POST /process/:interviewId` |
| Offers (M11) | `/api/offers` | CRUD (draft), send, respond, documents, onboarding (status/BGV/checklist) |
| Chatbot (M12) | `/api/chatbot` | `GET /demo/conversation`, `POST /demo/messages`, `GET /me/conversation` + `POST /me/messages` (candidate), `/faqs` CRUD, `/conversations` list/detail |
| Audit (M13) | `/api/audit` | `GET /` (filter/paginate), `/facets`, `/export` (CSV), `/:id` |
| Compliance (M13) | `/api/gdpr` | `/summary`, `/requests` (+ `/:id/process`), `/consent`, `/retention` CRUD, `/export/:candidateId` |
| Admin (M14) | `/api/admin` | `/users` (+ `/:id`, `/:id/reset-password`), `/roles` (+ `/:id/permissions`), `/permissions`, `/sectors`, `/domains`, `/integrations`, `/email-templates` |
| System (M14) | `/api/system` | config (get/set), `/email/test`, `/calendar/test` (Google Calendar connection check) |
| Files (infra) | `/api/files` | `POST /` upload, `GET /:id/download` (sector-scoped) |
| Notifications (infra) | `/api/notifications` | list, `unread-count`, `:id/read`, `read-all` |
| Health | `/health`, `/api/ready` | liveness; readiness (DB hard, Redis soft) |

**Response envelope.** Every response is `{ success: boolean, data?, error? }`. Lists nest
`data: { items, meta }`. Errors carry `error: { code, message, details? }`.

**Status codes worth knowing (v2):** **402 Payment Required** is returned when a plan quota is
exhausted or the subscription is inactive/suspended (`QuotaExceededError` /
`SubscriptionInactiveError`) — it is a normal, expected response, and the client renders an upgrade
prompt rather than an error toast.

**Route ordering rule:** static/prefix routes are always declared before parameterized `/:id`
routes so that, e.g., `GET /jobs/templates` is not captured by `GET /jobs/:id`.

---

## 14. Testing & Quality Assurance

### Methodology
Testing was layered, with each layer catching a different failure class:

1. **Static** — TypeScript strict compilation + Vite build across all three workspaces
   (also the CI gate). Catches type/contract drift the moment `shared/` changes.
2. **Automated integration (black-box)** — Vitest + Supertest issue real HTTP requests against
   a **running** server + Postgres (+ optional Redis), exercising auth, RBAC, sector isolation,
   and module flows exactly as a client would. No internal functions are imported — only the
   public API surface is tested. `TEST_BASE_URL` overrides the target.
3. **Browser end-to-end** — a 26-check Playwright sweep over the real UI (page loads, drawer
   flows, role-gated redirects to `/unauthorized`, permission-matrix edits, SMTP test, etc.).
4. **Adversarial probes** — per-module security hunts (cross-sector leak attempts, IDOR,
   validation edges, SQLi-shaped inputs, double-process idempotency, mask-precision) run with
   purpose-built fixtures (e.g. a second sector + a sector-scoped HR user for GDPR isolation).

### Results (2026-07-14)
- **97 / 97** automated integration tests across **17 files** passing, **0 skipped**.
- The suite was itself repaired in `9e3981b`: it had been **structurally broken** — 10 files
  failing and **22 tests silently never running**. Treat a green suite as meaningful only when the
  *file* and *test* counts are also checked.
- **26 / 26** browser E2E checks passing (v1 sweep).
- Live end-to-end audit of the running app: 4 critical/high issues found and fixed; **3 remain
  open** (see [§8](#8-security--access-control) and [§21](#21-roadmap--future-scope)).
- Typecheck + full monorepo build: **clean** — but note **QUAL-1**: `prisma/` and `tests/` are
  currently **excluded from typecheck**, so type errors there are invisible to CI.

### v2 test coverage highlights
| File | Covers |
|------|--------|
| `tenantIsolation.test.ts` (5) | Cross-tenant read/write attempts fail closed |
| `isolation.test.ts` (3) | Cross-sector isolation within a tenant |
| `billingStateMachine.test.ts` (8) | Subscription lifecycle transitions |
| `billingSignatures.test.ts` (2) | Razorpay webhook signature verification |
| `resumeLimit.test.ts` (1) | Storage/quota enforcement |
| `documentsWorkflow.test.ts` (10) · `chatbot.test.ts` (11) · `compliance.test.ts` (9) | Product flows |

### Running the suite
```bash
npm test --workspace=server   # server must be running; TEST_BASE_URL overrides the target
```
> The suite is **black-box and data-dependent** — a freshly reseeded DB without sample
> jobs/applications skips the pipeline-data tests; reseed with demo data to run them. The
> in-memory rate limiter (300 req / 15 min) can trip when running the full suite plus manual
> smokes back-to-back; restart the server to reset the counter.

### Continuous integration
`.github/workflows/ci.yml` runs typecheck + build across all three workspaces on every
push/PR (`npm run build` — no DB/secrets needed; nothing is executed, only compiled). The
black-box integration suite needs a live stack (server + Postgres + Redis), so it's run
locally for now; a service-container CI job is a documented follow-up.

---

## 15. Development Methodology & Timeline

AgnoHire was built **module-by-module on short-lived feature branches** (`module-N-wip`), each
merged fast-forward to `main` only after passing its own verification (typecheck/build +
integration tests + browser E2E + an adversarial probe pass). This kept `main` continuously
green and every module independently auditable.

**Phase sequence:**
1. **Foundation** — monorepo, shared contract, auth/RBAC, sector model, the first migration.
2. **Modules 1–11** — the core hiring lifecycle, each a vertical slice.
3. **Section B (cross-cutting infra)** — the first automated test suite, SMTP, real file
   uploads, and realtime — the "operate-it-for-real" layer.
4. **Modules 12–14** — AI chatbot, security/GDPR compliance, admin console.
5. **Hardening** — four production-readiness audits (stability, auth/session, access control,
   business-logic integrity), all fixes additive and non-destructive.
6. **Polish** — a brighter "Indigo SaaS" default theme, provider-agnostic AI (Gemini-verified),
   prebuilt email-template starters, and a minimal CI gate.
7. **(v2) SaaS conversion** — tenancy retrofitted in stages: nullable `tenantId` → backfill →
   NOT NULL tightening; then the Prisma choke point; then plans/entitlements/Razorpay and the
   platform console; then **RLS in four phases** (restricted role → runtime GUCs → policies →
   enable), each its own migration so the isolation layer could be rolled forward table by table.
8. **(v2) Live audit** — the running application driven end-to-end over real HTTP, which surfaced
   a critical approval-gate bypass, a quota bug, a broken seed, and a test suite where 22 tests
   silently never ran. Findings and fixes: `ISSUES_AND_SOLUTIONS.md`.

**Working agreements that shaped the code:** additive migrations only; reuse existing models
where a module allows it (Modules 9–14 needed no migration); rebuild `shared` before
typechecking server/client; never run a destructive Prisma command against a live DB; **and, since
v2, verify entitlement/isolation changes against the running app — not by reading code.**

---

## 16. Local Development & Setup

### Prerequisites
- Node.js 20+
- Docker (for PostgreSQL 15 + Redis 7), **or** a local PostgreSQL/Redis

### Quick start
```bash
cp .env.example .env          # then edit secrets (JWT_SECRET, SESSION_SECRET, ENCRYPTION_KEY)
npm install                   # installs all workspaces
npm run build:shared          # shared types must build before server/client typecheck
npm run db:up                 # start Postgres + Redis (Docker Compose)
npm run db:migrate            # apply Prisma schema (runs as the privileged DIRECT_URL role)
npm run db:seed               # roles, permissions, plan catalogue, theme, config, dev users, templates, FAQs
npm run dev                   # server (:4000) + client (:5173)
```
> `npm run setup` runs install → build:shared → db:up → db:migrate → db:seed in one shot.

### ⚠️ Two database URLs (v2 — required by RLS)
RLS only protects you if the application **cannot bypass it**, so there are two connections:

| Variable | Role | Used by |
|----------|------|---------|
| `DATABASE_URL` | **`agnohire_app`** — restricted, **subject to RLS** | the running server |
| `DIRECT_URL` | privileged owner role — **can bypass RLS** | `prisma migrate`, `db:seed`, Studio |

Pointing `DATABASE_URL` at the privileged role silently disables the entire second isolation
layer, and nothing will fail loudly. Conversely, running the **seed** under the restricted role is
what broke `db:seed` (BUG-2, fixed in `81f9a69` / `9e3981b`) — the seed writes rows for many
tenants and must use `DIRECT_URL`.

### Development credentials (dev seed only)
```
Admin:     admin@agnohire.local     / Admin@12345        (SUPERADMIN)
Candidate: candidate@agnohire.local / Candidate@12345    (CANDIDATE)
```
> ⚠️ Development only — these exist solely in the local seed. Never deploy the dev seed to a
> shared or production environment.

### Database commands
| Command | Use |
|---------|-----|
| `npm run db:up` | start Postgres + Redis containers |
| `npm run db:migrate` | day-to-day dev (`prisma migrate dev`) |
| `npm run db:deploy` | CI / non-interactive apply (`prisma migrate deploy`) |
| `npm run db:reset` | **rebuild a divergent DB** from migrations (then auto-reseed) |
| `npm run db:seed` | (re)seed roles, permissions, themes, dev users, email templates — idempotent |
| `npm run db:studio` | open Prisma Studio |

A correctly migrated DB has **all migration tables** plus Prisma's `_prisma_migrations`. If a
teammate sees a different table count, their DB simply isn't migrated — run `npm run db:migrate`
(or `npm run db:reset` to rebuild). **Never** point `prisma migrate diff --shadow-database-url`
at a live database (it resets/wipes it — see [§18](#18-operational-notes--known-gotchas)).

### Default ports
| Service | Port |
|---------|------|
| PostgreSQL | 5432 |
| Redis | 6379 |
| Server | 4000 |
| Client (Vite) | 5173 |

Ports/credentials come from `.env` (`POSTGRES_PORT`, `REDIS_PORT`, `DATABASE_URL`, `REDIS_URL`);
override there if another local Postgres holds 5432.

### AI provider (optional)
AI keys live in the DB (encrypted at rest), **not** in `.env`. Configure via **Admin Console →
System Config → AI**, or for quick local setup set these in your gitignored `.env` and run
`npm run db:seed` (the seed writes them, key encrypted):
```bash
OPENAI_API_KEY=...        # OpenAI key, or any OpenAI-compatible provider's key
OPENAI_BASE_URL=...       # e.g. Gemini: https://generativelanguage.googleapis.com/v1beta/openai
OPENAI_MODEL=...          # e.g. gemini-2.5-flash
```
`openaiService` reads `ai.openai_base_url`, so OpenAI, Gemini (OpenAI-compat endpoint), Azure,
or a local gateway all work with no code change.

---

## 17. Deployment Guide

> AgnoHire targets a standard Node + PostgreSQL + Redis deployment. The application is
> stateless apart from the DB and Redis, so it scales horizontally behind a load balancer.

### 1. Provision infrastructure
- **PostgreSQL 15** (managed or self-hosted).
- **Redis 7** — strongly recommended in production (session revocation + cluster-wide rate
  limiting + Bull queues depend on it; the app degrades to per-process behavior without it and
  logs a loud SECURITY warning).

### 2. Configure infrastructure secrets (`.env`)
Set only the infrastructure secrets — **everything else is configured at runtime from the
Admin Console**:
```bash
NODE_ENV=production
PORT=4000
CLIENT_URL=https://app.example.com

# Two URLs — see §16. The app MUST run as the restricted, RLS-bound role.
DATABASE_URL=postgresql://agnohire_app:pass@host:5432/agnohire?schema=public&connection_limit=20&pool_timeout=10
DIRECT_URL=postgresql://owner:pass@host:5432/agnohire?schema=public   # migrations/seed only

REDIS_URL=redis://host:6379
JWT_SECRET=<openssl rand -base64 48>
SESSION_SECRET=<openssl rand -base64 48>
ENCRYPTION_KEY=<openssl rand -base64 32>   # 32 bytes, base64 — encrypts DB secrets at rest
GOOGLE_CLIENT_ID=<oauth client id>          # production login is Google OAuth
GOOGLE_CLIENT_SECRET=<oauth client secret>

# Billing (v2) — required for paid plans
RAZORPAY_KEY_ID=<key id>
RAZORPAY_KEY_SECRET=<key secret>
RAZORPAY_WEBHOOK_SECRET=<webhook secret>    # verifies POST /api/billing/webhook

ALLOW_PASSWORD_LOGIN=false                  # leave OFF in production; Google OAuth is the path
```
> ⚠️ The committed `.env.example` currently holds **real** OpenAI/Google/encryption values. Do not
> copy them forward — rotate and replace with placeholders (see [§8](#8-security--access-control)).

### 3. Build & apply schema
```bash
npm ci
npm run build                 # builds shared → server → client
npm run db:deploy             # prisma migrate deploy (non-interactive)
npm run db:seed               # idempotent: roles, permissions, theme, base config
```

### 4. Run
- Serve the built client (`client/dist`) from a CDN/static host (or behind the same reverse
  proxy), and run the server (`server`) as a long-lived Node process (PM2 / systemd /
  container). Point the reverse proxy's `/api` and the Socket.IO upgrade at the server.
- **Health checks:** liveness `GET /health`; readiness `GET /api/ready` (returns 503 if the DB
  is down; Redis is reported but non-blocking).

### 5. Post-deploy configuration (Admin Console)
1. Log in as a superadmin and **rotate the seeded credentials immediately** (or create real
   accounts and disable the dev seed).
2. Configure SMTP under **System Config** and run the email test.
3. Configure the AI provider key (and base URL/model) under **System Config → AI**.
4. (Optional) Enable **Google Calendar / Google Meet** under **System Config → Integrations**:
   set the OAuth client ID/secret + refresh token and the target calendar ID, toggle the
   enable flags, then use the **Test connection** button. Left unset, scheduling stays local.
5. Create sectors/domains, real users with appropriate roles, and any integrations.

### Security checklist for production
- `NODE_ENV=production` (enables `secure` + `sameSite=strict` cookies and the Redis-down warning).
- Strong, unique `JWT_SECRET` / `SESSION_SECRET` / `ENCRYPTION_KEY` (never the example values).
- Redis reachable (don't run prod with revocation/rate-limit degraded).
- TLS terminated at the proxy; `CLIENT_URL` set to the real origin (CORS + cookie domain).
- The dev seed's accounts removed or rotated.

---

## 18. Operational Notes & Known Gotchas

These have bitten development and are worth keeping front of mind:

1. **Rebuild `shared` after editing it.** The server imports `shared/dist` (compiled JS), not
   live TypeScript. "Property X does not exist" errors in the server usually mean a stale
   `dist` — run `npm run build --workspace=shared`.

2. **🚨 Never run `prisma migrate diff --shadow-database-url <live-db>` (data-safety critical).**
   Prisma treats the shadow DB as disposable and **resets it** (drops all data). Pointing it at
   a real database wipes it. Use a throwaway DB for drift checks. To rebuild a divergent dev DB
   intentionally, use `npm run db:reset` (which also reseeds).

3. **Windows EPERM on `prisma generate` / `migrate dev`.** The running dev server holds
   `query_engine-windows.dll.node`. Kill the server by **port** first via PowerShell
   (`(Get-NetTCPConnection -LocalPort 4000 -State Listen).OwningProcess | Stop-Process -Force`);
   a git-bash `pkill -f tsx` does not match the Windows process. CI on Linux is unaffected.

4. **AI is provider-agnostic and key-in-DB.** All AI paths graceful-degrade when no key is set.
   The key lives in the DB (encrypted), never in `.env`. The base URL is config-driven
   (`ai.openai_base_url`), so OpenAI or any OpenAI-compatible provider works — verified
   end-to-end against **Gemini** (`gemini-2.5-flash`): chat, chatbot AI fallback, and JSON-mode
   features (fit scoring / résumé parsing) all pass.

5. **Soft-delete is model-scoped.** Only models in `SOFT_DELETE_MODELS` get the
   `deletedAt IS NULL` filter and a `deletedAt` column. Append-only child tables are
   deliberately excluded. Probe scripts using a raw `PrismaClient` **bypass** the middleware
   (they see `deletedAt` rows the app hides).

6. **Queue-or-inline dispatch.** Bull is used when Redis is up, with an inline fallback
   otherwise. **Processor services must not import `jobs/dispatch.js`** (avoids an import cycle).

7. **Rate limiter (300 req / 15 min).** In-memory without Redis; trips when running the full
   test suite plus manual smokes back-to-back. Restart the server to reset the counter, or raise
   the limit in DB config (30s config-cache TTL).

8. **Pagination shape.** `Paginated<T>` = `{ items, meta: { total, totalPages, page, pageSize } }`
   — read `data.meta.total`, not `data.total`.

9. **PowerShell `.Count` quirk.** Wrap `Where-Object` results in `@(...)` for reliable counts
   in smoke scripts.

10. **Redis optional in dev, recommended in prod.** With Docker Desktop off, the app still runs
    (DB native on 5432); `/api/ready` reports `redis:false` and rate limiting falls back to
    in-memory. Start Docker + `npm run db:up` to enable the full stack.

11. **Cross-page cache staleness needs explicit invalidation.** React Query is configured with
    `staleTime: 30_000` and `refetchOnWindowFocus: false`. When one page's mutation changes data
    another page reads (e.g. a Screening status change moving a Pipeline card), the mutation must
    invalidate **both** query keys (`['applications']` ↔ `['pipeline-board']`) or the other view
    shows stale data for up to 30 s. The server stays correct regardless — this is a UI-cache
    concern only, and was the root cause of a "status sync looks broken" report.

12. **Google Calendar / Meet are config-driven, not env-driven.** Credentials live in System
    Config (encrypted), resolved per-sector by `calendarService.resolveCalendar()`. There is no
    API to hard-revoke a `meet.google.com` code, so "expiring" a Meet link on cancel is done by
    **deleting the backing calendar event** and clearing the stored `meetingLink`.

13. **`resumeParseService` failure handler assumes the row still exists.** On a parse error it
    does `prisma.resume.update(... FAILED ...)`; if the résumé was deleted before the async job
    ran (e.g. a test-cleanup race), that update throws Prisma **P2025** and masks the original
    error in the background worker. Low production risk; hardening (use `updateMany` or guard the
    update) is a known follow-up.

### v2 tenancy / RLS gotchas

14. **🚨 The app must run as the restricted DB role.** If `DATABASE_URL` points at the privileged
    owner role, **RLS is silently bypassed** — every query still works, every test still passes,
    and the second isolation layer is simply gone. Nothing warns you. Verify with
    `SELECT current_user;` from the running app's connection: it must be `agnohire_app`.

15. **Background jobs have no tenant context unless you give them one.** A Bull worker doesn't
    inherit the request's `AsyncLocalStorage`. Wrap the job body in `runWithTenant(tenantId, …)`
    (persist the `tenantId` in the job payload) — or the choke point sees no tenant, resolves to
    `'__none__'`, and the job quietly reads/writes nothing.

16. **`runAsPlatform()` is a loaded gun.** It disables tenant scoping *and* sets `app.bypass=on`,
    turning off RLS for that block. It's correct for `entitlementService` (billing tables aren't
    tenant-scoped) and platform-operator endpoints, and wrong almost everywhere else. Grep for it
    during review.

17. **Seeds and scripts run privileged.** `db:seed` uses `DIRECT_URL` and therefore bypasses both
    layers. Raw-`PrismaClient` probe scripts likewise see **all tenants' rows** — including
    soft-deleted ones. Don't infer app behavior from a script's output. (Related open issue
    **QUAL-2**: `seed-demo.ts` does an unscoped `deleteMany({})`.)

18. **Quotas count live state, not history.** `ACTIVE_JOBS` counts *open* jobs; it once counted
    lifetime jobs created and produced spurious 402s on approval (BUG-1). When adding a metric, be
    explicit about whether it's a **gauge** (current users, active jobs) or a **counter**
    (interviews conducted this period) — they behave differently across a billing-period reset.

19. **A 402 is not a bug.** Quota-exhausted and inactive-subscription responses are part of the
    contract. Check the workspace's plan and `GET /api/tenant/usage` before debugging a "broken"
    create action.

---

## 19. Challenges & Solutions

| Challenge | Resolution |
|-----------|-----------|
| **Cross-sector data leaks via `OR`-collision** | A duplicate top-level `OR` key in a Prisma `where` silently overwrote the sector scope. Fixed by always combining scope + search under `AND: [scope, { OR: search }]`; regression-tested with live two-sector fixtures. |
| **Privilege escalation through user/role management** | A `USER_MANAGE` holder could mint superadmins; a `ROLE_MANAGE` holder could self-amplify. Added `assertCanAssignRole` (SUPERADMIN-only) and a "can't grant what you don't hold" guard in `setRolePermissions`. |
| **WebSocket bypassing REST sector scoping** | `pipeline:subscribe` accepted any/anonymous socket. Added auth + `canAccessJobPipeline` before joining a room, and socket disconnect at token expiry. |
| **Session tokens usable straight from a DB dump** | Refresh tokens are now SHA-256 hashed at rest; rotation is single-flight; replaying a rotated token revokes the family. |
| **Incomplete GDPR erasure** | The first erasure left PII in chat/transcripts/notes. Now a single transaction also deletes chat conversations/messages and nulls interview transcripts/recordings + application notes. |
| **Non-atomic offer acceptance** | Three separate writes risked partial failure. Wrapped offer→ACCEPTED + onboarding upsert + application→HIRED in one `$transaction`. |
| **Unvalidated foreign keys → raw 500s** | Well-formed-but-nonexistent `sectorId` hit Prisma P2003. Added `assertSectorExists` and an app-wide Prisma error mapper (P2002→409, P2003→400, P2025→404). |
| **Teammates seeing fewer DB tables after cloning** | Diagnosed as un-applied migrations, not a code difference (`migrate diff` = no diff, checked safely off a throwaway DB). Fix: run `npm run db:migrate` / `db:reset`. |
| **A destructive `migrate diff` wiped the dev DB** | Learned the hard way: `--shadow-database-url` resets its target. Reseeded and codified the rule (gotcha #2) to never point it at a live DB. |
| **Windows file-lock on `prisma generate`** | The dev server holds the query-engine DLL. Documented the port-based kill (gotcha #3). |
| **Making AI optional without branching everywhere becoming brittle** | Centralized on `configService.isConfigured(...)` gates with deterministic fallbacks, so a missing key never produces a 500. |

### v2 — retrofitting tenancy onto a live single-tenant schema

| Challenge | Resolution |
|-----------|-----------|
| **Adding `tenantId` to ~50 tables without a big-bang rewrite** | Three staged migrations: add the column **nullable** (`multi_tenant_saas`), backfill, then **tighten to NOT NULL** (`tenant_not_null_tightening`). No service code had to change, because scoping moved to the choke point rather than into each query. |
| **~45 services, any one of which could forget `where: { tenantId }`** | Made it impossible to forget: a single Prisma `$extends`/`$use` choke point stamps and merges `tenantId` centrally. Isolation became a property of the data layer, not a convention. |
| **"What if the choke point has a hole?"** | Assumed it would, and added **Postgres RLS** as an independent second layer against a restricted DB role. A missed scope now yields *no rows* instead of *someone else's rows*. |
| **RLS needs per-request state, but Prisma pools connections** | Set transaction-scoped GUCs (`set_config(..., true)`) and issue them on the **same connection** as the query via Prisma's array-form `$transaction` — the canonical Prisma RLS pattern. |
| **RLS broke the seed** | The seed legitimately writes across tenants. Split the connection: app runs restricted (`DATABASE_URL`), migrations/seed run privileged (`DIRECT_URL`). |
| **Global unique constraints leak across tenants** | A global `@unique` on `Candidate.email` let one workspace's data block another's insert. Replaced with a **per-tenant partial unique index**. The same flaw on **`User.email` is still open** (SEC-3) — harder, because login resolves a user by email *before* a tenant is known. |
| **Per-workspace role edits leaking to every customer** | Roles are global rows; editing one would have changed it for everyone. Added a `TenantRolePermission` **override** table so a workspace's permission edits are layered on top of the global default, isolated per tenant. |
| **The approval gate that wasn't** | Workspaces were correctly created `PENDING`, but **login never checked the flag** — the entire gate was decorative until a live audit drove the real login endpoint (SEC-1). Reading the code would not have caught it; exercising the running app did. |
| **A green test suite that wasn't running** | 10 files were failing to load and 22 tests silently never executed, while CI looked healthy. Fixed and now at 97/97 across 17 files — and the *counts* are now part of what gets checked. |

---

## 20. Results & Outcomes

- **Feature-complete product:** all 14 specification modules delivered, merged to `main`, and
  individually live-verified.
- **Now a SaaS:** tenants/workspaces, five metered plan tiers, Razorpay billing, a
  platform-operator console, approval-gated self-serve signup, and per-workspace role overrides —
  all built **additively** on top of the v1 product, without an architecture rewrite.
- **Defense-in-depth isolation:** tenant scoping enforced at a single Prisma choke point *and*
  independently by PostgreSQL Row-Level Security against a restricted DB role. A forgotten scope
  is now a failed query rather than a data breach.
- **Verified:** 97/97 automated integration tests across 17 files, a 26-check browser E2E sweep,
  and a live end-to-end audit of the running application.
- **Honest about what's open:** the same audit that closed a **critical** approval-gate bypass
  also surfaced **three unresolved isolation issues** (see below). They are documented rather than
  papered over.
- **Operable:** runtime configuration via the Admin Console, encrypted secrets, graceful
  degradation of AI and Redis, liveness + readiness probes, structured logging, and a CI gate.
- **Provider-flexible AI:** the same code drives OpenAI or Gemini with a one-line config change.

**The lesson worth carrying forward:** every one of the v2 audit's most serious findings — the
approval-gate bypass, the lifetime-vs-active quota bug, the seed crash, the 22 tests that never
ran — was **invisible from reading the code** and only appeared when the running application was
driven end-to-end. Code review is necessary and was not sufficient.

---

## 21. Roadmap & Future Scope

| # | Area | Status | Notes |
|---|------|--------|-------|
| 1–11 | Core hiring lifecycle | ✅ complete | merged to `main`, live-verified |
| — | Cross-cutting infra (Section B) | ✅ complete | tests, SMTP, file uploads, realtime |
| 12 | AI Chatbot | ✅ complete | staff demo + FAQ admin + transcripts + candidate portal |
| 13 | Security & GDPR Compliance | ✅ complete | audit viewer + GDPR requests/consent/retention + complete erasure |
| 14 | Admin Console | ✅ complete | users, role/permission matrix, sectors/domains, integrations, templates, system config |
| **v2** | **SaaS platform layer** | ✅ complete | tenants + RLS, plans/quotas/entitlements, Razorpay, platform console, approval gate, password reset |

**The 14-module specification is fully built**, hardened through four production-readiness audits,
and has since been **extended into a multi-tenant SaaS** (v2).

### 🔴 Open issues — highest priority (from the live audit, `ISSUES_AND_SOLUTIONS.md`)

These are known, reproduced defects on `main`. They are the top of the queue.

| ID | Issue | Severity | Why it matters |
|----|-------|----------|----------------|
| **SEC-3** | **`User.email` is globally unique across all tenants** | **High** | A cross-tenant information leak: workspace A can discover (and block registration of) workspace B's user emails. Genuinely hard — login resolves a user by email *before* any tenant is known, so it needs a staged fix, not just an index swap. |
| **SEC-2** | **Soft-deleted users permanently squat their email** | **High** | The unique constraint ignores `deletedAt`, so a deleted user's address can never be reused. Same root shape as SEC-3. |
| **RISK-1** | **Token refresh doesn't re-check the approval gate** | Medium | A session established before a workspace is rejected/suspended survives until the refresh token expires. Currently by design — needs an explicit decision. |
| **QUAL-1** | **`prisma/` and `tests/` are excluded from typecheck** | Medium | Type errors in the seed and the test suite are invisible to CI — which is precisely how the broken test suite went unnoticed. |
| **QUAL-2** | `seed-demo.ts` does an unscoped `deleteMany({})` | Medium | Runs privileged (bypasses RLS); a misfire against the wrong database is unbounded. |
| **QUAL-3** | bcrypt cost factor inconsistent (10 vs 12) | Medium | Two hashing paths disagree. |
| **QUAL-4 / QUAL-5** | Debug logging in hot paths; `seed-jobs.ts` writes a nonexistent job status | Low | Cleanup. |
| **—** | **Real secrets committed to `.env.example`** | **High** | Live OpenAI key, Google refresh token, and `ENCRYPTION_KEY` are in git. Rotate, scrub, purge history. |

> `ISSUES_AND_SOLUTIONS.md` also identifies **three recurring root causes** behind almost all of
> these — its "Systemic Patterns" section is the most useful part of that document.

### Deferred / future work (not spec gaps)
- **Cursor/keyset pagination** across tenant-scoped lists, now that a workspace's data volume is a
  customer-visible performance characteristic.
- **Usage-counter reset semantics** at billing-period rollover (gauge vs counter metrics).
- **Self-serve plan upgrade/downgrade UX** beyond the existing `POST /billing/change-plan`.
- **Demo data seed** — the base seed creates accounts but no sample jobs/candidates/applications;
  a dedicated demo seed makes the pipeline/dashboard demo-ready and lets the data-dependent
  integration tests run.
- **Cursor/keyset pagination** for the highest-volume lists (audit, candidates) — currently OFFSET.
- **Anonymous-socket connection cap**; a CI job that runs the integration suite against a live
  stack (service containers).
- **Activating scaffolded integrations** with live credentials: SMTP, LinkedIn sourcing, and
  Whisper automatic transcription. *(Google Calendar / Meet one-way write is now live and
  config-driven — only inbound two-way sync remains deferred.)*
- **Removing the inert `PANEL_*` permissions / `PANEL_MEMBER` role** left behind by the Hiring
  Panel module's removal, and (optionally) dropping the now-unused `PanelMember` /
  `InterviewFeedback` tables via a migration.
- **Public candidate e-signature portal** for offers (staff currently records acceptance).
- **Harden `resumeParseService`'s failure handler** against the P2025 race (see §18, gotcha 13).
- **Observability**: metrics/tracing; replacing the deprecated Prisma `$use` middleware with
  the client-extensions API; production-grade request logging (morgan currently `'dev'`).

---

## 22. Glossary

| Term | Meaning |
|------|---------|
| **ATS** | Applicant Tracking System — software managing the hiring pipeline |
| **Tenant / Workspace** *(v2)* | A **customer organization**. The hard isolation boundary. "Tenant" is the internal name; "workspace" is what the UI calls it |
| **Sector** | A **business unit inside one tenant** — the finer-grained scope *within* a workspace. (In v1, before tenants existed, the sector *was* the isolation boundary — older text may still imply this) |
| **Domain** | A sub-grouping within a sector |
| **RLS** *(v2)* | **Row-Level Security** — PostgreSQL policies that filter rows at the database, independent of the application |
| **GUC** *(v2)* | A Postgres runtime setting (`app.tenant_id`, `app.bypass`) set per transaction; the RLS policies read these to decide which rows a query may see |
| **Choke point** *(v2)* | The single Prisma extension in `config/database.ts` through which **every** query passes, so `tenantId` cannot be forgotten |
| **Entitlement** *(v2)* | What a workspace's plan permits — quotas (users, jobs, candidates…) plus feature flags (AI, proctoring) |
| **Approval gate** *(v2)* | Self-serve signups start `PENDING` and are inert until a platform operator approves them |
| **402** *(v2)* | The HTTP status returned when a plan quota is exhausted or the subscription is inactive — an expected response, not an error |
| **Fail-closed** | A scope that, when unset, matches *nothing* rather than *everything* |
| **RBAC** | Role-Based Access Control |
| **Permission** | A granular capability (e.g. `OFFER_MANAGE`); roles are bundles of permissions |
| **Soft delete** | Marking a row `deletedAt` instead of physically deleting it |
| **Graceful degradation** | Falling back to deterministic behavior when an optional dependency (AI, Redis) is absent |
| **BGV** | Background Verification (part of onboarding) |
| **GDPR** | General Data Protection Regulation — the data-subject rights this project implements |
| **Right to erasure** | A data subject's right to have their personal data deleted |
| **Consensus (panel)** | A weighted aggregation of panelist recommendations into a single outcome |
| **Plain-FK pattern** | Storing a reference as a `String` column without a Prisma `@relation`, resolved via a secondary query |
| **OR-collision** | The bug class where a duplicate top-level `OR` key overwrites a sector scope |
| **Token (public)** | A 192-bit random token granting access to a public interview/assessment without login |
| **Bull** | The Redis-backed job-queue library used for async work |

---

## 23. Appendices

### Appendix A — Permission catalogue

**41 permissions across 13 functional groups** (defined in `shared/constants/permissions.ts`).
Groups: **Jobs, Candidates, Sourcing, Interviews, Question Bank, Assessments, Analytics,
Pipeline, Panel, Offers, Chatbot, Compliance, System.** Representative permissions:

| Group | Example permissions |
|-------|--------------------|
| Jobs | `JOB_VIEW`, `JOB_MANAGE`, `JOB_APPROVE` |
| Candidates | `CANDIDATE_VIEW`, `CANDIDATE_MANAGE` |
| Sourcing | `SOURCING_VIEW`, `SOURCING_MANAGE` |
| Interviews | `INTERVIEW_VIEW`, `INTERVIEW_MANAGE`, `INTERVIEW_DECIDE` |
| Question Bank | `QUESTION_BANK_VIEW`, `QUESTION_BANK_MANAGE` |
| Assessments | `ASSESSMENT_VIEW`, `ASSESSMENT_MANAGE` |
| Analytics | `ANALYTICS_VIEW` |
| Pipeline | `PIPELINE_VIEW`, `PIPELINE_MANAGE` |
| Panel *(inert)* | `PANEL_FEEDBACK`, `PANEL_MANAGE` — still defined but unused after the Hiring Panel module's removal |
| Offers | `OFFER_VIEW`, `OFFER_MANAGE`, `ONBOARDING_MANAGE` |
| Chatbot | `CHATBOT_VIEW`, `CHATBOT_MANAGE` |
| Compliance | `AUDIT_LOG_VIEW`, `GDPR_MANAGE` |
| System | `USER_MANAGE`, `ROLE_MANAGE`, `SECTOR_MANAGE`, `INTEGRATION_MANAGE`, `SYSTEM_CONFIG_MANAGE` |

> The authoritative list is `PERMISSION_DEFS` in `shared/constants/permissions.ts`; the seed
> applies `DEFAULT_ROLE_PERMISSIONS` and is idempotent. Per-workspace edits are layered on top via
> `TenantRolePermission` (v2) and do not mutate the global defaults.
>
> **Note:** the two `PANEL_*` permissions and the `PANEL_MEMBER` role are **inert leftovers** from
> the removed Hiring Panel module. The platform roles (`PLATFORM_SUPERADMIN`, `TENANT_OWNER`) are
> gated by role and tenant context rather than by a `PERMISSIONS` key.

### Appendix B — Data models (70)

**v2 tenancy & billing (10):** `Tenant`, `Plan`, `Subscription`, `UsageCounter`, `Invoice`,
`PaymentEvent`, `TenantInvite`, `TenantRolePermission`, `MaintenanceWindow`, `AiToolUsage`.

**v1 core:** `User`, `Role`, `Permission`, `RolePermission`, `OAuthAccount`, `UserSession`,
`RefreshToken`, `Sector`, `Domain`, `RecruiterSkill`, `JobRequisition`, `JobTemplate`,
`ApprovalWorkflow`, `Candidate`, `JobApplication`, `CandidateList`, `CandidateListItem`,
`CandidateAssignment`, `Resume`, `Interview`, `InterviewSchedule`, `PanelMember`,
`InterviewResult`, `InterviewFeedback`, `QuestionBank`, `QuestionBankAssignment`, `Question`,
`InterviewQuestion`, `CandidateAnswer`, `Assessment`, `AssessmentQuestion`,
`AssessmentAssignment`, `AssessmentAnswer`, `PipelineNote`, `SourcingChannel`, `Referral`,
`Offer`, `OfferDocument`, `Onboarding`, `ChatbotConversation`, `ChatMessage`, `ChatbotFaq`,
`Notification`, `EmailTemplate`, `EmailLog`, `Integration`, `WebhookLog`, `AuditLog`,
`GdprRequest`, `DataRetentionPolicy`, `SystemConfiguration`, `Theme`, `AnalyticsSnapshot`,
`Attachment` — plus the remaining AI/pipeline tables added by later feature branches.

> `PanelMember` / `InterviewFeedback` remain in the schema but are **unused** (the Hiring Panel
> module was removed; no migration dropped the tables). The authoritative count is
> `grep -c '^model ' server/prisma/schema.prisma`.

### Appendix C — Infrastructure environment variables

| Variable | Purpose |
|----------|---------|
| `NODE_ENV` | `development` / `production` (gates secure cookies + Redis-down warning) |
| `PORT` | Server port (default 4000) |
| `CLIENT_URL` | Frontend origin (CORS + cookie domain) |
| `DATABASE_URL` | PostgreSQL connection for the **app** — must be the **restricted, RLS-bound** role (+ `connection_limit` / `pool_timeout`) |
| `DIRECT_URL` *(v2)* | **Privileged** PostgreSQL connection used only by `prisma migrate`, `db:seed`, and Studio |
| `REDIS_URL` | Redis connection |
| `JWT_SECRET` | Signs access tokens |
| `SESSION_SECRET` | Session signing |
| `ENCRYPTION_KEY` | 32-byte base64 AES-256-GCM key for DB secrets at rest |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Production Google OAuth login |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` *(v2)* | Razorpay subscriptions + checkout |
| `RAZORPAY_WEBHOOK_SECRET` *(v2)* | Verifies the signature on `POST /api/billing/webhook` |
| `ALLOW_PASSWORD_LOGIN` *(v2)* | Enables `POST /auth/dev-login`; leave **off** in production |

> All other settings (SMTP, AI keys, rate limits, themes, integrations) live in the database
> and are managed from the Admin Console — **not** in `.env`.
>
> ⚠️ The tracked `.env.example` currently contains **real** credentials (see
> [§8](#8-security--access-control)). Rotate them and replace with placeholders.

### Appendix D — Command reference

| Command | Purpose |
|---------|---------|
| `npm run setup` | install → build:shared → db:up → db:migrate → db:seed |
| `npm run dev` | run server (:4000) + client (:5173) |
| `npm run build` | typecheck + build shared → server → client |
| `npm run build:shared` | build the shared contract package only |
| `npm run db:up` / `docker:up` | start Postgres + Redis (+ all services) |
| `npm run db:migrate` / `db:deploy` / `db:reset` | apply / deploy / rebuild schema |
| `npm run db:seed` | idempotent seed |
| `npm run db:studio` | Prisma Studio |
| `npm test --workspace=server` | run the integration suite (server must be running) |

### Appendix E — Team: getting the latest code from GitHub

```bash
# already cloned:
git checkout main && git fetch origin && git pull origin main
git log --oneline -1            # confirm you're on the latest commit

# fresh clone (HTTPS — no SSH key needed):
git clone https://github.com/VarunRK04/AgnoHire.git
cd AgnoHire

# then rebuild + re-migrate after pulling:
npm install && npm run build:shared && npm run db:migrate && npm run db:seed
```
> If a teammate gets "Repository not found", the private repo hasn't been shared with their
> account — add them as a collaborator (or make the repo public; secrets live only in the
> gitignored `.env`).

---

*This document reflects the state of the codebase as of `main` (**2026-07-14**): the 14-module
hiring product, complete and hardened through four production-readiness audits, extended into a
**multi-tenant SaaS** (v2) with tenants + PostgreSQL RLS, plans/quotas/entitlements, Razorpay
billing, a platform-operator console, and an approval-gated signup flow. **97/97 tests across 17
files passing; three isolation issues remain open** — see [§21](#21-roadmap--future-scope).*

*Companion documents: `ISSUES_AND_SOLUTIONS.md` (live-audit findings, fixes, open issues — read
its "Systemic Patterns" section), `SAAS_MIGRATION_RUNBOOK.md` (the tenancy migration),
`rls-defense-in-depth-spike.md` (RLS design notes), `SESSION_SUMMARY.md` (per-session build log).*
