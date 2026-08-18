import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requirePermission } from '../middlewares/rbac.middleware.js';
import { PERMISSIONS } from '@agnohire/shared';
import * as analytics from '../controllers/analytics.controller.js';

const router = Router();
router.use(authenticate);

// Static routes before any parameterized ones.
router.get('/dashboard', requirePermission(PERMISSIONS.ANALYTICS_VIEW), analytics.getDashboard);
router.get('/insights', requirePermission(PERMISSIONS.ANALYTICS_VIEW), analytics.getInsights);
router.get('/export', requirePermission(PERMISSIONS.ANALYTICS_VIEW), analytics.exportReport);

router.get('/snapshots', requirePermission(PERMISSIONS.ANALYTICS_VIEW), analytics.listSnapshots);
router.post('/snapshots', requirePermission(PERMISSIONS.ANALYTICS_VIEW), analytics.saveSnapshot);
router.delete('/snapshots/:id', requirePermission(PERMISSIONS.ANALYTICS_VIEW), analytics.deleteSnapshot);
router.get('/snapshots/:id/pdf', requirePermission(PERMISSIONS.ANALYTICS_VIEW), analytics.exportSnapshotPDF);

export default router;
