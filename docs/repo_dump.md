# Repository Dump

Generated for external review. Excludes node_modules, .git, venv, __pycache__, dist, build.

## Directory Tree

```
.agents/
  AGENTS.md
.env.example
.github/
  workflows/
    ci.yml
.gitignore
AgnoHire_User_Guide.docx
CLAUDE.md
Claude/
  Claude.md
client/
  index.html
  package.json
  postcss.config.js
  public/
    favicon.png
    login-bg.png
    logo.png
    logo-dark.png
  scripts/
    make-favicon-from-mark.cjs
    make-logo-dark-variant.cjs
    make-logo-transparent.cjs
  src/
    App.tsx
    components/
      chatbot/
        ChatbotWidget.tsx
        RichMessage.tsx
        templates/
          CandidateCard.tsx
          GenericDataCard.tsx
          InterviewCard.tsx
          JobCard.tsx
          QuickActions.tsx
          StatusBadge.tsx
      common/
        EmptyState.tsx
        ErrorBoundary.tsx
        PageHeader.tsx
        PlanLimitNotice.tsx
        Skeleton.tsx
        StatCard.tsx
      dashboard/
        DashboardCharts.tsx
      layout/
        MaintenanceBanner.tsx
        Navbar.tsx
        NotificationCenter.tsx
        Sidebar.tsx
      theme/
        FloatingThemeButton.tsx
        ThemeCustomizerDrawer.tsx
      ui/
        Badge.tsx
        Button.tsx
        Drawer.tsx
        FileUploadButton.tsx
        Input.tsx
        Select.tsx
        Spinner.tsx
        TagInput.tsx
        Textarea.tsx
    config/
      brand.ts
      navigation.tsx
      rolePaths.ts
      themeBoot.ts
      themeMode.ts
    hooks/
      usePlanUsage.ts
    layouts/
      AppLayout.tsx
    lib/
      queryClient.ts
    main.tsx
    pages/
      admin/
        AiProviderCard.tsx
        EmailLogPage.tsx
        EmailTemplatesPage.tsx
        GoogleCalendarCard.tsx
        IntegrationsPage.tsx
        MessageUsersDrawer.tsx
        RolesPage.tsx
        SectorsPage.tsx
        SystemConfigPage.tsx
        UsersPage.tsx
      analytics/
        AnalyticsPage.tsx
      assessments/
        AssessmentTakePage.tsx
      audit/
        AuditLogsPage.tsx
      AuthCallbackPage.tsx
      candidate/
        ChatbotSupportPage.tsx
        MyInterviewsPage.tsx
        MyOffersPage.tsx
      candidates/
        BulkUploadDrawer.tsx
        CandidateDetailPanel.tsx
        CandidateDrawer.tsx
        CandidatesPage.tsx
        components/
          CandidateBadges.tsx
          CandidateFilters.tsx
          CandidateTable.tsx
      chatbot/
        ChatbotPage.tsx
        ConversationsPage.tsx
        FaqAdminPage.tsx
      compliance/
        CompliancePage.tsx
      DashboardPage.tsx
      ErrorPages.tsx
      hr/
        HrApprovalModal.tsx
        HrApprovalQueuePage.tsx
      interviews/
        AiGenerateDrawer.tsx
        BankFormDrawer.tsx
        BankQuestionsDrawer.tsx
        CodeEditor.tsx
        InterviewDetailPanel.tsx
        InterviewSetupWizard.tsx
        InterviewsPage.tsx
        InterviewTakePage.tsx
        LaunchInterviewDrawer.tsx
        QuestionBankPage.tsx
        QuestionBulkImportDrawer.tsx
        QuestionEditorDrawer.tsx
        useAudioMonitor.ts
        useAudioRecorder.ts
        useFaceMonitor.ts
        useMediaProctor.ts
        useObjectMonitor.ts
        useSpeech.ts
      jobs/
        components/
          ApprovalTimeline.tsx
          JobFilters.tsx
          JobTable.tsx
          StatusBadge.tsx
        JobCopilot.tsx
        JobDetailPanel.tsx
        JobDrawer.tsx
        JobsPage.tsx
        JobTemplatesDrawer.tsx
      LoginPage.tsx
      offers/
        DocumentPortalPage.tsx
        OfferAcceptPage.tsx
        OfferDetailPanel.tsx
        offerMeta.ts
        OffersPage.tsx
        TentativeOfferAcceptPage.tsx
      pipeline/
        PipelineCardDrawer.tsx
        pipelineMeta.ts
        PipelinePage.tsx
      PlaceholderPage.tsx
      ProfilePage.tsx
      reviews/
        ReviewDetailPanel.tsx
        reviewMeta.ts
        ReviewsPage.tsx
      RootRedirect.tsx
      saas/
        AcceptInvitePage.tsx
        BillingPage.tsx
        MaintenanceSchedulePage.tsx
        PlansAdminPage.tsx
        RegisterPage.tsx
        VerifyEmailPage.tsx
        WorkspaceAccountsPage.tsx
      schedule/
        ScheduleDetailPanel.tsx
        ScheduleDrawer.tsx
        SchedulePage.tsx
      screening/
        ScreeningPage.tsx
      sourcing/
        ChannelsTab.tsx
        ListsTab.tsx
        ReferralsTab.tsx
        SourcingPage.tsx
        TalentSearchTab.tsx
    providers/
      AppProviders.tsx
      AuthBootstrap.tsx
      ConfirmProvider.tsx
      ThemeProvider.tsx
    routes/
      ProtectedRoute.tsx
      RoleRoute.tsx
    services/
      adminApi.ts
      analyticsApi.ts
      api.ts
      assessmentApi.ts
      auditApi.ts
      auth.service.ts
      billingApi.ts
      candidateApi.ts
      candidatePortalApi.ts
      chatbotApi.ts
      fileApi.ts
      gdprApi.ts
      interviewApi.ts
      jobApi.ts
      notificationApi.ts
      offerApi.ts
      pipelineApi.ts
      platformApi.ts
      questionBankApi.ts
      referenceApi.ts
      reviewApi.ts
      scheduleApi.ts
      socket.ts
      sourcingApi.ts
      system.service.ts
    store/
      authStore.ts
      themeStore.ts
    styles/
      globals.css
    utils/
      calendar.ts
      cn.ts
      datetime.ts
      markdownParser.ts
      workspacePath.ts
    vite-env.d.ts
  tailwind.config.ts
  tsconfig.app.json
  tsconfig.json
  tsconfig.node.json
  vite.config.ts
deploy/
  Caddyfile
  nginx.conf
  README.md
docker-compose.yml
docs/
  BUILD_STATUS.md
  Google_Calendar_API_Guide.pdf
  rls-defense-in-depth-spike.md
DOCUMENTATION.md
package.json
package-lock.json
PROJECT_ANALYSIS.md
README.md
Reports.md
RUNNING_GUIDE.md
SAAS_MIGRATION_RUNBOOK.md
scripts/
  dev-client-https.mjs
  gen_user_guide.py
  gen-dev-certs.mjs
server/
  clear-answers.ts
  package.json
  prisma/
    migrations/
      20260601092813_init/
        migration.sql
      20260602051040_module2_resume_filedata/
        migration.sql
      20260603092027_module6_skill_assessment/
        migration.sql
      20260603121032_module8_video_intelligence/
        migration.sql
      20260605095201_module_b_attachments/
        migration.sql
      20260608120000_audit_log_indexes/
        migration.sql
      20260611065559_add_user_profile_fields/
        migration.sql
      20260612045349_interview_proctoring/
        migration.sql
      20260612124500_candidate_answer_unique/
        migration.sql
      20260618133216_interview_ai_integration/
        migration.sql
      20260618155355_code_language_and_result_email_dedupe/
        migration.sql
      20260619102742_email_log_entity_dedupe/
        migration.sql
      20260619160000_assessment_proctoring/
        migration.sql
      20260620120000_abinaya_hr_workflow_offer/
        migration.sql
      20260620140000_assessment_job_requisition/
        migration.sql
      20260622052357_interview_round_number/
        migration.sql
      20260623145948_harikaran_offer_acceptance_round_sync/
        migration.sql
      20260626054831_/
        migration.sql
      20260629073020_add_order/
        migration.sql
      20260630130000_candidate_list_assigned_to/
        migration.sql
      20260702000001_multi_tenant_saas/
        migration.sql
      20260703000001_tenant_not_null_tightening/
        migration.sql
      20260703100000_interview_result_feedback_columns/
        migration.sql
      20260706063755_plan_candidate_schedule_limits/
        migration.sql
      20260706073205_tenant_created_by/
        migration.sql
      20260706090000_tenant_role_permission_override/
        migration.sql
      20260707000000_origin_pipeline_reject_and_ai_tables/
        migration.sql
      20260707093559_maintenance_window/
        migration.sql
      20260707114123_drop_assessment_limit/
        migration.sql
      20260707120000_tenant_approval_gate/
        migration.sql
      20260708120000_candidate_email_tenant_scoped/
        migration.sql
      20260708130000_rls_phase1_restricted_role/
        migration.sql
      20260708140000_rls_phase3_policies/
        migration.sql
      20260708150000_rls_phase4_enable_candidate/
        migration.sql
      20260708160000_rls_phase4_enable_remaining/
        migration.sql
      migration_lock.toml
    schema.prisma
    seed.ts
  query.ts
  scripts/
    ai-smoke.ts
    assign-interview.ts
    check-candidates.ts
    create-question-bank.ts
    generateAITools.ts
    seed-demo.ts
    seed-jobs.ts
  src/
    ai/
      intentDetector/
        index.ts
      parameterCollector/
        index.ts
      permissionChecker/
        index.ts
      responseFormatter/
        index.ts
      toolExecutor/
        index.ts
      toolRegistry/
        index.ts
      tools/
        analytics/
          index.ts
        assessment/
          index.ts
        candidate/
          index.ts
        dashboard/
          index.ts
        generated/
          adminTools.ts
          analyticsTools.ts
          applicationTools.ts
          assessmentTools.ts
          attachmentTools.ts
          auditTools.ts
          authTools.ts
          billingTools.ts
          candidatePortalTools.ts
          candidateTools.ts
          chatbotTools.ts
          gdprTools.ts
          hrTools.ts
          index.ts
          interviewTools.ts
          jobTools.ts
          notificationTools.ts
          offerTools.ts
          pipelineTools.ts
          platformTools.ts
          publicAssessmentTools.ts
          publicInterviewTools.ts
          publicOfferTools.ts
          questionBankTools.ts
          referenceTools.ts
          registrationTools.ts
          reviewTools.ts
          scheduleTools.ts
          sourcingTools.ts
          systemTools.ts
          tenantTools.ts
        index.ts
        interview/
          index.ts
        job/
          index.ts
        notification/
          index.ts
        report/
          index.ts
    app.ts
    config/
      bullBoard.ts
      database.ts
      encryption.ts
      env.ts
      logger.ts
      passport.ts
      redis.ts
      socket.ts
      tenantContext.ts
    controllers/
      admin.controller.ts
      analytics.controller.ts
      assessment.controller.ts
      attachment.controller.ts
      audit.controller.ts
      auth.controller.ts
      candidate.controller.ts
      candidatePortal.controller.ts
      chatbot.controller.ts
      gdpr.controller.ts
      hrApproval.controller.ts
      interview.controller.ts
      job.controller.ts
      notification.controller.ts
      offer.controller.ts
      pipeline.controller.ts
      platform.controller.ts
      publicAssessment.controller.ts
      publicInterview.controller.ts
      publicOffer.controller.ts
      questionBank.controller.ts
      review.controller.ts
      schedule.controller.ts
      sourcing.controller.ts
      system.controller.ts
    data/
      knowledgeBase.json
    jobs/
      dispatch.ts
      queues.ts
      workers.ts
    middlewares/
      auth.middleware.ts
      error.middleware.ts
      publicTenantScope.middleware.ts
      rateLimiter.middleware.ts
      rbac.middleware.ts
      tenantHost.middleware.ts
      validate.middleware.ts
    query_interviews.ts
    query_users.ts
    routes/
      admin.routes.ts
      analytics.routes.ts
      application.routes.ts
      assessment.routes.ts
      attachment.routes.ts
      audit.routes.ts
      auth.routes.ts
      billing.routes.ts
      billingWebhook.ts
      candidate.routes.ts
      candidatePortal.routes.ts
      chatbot.routes.ts
      gdpr.routes.ts
      hr.routes.ts
      index.ts
      interview.routes.ts
      job.routes.ts
      notification.routes.ts
      offer.routes.ts
      pipeline.routes.ts
      platform.routes.ts
      publicAssessment.routes.ts
      publicInterview.routes.ts
      publicOffer.routes.ts
      questionBank.routes.ts
      reference.routes.ts
      registration.routes.ts
      review.routes.ts
      schedule.routes.ts
      sourcing.routes.ts
      system.routes.ts
      tenant.routes.ts
    scratch_candidates.ts
    scripts/
      bootstrapPlans.ts
      sync_data.ts
    services/
      adminSectorService.ts
      adminUserService.ts
      aiProviderService.ts
      analyticsService.ts
      assessmentScoringService.ts
      assessmentService.ts
      attachmentService.ts
      auditService.ts
      authService.ts
      availabilityService.ts
      billing/
        billingService.ts
        razorpayProvider.ts
      bulkUploadService.ts
      calendarService.ts
      candidateListService.ts
      candidatePortalService.ts
      candidateService.ts
      chatbotService.ts
      codeExecutionService.ts
      configService.ts
      emailTemplates.ts
      emailTemplateService.ts
      entitlementService.ts
      fitScoreService.ts
      gdprService.ts
      hrApprovalService.ts
      integrationService.ts
      interviewScoringService.ts
      interviewService.ts
      jobService.ts
      judge0Service.ts
      mailerService.ts
      maintenanceService.ts
      notificationService.ts
      offerService.ts
      pdfReportService.ts
      pipelineService.ts
      planAdminService.ts
      publicAssessmentService.ts
      publicInterviewService.ts
      questionBankService.ts
      referralService.ts
      reminderService.ts
      resumeParseService.ts
      reviewService.ts
      roleService.ts
      scheduleService.ts
      sourcingService.ts
      tenantProvisioningService.ts
      videoIntelligenceService.ts
      workflowProgressionService.ts
      workspaceAdminService.ts
    types/
      express.d.ts
    utils/
      accessScope.ts
      asyncHandler.ts
      errors.ts
      ocr.ts
      remoteFile.ts
      response.ts
      storage.ts
      timezone.ts
      tokenHelper.ts
  sync-status.cjs
  test_prisma.ts
  test_tenant_users.ts
  tests/
    admin.test.ts
    attachments.test.ts
    auth.test.ts
    billingSignatures.test.ts
    billingStateMachine.test.ts
    biometric.test.ts
    bulkImportJobRequisition.test.ts
    chatbot.test.ts
    compliance.test.ts
    documentsWorkflow.test.ts
    email.test.ts
    helpers.ts
    isolation.test.ts
    modules.test.ts
    notifications.test.ts
    pipeline.test.ts
    resumeLimit.test.ts
    tenantIsolation.test.ts
  tsconfig.json
  vitest.config.ts
SESSION_SUMMARY.md
shared/
  package.json
  src/
    constants/
      configKeys.ts
      enums.ts
      notifications.ts
      permissions.ts
      roles.ts
      themes.ts
    index.ts
    schemas/
      admin.ts
      analytics.ts
      assessment.ts
      audit.ts
      auth.ts
      billing.ts
      candidate.ts
      chatbot.ts
      common.ts
      gdpr.ts
      interview.ts
      job.ts
      maintenance.ts
      offer.ts
      pipeline.ts
      review.ts
      schedule.ts
      sourcing.ts
    types/
      admin.ts
      analytics.ts
      api.ts
      assessment.ts
      attachment.ts
      audit.ts
      billing.ts
      candidate.ts
      candidatePortal.ts
      chatbot.ts
      gdpr.ts
      interview.ts
      job.ts
      maintenance.ts
      notification.ts
      offer.ts
      pipeline.ts
      review.ts
      schedule.ts
      sourcing.ts
    utils/
      string.ts
      workflowRound.ts
  tsconfig.json
summay of project
TECHNICAL_ARCHITECTURE.md
TECHNOLOGIES.md
tsconfig.base.json
updatePrompt.js
```

