import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requirePermission } from '../middlewares/rbac.middleware.js';
import { PERMISSIONS } from '@agnohire/shared';
import * as notification from '../controllers/notification.controller.js';

const router = Router();

router.use(authenticate);

// A user's own notifications — no extra permission beyond being authenticated.
router.get('/', notification.list);
router.get('/unread-count', notification.unreadCount);
router.post('/read-all', notification.markAllRead);
router.delete('/clear-all', notification.clearAll);

// Tenant notifications — requires tenant.notifications.view permission
router.get('/tenant', requirePermission(PERMISSIONS.TENANT_NOTIFICATIONS_VIEW), notification.listTenant);
router.get('/tenant/unread-count', requirePermission(PERMISSIONS.TENANT_NOTIFICATIONS_VIEW), notification.tenantUnreadCount);
router.post('/tenant/read-all', requirePermission(PERMISSIONS.TENANT_NOTIFICATIONS_VIEW), notification.markTenantAllRead);
router.delete('/tenant/clear-all', requirePermission(PERMISSIONS.TENANT_NOTIFICATIONS_VIEW), notification.clearTenantAll);

router.post('/:id/read', notification.markRead);

export default router;
