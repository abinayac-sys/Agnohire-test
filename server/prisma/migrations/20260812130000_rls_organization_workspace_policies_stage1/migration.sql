-- RLS for Organization/Workspace, stage 1.
--
-- Part A — the four new tables from this rollout (Organization, Workspace,
-- OrganizationMember, WorkspaceMember) never had RLS at all. Give them the
-- exact same tenant_isolation treatment every other TENANT_MODELS table
-- already has (mirrors 20260708140000_rls_phase3_policies /
-- 20260708160000_rls_phase4_enable_remaining) — create + enable + force in
-- one migration, since (unlike the historical staged rollout, which had to
-- accommodate pre-existing production data) these tables are new and already
-- fully backfilled by this point.
--
-- Part B — a NEW, additional RESTRICTIVE workspace_isolation policy on the 12
-- G1b tables (Domain, Candidate, User, Integration, SystemConfiguration,
-- QuestionBank, Assessment, JobTemplate, CandidateList, EmailTemplate,
-- AuditLog, AnalyticsSnapshot), where workspaceId is nullable forever. Added
-- as RESTRICTIVE (not folded into the existing PERMISSIVE tenant_isolation),
-- so Postgres combines them as (tenant_isolation) AND (workspace_isolation) —
-- this can only ever tighten what tenant_isolation already allows, never
-- loosen it. RLS is already ENABLEd+FORCEd on all twelve from the historical
-- tenant rollout, so CREATE POLICY here is itself the activation moment; no
-- separate ENABLE step. The "workspaceId IS NULL" clause is a PERMANENT
-- escape hatch on this group, not a transition artifact — see
-- schema.prisma's doc comments on each of these columns.

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY['Organization', 'Workspace', 'OrganizationMember', 'WorkspaceMember'];
  workspace_tables text[] := ARRAY[
    'Domain', 'Candidate', 'User', 'Integration', 'SystemConfiguration',
    'QuestionBank', 'Assessment', 'JobTemplate', 'CandidateList', 'EmailTemplate',
    'AuditLog', 'AnalyticsSnapshot'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
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
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;

  FOREACH t IN ARRAY workspace_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS workspace_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY workspace_isolation ON %I AS RESTRICTIVE '
      'USING ('
      '  current_setting(''app.bypass'', true) = ''on'''
      '  OR "workspaceId" = current_setting(''app.workspace_id'', true)'
      '  OR "workspaceId" IS NULL'
      ') '
      'WITH CHECK ('
      '  current_setting(''app.bypass'', true) = ''on'''
      '  OR "workspaceId" = current_setting(''app.workspace_id'', true)'
      '  OR "workspaceId" IS NULL'
      ')', t);
  END LOOP;
END
$$;