## Key Files

### README.md

```md
# AgnoHire

Enterprise AI-powered Applicant Tracking System (ATS) + AI Interview Platform.

A TypeScript monorepo: `shared` (types + Zod), `server` (Express + Prisma + Bull), `client` (React + Vite + Tailwind/ShadCN).

## Architecture principle: zero hardcoded config

The only values read from `.env` are infrastructure secrets (DB/Redis URLs, JWT/session/encryption secrets, Google OAuth, runtime). **Everything else** — SMTP, third-party API keys, rate limits, themes, permissions, integrations — is stored in the database (`SystemConfiguration`, `Integration`, `Theme`, `Role`/`Permission`) and edited from the Admin Console. Secrets at rest are AES-256-GCM encrypted.

## Prerequisites

- Node.js 20+
- Docker (for Postgres 15 + Redis 7)

## Quick start

```bash
cp .env.example .env          # then edit secrets
npm install                   # installs all workspaces
npm run build:shared          # shared types must build before server/client typecheck
npm run db:up                 # start Postgres + Redis
npm run db:migrate            # apply Prisma schema
npm run db:seed               # roles, permissions, default theme, base config, dev admin, plan catalogue
npm run dev                   # server (:4000) + client (:5173)
```

Or in one shot after editing `.env`: `npm run setup` then `npm run dev`.

## Database setup (read this if your table count looks wrong)

**Cloning the repo does not create any database tables.** Git tracks the
code and the Prisma **migration files** in [`server/prisma/migrations/`](server/prisma/migrations/) —
not your data and not your applied schema. Every developer must apply the
migrations to their *own* local Postgres. The committed migrations build the
**full 54-table schema**; a correctly set-up DB has **54 application tables**
(plus Prisma's internal `_prisma_migrations` table).

| Command | When to use |
|---------|-------------|
| `npm run db:migrate` | First-time / day-to-day dev. Runs `prisma migrate dev` — applies any pending migrations. |
| `npm run db:deploy` | CI / non-interactive apply. Runs `prisma migrate deploy`. |
| `npm run db:reset` | **Fix a divergent DB.** Drops everything, replays all migrations from scratch, then reseeds. |
| `npm run db:seed` | Re-run the seed (roles, permissions, themes, dev admin, FREE/STARTER/PRO/ENTERPRISE plan catalogue). Safe to run repeatedly. |

**If you cloned before the plan catalogue was added to `db:seed`:** the registration/billing pages will show no selectable plans until you re-run `npm run db:seed` (safe, idempotent, won't touch existing data).

### "My teammate has fewer tables than me" / `P3005` baseline errors

This means the two databases are at **different migration states** — almost
always because one of them is a **leftover database from an older checkout**
that was never re-migrated, or migrations were simply never run. It is *not* a
code problem: the migrations in `main` are complete and reproduce the schema
exactly.

To force any database to match the committed schema (⚠️ **wipes all data** —
it's a dev DB, the seed rebuilds it):

```bash
npm run db:reset      # rebuilds all 54 tables from migrations
npm run db:seed       # restores roles/permissions/themes/dev admin
```

Verify with `npm run db:studio` (or `prisma migrate status` in `server/`) —
you should see all 5 migrations applied and 54 application tables.

## Workspaces

| Path      | Description |
|-----------|-------------|
| `shared/` | Shared TypeScript types, Zod validation schemas, role/permission/enum constants. Imported by both server and client. |
| `server/` | Express API, Prisma ORM, Passport auth (Google OAuth + JWT), Redis/Bull queues, Socket.IO, Winston logging. |
| `client/` | React 18 (Vite), Tailwind + ShadCN, Zustand + TanStack Query, React Router, Socket.IO client. |

## Build status

**All 14 modules are complete and merged to `main`** (plus a cross-cutting infrastructure pass, "Section B"). The full spec is built. See `SESSION_SUMMARY.md` for the full module-by-module status and `DOCUMENTATION.md` for the project reference.

| #     | Module                              | Status     |
|-------|-------------------------------------|------------|
| 1     | Job Requisition & JD Management     | ✅ complete |
| 2     | Resume Parsing & Candidate Screening| ✅ complete |
| 3     | Candidate Sourcing                  | ✅ complete |
| 4     | AI Interview Engine                 | ✅ complete |
| 5     | Interview Scheduling                | ✅ complete |
| 6     | Skill Assessment                    | ✅ complete |
| 7     | AI Analytics & Reporting            | ✅ complete |
| 8     | Video Interview Intelligence        | ✅ complete |
| 9     | ATS Pipeline / Kanban               | ✅ complete |
| 10    | Hiring Panel                        | ✅ complete |
| 11    | Offer & Onboarding                  | ✅ complete |
| 12    | AI Chatbot (staff + candidate portal)| ✅ complete |
| 13    | Security & GDPR Compliance          | ✅ complete |
| 14    | Admin Console                       | ✅ complete |

**Cross-cutting infrastructure (Section B):** automated test suite (Vitest + Supertest), SMTP email delivery, real file uploads, and realtime notifications — see below.

### Cross-cutting infrastructure (Section B)

| Capability | What |
|------------|------|
| **Automated tests** | Vitest + Supertest integration suite (`npm test --workspace=server`, needs the server running). 66 tests covering auth, RBAC, sector isolation, M1–M14 flows, email, attachments, notifications. |
| **Email (SMTP)** | DB-configured nodemailer (`email.*` settings); interview reminders + offer/panel notifications; graceful no-op when unset. `POST /api/system/email/test`. |
| **File uploads** | Generic `Attachment` store (bytes in Postgres) at `/api/files`; offer documents, offer letters, and BGV reports are real uploads. Downloads are sector-scoped. |
| **Realtime** | Socket.IO in-app notification center + live Kanban board updates. |

## Local development credentials (dev seed)

The `db:seed` step creates a default super-admin for local development:

```
Email:    admin@agnohire.local
Password: Admin@12345
```

> ⚠️ Development only. These credentials exist solely in the local seed — never deploy the dev seed to a shared or production environment.

## 📚 Documentation

The following documentation is available for AgnoHire.

| Document | Description |
|----------|-------------|
| [Google Calendar API & Google Meet Integration Guide](docs/Google_Calendar_API_Guide.pdf) | Complete setup guide for Google Calendar API, OAuth configuration, Google Meet generation, Client ID, Client Secret, and Refresh Token. |

```

