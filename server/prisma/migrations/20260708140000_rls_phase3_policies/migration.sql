-- RLS Phase 3: define the tenant-isolation policy on every tenant-scoped table.
--
-- Policies are INERT until RLS is enabled per table (Phase 4), so this migration
-- changes no behavior on its own. A row is visible/writable when:
--   * app.bypass = 'on'  (PLATFORM_SUPERADMIN / legacy SUPERADMIN operators), OR
--   * "tenantId" matches the request's app.tenant_id GUC, OR
--   * "tenantId" IS NULL (legacy / pre-tenancy / global rows).
--
-- The table list mirrors TENANT_MODELS in server/src/config/database.ts (the
-- app-level choke point) so DB enforcement matches application scoping exactly.
-- The owner role (agnohire, superuser) bypasses RLS entirely, so migrations and
-- seed scripts are unaffected; only the restricted app role is constrained.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'User','Sector','Domain','JobRequisition','JobTemplate','Candidate',
    'JobApplication','CandidateList','CandidateAssignment','Resume','Interview',
    'InterviewSchedule','QuestionBank','Question','Assessment','AssessmentAssignment',
    'PipelineNote','SourcingChannel','Referral','Offer','ChatbotConversation',
    'Notification','EmailTemplate','EmailLog','Integration','WebhookLog','AuditLog',
    'GdprRequest','SystemConfiguration','AnalyticsSnapshot','Attachment'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING ('
      '  current_setting(''app.bypass'', true) = ''on'''
      '  OR "tenantId" = current_setting(''app.tenant_id'', true)'
      '  OR "tenantId" IS NULL'
      ') '
      'WITH CHECK ('
      '  current_setting(''app.bypass'', true) = ''on'''
      '  OR "tenantId" = current_setting(''app.tenant_id'', true)'
      '  OR "tenantId" IS NULL'
      ')', t);
  END LOOP;
END
$$;
