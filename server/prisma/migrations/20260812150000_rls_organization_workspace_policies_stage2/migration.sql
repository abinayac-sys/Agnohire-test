-- RLS for Organization/Workspace, stage 2 — Sector and JobRequisition only.
--
-- Deployed LAST, after stage 1 has run without incident: these are the two
-- tables where organizationId/workspaceId are NOT NULL for every row (see
-- 20260812094000_organization_workspace_tighten_not_null), so the
-- "workspaceId IS NULL" escape hatch never fires here — correctness depends
-- entirely on app.workspace_id being set on every request that touches them,
-- which server/src/middlewares/auth.middleware.ts has been doing since the
-- application-layer rollout (see config/tenantContext.ts's ScopeContext).
--
-- Same RESTRICTIVE-policy mechanics as stage 1: ANDs with the existing
-- PERMISSIVE tenant_isolation policy, which is already ENABLEd+FORCEd on
-- both tables from the historical tenant rollout, so CREATE POLICY here is
-- itself the activation moment.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY['Sector', 'JobRequisition'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
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