### CLAUDE.md

```md
# Repository rules

- This working directory (`d:\Agnohire_Cloud_Testing`) must only push to/pull from
  **https://github.com/VarunRK04/AgnoHire_Cloud_Test** (git remote `cloudtest`).
  Do **not** push changes made in this folder to the `origin` remote
  (https://github.com/VarunRK04/AgnoHire.git) — that is a separate repository.
  Local `main` should track `cloudtest/main`.

```

### .env.example

```example
# ─── AgnoHire Infrastructure Secrets ─────────────────────────────
# Per spec: these are the ONLY permitted .env variables.
# Every other setting (SMTP, API keys, limits, themes, integrations)
# is configured exclusively through the Admin Console UI (stored in DB).

# Postgres (used by docker-compose + Prisma)
POSTGRES_USER=agnohire
POSTGRES_PASSWORD=Admin@24
POSTGRES_DB=agnohire_cloud
POSTGRES_PORT=5435
# connection_limit caps the Prisma pool (API + Bull workers share it — keep it
# below Postgres max_connections); pool_timeout makes a request fail fast (10s)
# instead of hanging when the pool is exhausted under concurrent queue load.
#
# RLS: the app runtime connects as the RESTRICTED, non-superuser, NOBYPASSRLS
# role (agnohire_app) so Postgres Row-Level Security is actually enforced.
# Migrations/introspection use the OWNER via DIRECT_URL. See
# docs/rls-defense-in-depth-spike.md. The agnohire_app role is created by
# migration 20260708130000_rls_phase1_restricted_role (set a real password
# out-of-band in non-dev environments).
DATABASE_URL=postgresql://agnohire_app:agnohire_app@localhost:5432/agnohire?schema=public&connection_limit=20&pool_timeout=10
DIRECT_URL=postgresql://agnohire:agnohire@localhost:5432/agnohire?schema=public
# Recommended at the DB level (prevents a runaway query pinning a connection):
#   ALTER ROLE agnohire SET statement_timeout = '30s';

# Redis (cache + Bull queues)
REDIS_PORT=6381
REDIS_URL=redis://localhost:6381

# Auth secrets — generate with: openssl rand -base64 48
JWT_SECRET=6eb530368f0bae62814e320a48f57691572ae956c4cfbaa1aacf6d1f7c72793d
SESSION_SECRET=8e5ab9779c818cd3fa02ed9b53260f5af7048872612af6f9e097f8d0c195d2f0
# AES-256-GCM key for encrypting integration secrets at rest in the DB.
# REQUIRED: must base64-decode to exactly 32 bytes, or the server refuses to
# start. Do NOT keep this placeholder — generate your own with:
#   openssl rand -base64 32
ENCRYPTION_KEY=3trx7WlwP5VJ0GoGpH1ybvNNJTbSB297E264OjCnK20=
# Google OAuth 2.0 (optional in dev — a dev email login fallback exists
# when these are blank and NODE_ENV !== production)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Runtime
NODE_ENV=development
PORT=4000
CLIENT_URL=http://localhost:5173

# ── AI provider (optional, local convenience) ────────────────────────────────
# The AI key normally lives in the DB (Admin Console → System Config → AI),
# encrypted at rest — it is NOT required here. But for quick local setup, if you
# set these, `npm run db:seed` writes them into your DB (key encrypted) so AI
# features work without using the UI. These stay in YOUR local .env (gitignored)
# and are never committed. Works with OpenAI or any compatible provider:
#   OpenAI : leave BASE_URL blank (defaults to https://api.openai.com/v1), MODEL=gpt-4o-mini
#   Gemini : BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai, MODEL=gemini-2.5-flash
OPENAI_API_KEY=sk-proj-YOUR_API_KEY_HERE
OPENAI_BASE_URL=
OPENAI_MODEL=

# ── Google Calendar + Meet (optional, local convenience) ─────────────────────
# Like the AI key above, the calendar integration normally lives in the DB
# (Admin Console → Integrations), encrypted at rest. For quick setup, fill these
# in and run `npm run db:seed` — it writes an enabled GOOGLE_CALENDAR integration
# into your DB (config encrypted) so interview scheduling auto-creates Google
# Calendar events + Google Meet links. These stay in YOUR local .env (gitignored).
#
# How to get them:
#   1. Google Cloud Console → enable "Google Calendar API"
#   2. Create an OAuth 2.0 Client ID (Web application) → copy Client ID + Secret
#      (you can reuse GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET above)
#   3. https://developers.google.com/oauthplayground → gear → "Use your own
#      OAuth credentials" → scope https://www.googleapis.com/auth/calendar →
#      Authorize → Exchange authorization code → copy the Refresh token
#
# Client id/secret fall back to GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET if blank.
# All three (client id + secret + refresh token) are required to activate.
GOOGLE_CALENDAR_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com
GOOGLE_CALENDAR_CLIENT_SECRET=GOCSPX-YOUR_CLIENT_SECRET
GOOGLE_CALENDAR_REFRESH_TOKEN=1//YOUR_REFRESH_TOKEN
GOOGLE_CALENDAR_ID=primary
# ─── SaaS: Razorpay recurring billing (PLATFORM-level operator secrets) ───────
# One Razorpay account for the whole SaaS. These are NOT per-tenant config and
# must never be stored in the database. Use TEST keys (rzp_test_...) outside prod.
# KEY_ID is also exposed to the client (safe/public) to open Razorpay Checkout.
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
# Secret configured on the Razorpay dashboard webhook for
#   https://<your-domain>/api/billing/webhook
RAZORPAY_WEBHOOK_SECRET=

# SaaS: allow email/password login as a production path (self-registered
# tenants have no Google OAuth). Recommended: true for the cloud deployment.
ALLOW_PASSWORD_LOGIN=true

```

