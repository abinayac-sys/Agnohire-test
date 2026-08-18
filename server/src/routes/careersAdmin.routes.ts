import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requirePermission } from '../middlewares/rbac.middleware.js';
import { PERMISSIONS } from '@agnohire/shared';
import * as careersAdmin from '../controllers/careersAdmin.controller.js';

/**
 * Staff-authenticated admin surface backing the "Website Embed" careers page
 * — per-job public salary visibility. Separate from job.routes.ts (see
 * careersAdminService.ts's doc comment for why).
 */
const router = Router();

router.use(authenticate);

router.get('/jobs', requirePermission(PERMISSIONS.JOB_EDIT), careersAdmin.listJobs);
router.patch('/jobs/:jobId/salary-visibility', requirePermission(PERMISSIONS.JOB_EDIT), careersAdmin.setSalaryVisibility);

export default router;
