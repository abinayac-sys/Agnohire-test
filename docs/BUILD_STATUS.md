# Build Status

Tracks implemented vs. stubbed features against the AgnoHire v2.0 spec. Updated as the build progresses.

Legend: ✅ done · 🟡 partial/scaffolded · ⛔ not started · 🔌 needs external credential (configured via Admin Console)

## Foundation

| Area | Status | Notes |
|------|--------|-------|
| Monorepo (shared/server/client) | ✅ | npm workspaces; installs + typechecks clean |
| Docker infra (Postgres 15, Redis 7) | ✅ | `docker-compose.yml` (needs daemon running) |
| Full Prisma schema (~50 models) | ✅ | Validated; client generated |
| Shared types + Zod schemas | ✅ | Builds to `dist`; consumed by server + client |
| ConfigService (DB-driven settings) | ✅ | Cached, decrypts secrets, typed getters |
| AES-256-GCM secret encryption | ✅ | `config/encryption.ts` |
| Auth: Google OAuth + JWT + dev fallback | ✅ | Refresh rotation, lockout, revocation list |
| RBAC middleware | ✅ | Permission + role guards; superadmin bypass |
| Audit middleware | ✅ | `recordAudit` helper wired into auth/system |
| Soft-delete Prisma middleware | ✅ | Global `$use`, opt-out supported |
| Socket.IO (server + client) | ✅ | JWT handshake, user/role rooms, theme broadcast |
| Bull queues + Bull Board | ✅ | 11 queues registered; dashboard admin-protected |
| Theme system (CSS vars from DB) | ✅ | 5 presets, live `theme:updated` apply |
| Client app shell (sidebar/navbar) | ✅ | Collapsible sidebar, role nav, bell hidden for candidates |

**Verified:** `npm install`, `npm run build:shared`, `prisma generate`, server typecheck, client typecheck, client production build — all pass.
**Pending (needs Docker daemon):** `db:migrate` → `db:seed` → `npm run dev` live boot. Postgres on :5432 in this env is a foreign install; use the compose stack for matching credentials.

## Modules

| # | Module | Status |
|---|--------|--------|
| 1 | Job Requisition & JD Management | ✅ |
| 2 | Resume Parsing & Screening | ✅ 🔌 (AI parse/score need OpenAI key; bulk import + recruiter assignment done) |
| 3 | Candidate Sourcing | ✅ 🔌 (referrals, channels, curated lists + bulk assign, advanced search; LinkedIn scaffolded — needs Module 14 creds; Kanban deferred to M9) |
| 4 | AI Interview Engine | ⛔ 🔌 |
| 5 | Interview Scheduling | ⛔ 🔌 |
| 6 | Skill Assessment | ⛔ 🔌 |
| 7 | AI Analytics & Scoring | ⛔ |
| 8 | Video Interview Intelligence | ⛔ 🔌 |
| 9 | ATS Pipeline | ⛔ |
| 10 | Collaboration & Hiring Panel | ⛔ |
| 11 | Offer & Onboarding | ⛔ |
| 12 | AI Chatbot / Engagement | ⛔ 🔌 |
| 13 | Security & Compliance (GDPR) | ⛔ |
| 14 | Admin Console / System Config | ⛔ |

🔌 modules degrade gracefully (stubbed AI/integration calls) until the relevant key is set in the Admin Console.