### package.json

```json
{
  "name": "agnohire",
  "version": "0.1.0",
  "private": true,
  "description": "AgnoHire — Enterprise AI Recruitment Management Platform (ATS)",
  "workspaces": [
    "shared",
    "server",
    "client"
  ],
  "scripts": {
    "predev": "npm run build:shared && npm run prisma:generate --workspace server",
    "dev": "concurrently -n server,client -c blue,magenta \"npm:dev:server\" \"npm:dev:client\"",
    "dev:https": "concurrently -n server,client -c blue,magenta \"npm:dev:server\" \"npm:dev:client:https\"",
    "dev:server": "npm run tools:generate --workspace server && npm run dev --workspace server",
    "dev:client": "npm run dev --workspace client",
    "dev:client:https": "node scripts/dev-client-https.mjs",
    "certs:dev": "node scripts/gen-dev-certs.mjs",
    "build": "npm run build --workspace shared && npm run tools:generate --workspace server && npm run build --workspace server && npm run build --workspace client",
    "build:shared": "npm run build --workspace shared",
    "db:up": "docker compose up -d postgres redis",
    "db:migrate": "npm run prisma:migrate --workspace server",
    "db:deploy": "npm run prisma:deploy --workspace server",
    "db:reset": "npm run prisma:reset --workspace server",
    "db:seed": "npm run prisma:seed --workspace server",
    "db:studio": "npm run prisma:studio --workspace server",
    "docker:up": "docker compose up -d",
    "docker:down": "docker compose down",
    "setup": "npm install && npm run build:shared && npm run prisma:generate --workspace server && npm run db:up && npm run db:deploy && npm run db:seed",
    "sync": "npm install && npm run build:shared && npm run prisma:generate --workspace server && npm run db:deploy"
  },
  "devDependencies": {
    "concurrently": "^9.1.0"
  },
  "engines": {
    "node": ">=20"
  },
  "dependencies": {
    "fluent-ffmpeg": "^2.1.3",
    "openai": "^6.43.0"
  }
}

```

