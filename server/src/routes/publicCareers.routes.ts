import { Router } from 'express';
import * as pub from '../controllers/publicCareers.controller.js';
import { resolveCareersTenant } from '../middlewares/publicCareersScope.middleware.js';
import { resumeUpload } from '../utils/storage.js';

/**
 * PUBLIC, tenant-slug-scoped careers page routes — intentionally NO
 * `authenticate`. Mounted at /public/careers (see routes/index.ts). Tenant
 * scope is resolved from :tenantSlug by resolveCareersTenant, which hard-404s
 * on an unresolved slug rather than falling through with no context (see the
 * middleware's doc comment for why this differs from the token-route pattern).
 */
const router = Router();

router.param('tenantSlug', resolveCareersTenant);

router.get('/:tenantSlug/jobs', pub.listJobs);
router.get('/:tenantSlug/jobs/:jobId', pub.getJob);
router.post('/:tenantSlug/jobs/:jobId/apply', resumeUpload.single('resume'), pub.apply);

export default router;
