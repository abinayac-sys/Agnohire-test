-- Consolidate platform-operator authority into the single SUPERADMIN role.
-- Any user still on PLATFORM_SUPERADMIN is reassigned to SUPERADMIN, then the
-- now-unused role (and its permission grants / tenant overrides) is removed.

DO $$
DECLARE
  platform_role_id TEXT;
  super_role_id TEXT;
BEGIN
  SELECT id INTO platform_role_id FROM "Role" WHERE name = 'PLATFORM_SUPERADMIN';
  IF platform_role_id IS NULL THEN
    RETURN;
  END IF;

  SELECT id INTO super_role_id FROM "Role" WHERE name = 'SUPERADMIN';

  UPDATE "User" SET "roleId" = super_role_id WHERE "roleId" = platform_role_id;

  DELETE FROM "RolePermission" WHERE "roleId" = platform_role_id;
  DELETE FROM "TenantRolePermission" WHERE "roleId" = platform_role_id;
  DELETE FROM "Role" WHERE id = platform_role_id;
END $$;