### client/package.json

```json
{
  "name": "@agnohire/client",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -b --noEmit"
  },
  "dependencies": {
    "@agnohire/shared": "*",
    "@fontsource/jetbrains-mono": "^5.1.2",
    "@fontsource/plus-jakarta-sans": "^5.1.0",
    "@fontsource/syne": "^5.1.0",
    "@headlessui/react": "^2.2.10",
    "@hookform/resolvers": "^5.4.0",
    "@monaco-editor/react": "^4.7.0",
    "@tanstack/react-query": "^5.62.7",
    "@tensorflow-models/blazeface": "^0.1.0",
    "@tensorflow-models/coco-ssd": "^2.2.3",
    "@tensorflow/tfjs": "^4.22.0",
    "@vladmandic/face-api": "^1.7.15",
    "axios": "^1.7.9",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "date-fns": "^4.1.0",
    "framer-motion": "^11.15.0",
    "lucide-react": "^0.468.0",
    "onnxruntime-web": "^1.27.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-hook-form": "^7.54.2",
    "react-hot-toast": "^2.4.1",
    "react-markdown": "^10.1.0",
    "react-quill": "^2.0.0",
    "react-router-dom": "^6.28.1",
    "recharts": "^3.8.1",
    "remark-gfm": "^4.0.1",
    "socket.io-client": "^4.8.1",
    "tailwind-merge": "^2.6.0",
    "xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz",
    "zod": "^3.23.8",
    "zustand": "^5.0.2"
  },
  "devDependencies": {
    "@types/react": "^18.3.18",
    "@types/react-dom": "^18.3.5",
    "@vitejs/plugin-react": "^4.3.4",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.17",
    "typescript": "^5.6.3",
    "vite": "^6.0.5"
  }
}

```

