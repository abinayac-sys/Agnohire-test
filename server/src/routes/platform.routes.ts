import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/rbac.middleware.js';
import { ROLES } from '@agnohire/shared';
import * as platform from '../controllers/platform.controller.js';

/**
 * Platform-superadmin console: Plan catalogue CRUD + Tenant admin.
 * Gated to SUPERADMIN. These are cross-tenant operations — the services opt
 * into runAsPlatform explicitly.
 */
const router = Router();
router.use(authenticate, requireRole(ROLES.SUPERADMIN));

// Plans (Billing & Plans management)
router.get('/plans', platform.listPlans);
router.post('/plans', platform.createPlan);
router.patch('/plans/:id', platform.updatePlan);

// Tenants (Tenant Accounts + Tenant Create)
router.get('/tenants', platform.listTenants);
router.post('/tenants', platform.createTenant);
router.get('/tenants/:id', platform.getTenant);
router.patch('/tenants/:id', platform.updateTenant);
router.post('/tenants/:id/reset-owner-password', platform.resetOwnerPassword);
router.post('/tenants/:id/login', platform.tenantLogin);
router.post('/tenants/:id/approve', platform.approveTenant);
router.post('/tenants/:id/reject', platform.rejectTenant);
router.patch('/tenants/:id/status', platform.setTenantStatus);
router.patch('/tenants/:id/careers-feature', platform.setCareersFeature);
router.delete('/tenants/:id', platform.deleteTenant);

// Maintenance windows (Scheduled Maintenance Notices)
router.get('/maintenance', platform.listMaintenanceWindows);
router.post('/maintenance', platform.createMaintenanceWindow);
router.delete('/maintenance/:id', platform.cancelMaintenanceWindow);

// AI token usage monitor (platform-wide + per-tenant, for usage-based billing)
router.get('/ai-usage/summary', platform.getAiUsageSummary);
router.get('/ai-usage/trend', platform.getAiUsageTrend);
router.get('/ai-usage/by-tenant', platform.getAiUsageByTenant);
router.get('/ai-usage/by-feature', platform.getAiUsageByFeature);
router.get('/ai-usage/by-model', platform.getAiUsageByModel);
router.get('/ai-usage/tenants/:id', platform.getTenantAiUsage);
router.get('/ai-usage/export/pdf', platform.exportAiUsagePdf);

// Candidate storage monitor (platform-wide + per-tenant)
router.get('/storage/summary', platform.getStorageSummary);
router.get('/storage/by-tenant', platform.getStorageByTenant);
router.get('/storage/tenants/:id', platform.getTenantStorageUsage);
router.get('/storage/export/pdf', platform.exportStorageUsagePdf);

export default router;
