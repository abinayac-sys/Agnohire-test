-- Renaming the "workspace" terminology internally to "tenant" (see the
-- Tenant → Organization → Workspace architecture work): the notification
-- permission key 'workspace.notifications.view' collides with the new,
-- distinct Workspace entity being introduced under Tenant, so it becomes
-- 'tenant.notifications.view'.
--
-- Permission.key is matched by string at seed/reconciliation time, and
-- TenantRolePermission.permissionKeys stores raw permission-key strings
-- (String[], not an FK) for any tenant that has overridden a role's
-- notification permission — both must be updated in lockstep or an existing
-- override silently stops matching anything.

UPDATE "Permission"
SET "key" = 'tenant.notifications.view'
WHERE "key" = 'workspace.notifications.view';

UPDATE "TenantRolePermission"
SET "permissionKeys" = array_replace("permissionKeys", 'workspace.notifications.view', 'tenant.notifications.view')
WHERE 'workspace.notifications.view' = ANY("permissionKeys");