### server/package.json

```json
{
  "name": "@agnohire/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/app.js",
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  },
  "scripts": {
    "dev": "tsx watch src/app.ts",
    "build": "prisma generate && tsc -p tsconfig.json",
    "start": "node dist/app.js",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "dotenv -e ../.env -- prisma migrate dev",
    "prisma:deploy": "dotenv -e ../.env -- prisma migrate deploy",
    "prisma:reset": "dotenv -e ../.env -- prisma migrate reset --force",
    "prisma:seed": "dotenv -e ../.env -- tsx prisma/seed.ts",
    "prisma:studio": "dotenv -e ../.env -- prisma studio",
    "tools:generate": "tsx scripts/generateAITools.ts",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "bootstrap:plans": "dotenv -e ../.env -- tsx src/scripts/bootstrapPlans.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@agnohire/shared": "*",
    "@bull-board/api": "^6.5.0",
    "@bull-board/express": "^6.5.0",
    "@napi-rs/canvas": "^1.0.0",
    "@prisma/client": "^5.22.0",
    "bcrypt": "^5.1.1",
    "bull": "^4.16.5",
    "cookie-parser": "^1.4.7",
    "cors": "^2.8.5",
    "csv-parse": "^6.2.1",
    "dotenv": "^16.4.7",
    "express": "^4.21.2",
    "express-rate-limit": "^7.5.0",
    "express-session": "^1.18.1",
    "google-auth-library": "^10.7.0",
    "googleapis": "^173.0.0",
    "helmet": "^8.0.0",
    "ioredis": "^5.4.2",
    "isomorphic-dompurify": "^2.18.0",
    "jsonwebtoken": "^9.0.2",
    "mammoth": "^1.12.0",
    "morgan": "^1.10.0",
    "multer": "^1.4.5-lts.1",
    "nodemailer": "^8.0.10",
    "passport": "^0.7.0",
    "passport-google-oauth20": "^2.0.0",
    "pdf-parse": "^1.1.1",
    "pdfjs-dist": "^6.0.227",
    "pdfkit": "^0.19.1",
    "rate-limit-redis": "^4.3.1",
    "razorpay": "^2.9.4",
    "socket.io": "^4.8.1",
    "tesseract.js": "^7.0.0",
    "winston": "^3.17.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/bcrypt": "^5.0.2",
    "@types/cookie-parser": "^1.4.8",
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/express-session": "^1.18.1",
    "@types/jsonwebtoken": "^9.0.7",
    "@types/morgan": "^1.9.9",
    "@types/multer": "^1.4.12",
    "@types/node": "^22.10.2",
    "@types/nodemailer": "^6.4.17",
    "@types/passport": "^1.0.17",
    "@types/passport-google-oauth20": "^2.0.16",
    "@types/pdf-parse": "^1.1.5",
    "@types/pdfkit": "^0.17.6",
    "@types/supertest": "^7.2.0",
    "dotenv-cli": "^7.4.4",
    "prisma": "^5.22.0",
    "supertest": "^7.2.2",
    "ts-morph": "^28.0.0",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^4.1.8",
    "zod-to-json-schema": "^3.25.2"
  }
}

```

### docker-compose.yml

```yml
services:
  postgres:
    image: postgres:15-alpine
    container_name: agnohire-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-agnohire}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-agnohire}
      POSTGRES_DB: ${POSTGRES_DB:-agnohire}
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-agnohire}"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: agnohire-redis
    restart: unless-stopped
    ports:
      - "${REDIS_PORT:-6379}:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
  redis_data:

```

