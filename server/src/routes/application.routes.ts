import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requirePermission } from '../middlewares/rbac.middleware.js';
import { PERMISSIONS } from '@agnohire/shared';
import * as candidate from '../controllers/candidate.controller.js';

const router = Router();

router.use(authenticate);

// ─── APPLICATIONS / SCREENING ────────────────────────────────────────────
router.get('/', requirePermission(PERMISSIONS.CANDIDATE_VIEW), candidate.listApplications);
router.post('/', requirePermission(PERMISSIONS.CANDIDATE_EDIT), candidate.createApplication);
router.patch('/:id', requirePermission(PERMISSIONS.CANDIDATE_EDIT), candidate.updateApplication);
router.post('/:id/score', requirePermission(PERMISSIONS.CANDIDATE_EDIT), candidate.scoreApplication);
router.delete('/:id', requirePermission(PERMISSIONS.CANDIDATE_EDIT), candidate.deleteApplication);

export default router;
