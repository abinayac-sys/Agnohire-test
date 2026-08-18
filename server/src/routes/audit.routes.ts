import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requirePermission } from '../middlewares/rbac.middleware.js';
import { PERMISSIONS } from '@agnohire/shared';
import * as audit from '../controllers/audit.controller.js';

const router = Router();

router.use(authenticate, requirePermission(PERMISSIONS.AUDIT_LOG_VIEW));

router.get('/', audit.listAuditLogs);
router.get('/facets', audit.getAuditFacets);
router.get('/export', audit.exportAuditLogs);
router.post('/delete-bulk', audit.deleteAuditLogsBulk);
router.get('/:id', audit.getAuditLog);
router.delete('/:id', audit.deleteAuditLog);

export default router;
