-- RLS Phase 4 (continued): enable + force Row-Level Security on the remaining
-- tenant-scoped tables (Candidate was enabled in 20260708150000).
--
-- Prerequisites now satisfied in application code:
--   * Login / OAuth / refresh look up User pre-auth via runAsPlatform (bypass),
--     since User.email is globally unique (auth.controller, passport).
--   * Admin user-create dedup checks User globally via runAsPlatform.
--   * Tenant provisioning, maintenance jobs, and configService already use
--     runAsPlatform for their cross-tenant / context-less access.
--   * Public/id-based attachment serving uses runAsPlatform.
--   * Bull workers re-establish tenant context via runJobInTenant.
--
-- The owner role (agnohire, superuser) bypasses RLS, so migrations and seed are
-- unaffected. Each table is instantly reversible: DISABLE ROW LEVEL SECURITY.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'User','Sector','Domain','JobRequisition','JobTemplate',
    'JobApplication','CandidateList','CandidateAssignment','Resume','Interview',
    'InterviewSchedule','QuestionBank','Question','Assessment','AssessmentAssignment',
    'PipelineNote','SourcingChannel','Referral','Offer','ChatbotConversation',
    'Notification','EmailTemplate','EmailLog','Integration','WebhookLog','AuditLog',
    'GdprRequest','SystemConfiguration','AnalyticsSnapshot','Attachment'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;
