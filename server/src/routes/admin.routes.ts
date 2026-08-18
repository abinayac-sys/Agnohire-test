import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requirePermission, requireUserManage } from '../middlewares/rbac.middleware.js';
import { PERMISSIONS } from '@agnohire/shared';
import * as admin from '../controllers/admin.controller.js';

const router = Router();
router.use(authenticate);

// Passes for the global user.manage holder (Admin/Tenant Owner/Superadmin)
// OR a narrower-role user granted WorkspaceMember.canManageUsers for their
// current workspace — see rbac.middleware.ts's requireUserManage doc comment.
const USER = requireUserManage();
const ROLE = requirePermission(PERMISSIONS.ROLE_MANAGE);
const SECTOR = requirePermission(PERMISSIONS.SECTOR_MANAGE);
const INTEGRATION = requirePermission(PERMISSIONS.INTEGRATION_MANAGE);
const CONFIG = requirePermission(PERMISSIONS.SYSTEM_CONFIG_MANAGE);

// Users
router.get('/users', USER, admin.listUsers);
router.post('/users', USER, admin.createUser);
router.patch('/users/:id', USER, admin.updateUser);
router.delete('/users/:id', USER, admin.deleteUser);
router.post('/users/:id/reset-password', USER, admin.resetUserPassword);
router.post('/messages', USER, admin.sendUserMessage);
router.get('/email-logs', CONFIG, admin.listEmailLogs);

// Roles & permissions
router.get('/permissions', ROLE, admin.listPermissions);
router.get('/roles', ROLE, admin.listRoles);
router.put('/roles/:id/permissions', ROLE, admin.setRolePermissions);

// Sectors & domains
router.get('/sectors', SECTOR, admin.listSectors);
router.post('/sectors', SECTOR, admin.createSector);
router.patch('/sectors/:id', SECTOR, admin.updateSector);
router.delete('/sectors/:id', SECTOR, admin.deleteSector);
router.get('/domains', SECTOR, admin.listDomains);
router.post('/domains', SECTOR, admin.createDomain);
router.patch('/domains/:id', SECTOR, admin.updateDomain);
router.delete('/domains/:id', SECTOR, admin.deleteDomain);

// Integrations
router.get('/integrations', INTEGRATION, admin.listIntegrations);
router.post('/integrations', INTEGRATION, admin.createIntegration);
router.post('/integrations/:provider/test', INTEGRATION, admin.testIntegrationConnection);
router.patch('/integrations/:id', INTEGRATION, admin.updateIntegration);
router.delete('/integrations/:id', INTEGRATION, admin.deleteIntegration);

// Email templates (managed alongside system configuration)
router.get('/email-templates', CONFIG, admin.listEmailTemplates);
router.post('/email-templates', CONFIG, admin.createEmailTemplate);
router.post('/email-templates/preview', CONFIG, admin.previewEmailTemplate);
router.post('/email-templates/apply-logo', CONFIG, admin.applyLogoToAll);
router.patch('/email-templates/:id', CONFIG, admin.updateEmailTemplate);
router.delete('/email-templates/:id', CONFIG, admin.deleteEmailTemplate);

export default router;
