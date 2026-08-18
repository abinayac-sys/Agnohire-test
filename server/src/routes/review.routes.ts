import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requirePermission } from '../middlewares/rbac.middleware.js';
import { PERMISSIONS } from '@agnohire/shared';
import * as review from '../controllers/review.controller.js';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission(PERMISSIONS.INTERVIEW_REVIEW), review.listReviews);
router.get('/:id', requirePermission(PERMISSIONS.INTERVIEW_REVIEW), review.getReview);
router.get('/:id/report', requirePermission(PERMISSIONS.INTERVIEW_REVIEW), review.downloadReport);
router.put('/:id/media', requirePermission(PERMISSIONS.INTERVIEW_REVIEW), review.setMedia);
router.post('/:id/transcribe', requirePermission(PERMISSIONS.INTERVIEW_REVIEW), review.transcribe);
router.post('/:id/analyze', requirePermission(PERMISSIONS.INTERVIEW_REVIEW), review.reanalyze);
router.post('/:id/review', requirePermission(PERMISSIONS.INTERVIEW_DECIDE), review.submitReview);
router.delete('/:id', requirePermission(PERMISSIONS.INTERVIEW_DECIDE), review.deleteReview);

export default router;
