import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requirePermission } from '../middlewares/rbac.middleware.js';
import { PERMISSIONS } from '@agnohire/shared';
import * as interview from '../controllers/interview.controller.js';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission(PERMISSIONS.INTERVIEW_VIEW), interview.listInterviews);
router.post('/', requirePermission(PERMISSIONS.INTERVIEW_SCHEDULE), interview.createInterview);
// Bulk result emails — placed before '/:id' so the literal path isn't captured.
router.get('/results/candidates', requirePermission(PERMISSIONS.INTERVIEW_DECIDE), interview.listResultCandidates);
router.post('/results/send-bulk', requirePermission(PERMISSIONS.INTERVIEW_DECIDE), interview.sendBulkResults);
router.post('/invites/send-bulk', requirePermission(PERMISSIONS.INTERVIEW_SCHEDULE), interview.sendBulkInvites);
router.get('/reports/bulk', requirePermission(PERMISSIONS.INTERVIEW_VIEW), interview.exportBulkReports);
router.get('/:id', requirePermission(PERMISSIONS.INTERVIEW_VIEW), interview.getInterview);
router.get('/:id/report', requirePermission(PERMISSIONS.INTERVIEW_VIEW), interview.exportReport);
router.get('/:id/snapshots/:shotId', requirePermission(PERMISSIONS.INTERVIEW_VIEW), interview.getProctorShot);
router.post('/:id/cancel', requirePermission(PERMISSIONS.INTERVIEW_SCHEDULE), interview.cancelInterview);
router.post('/:id/decision', requirePermission(PERMISSIONS.INTERVIEW_DECIDE), interview.decideInterview);
router.post('/:id/submit-decision', requirePermission(PERMISSIONS.INTERVIEW_DECIDE), interview.submitDecision);
router.post('/:id/send-invite', requirePermission(PERMISSIONS.INTERVIEW_SCHEDULE), interview.sendInvite);
router.post('/:id/send-result', requirePermission(PERMISSIONS.INTERVIEW_DECIDE), interview.sendResult);
router.delete('/:id', requirePermission(PERMISSIONS.INTERVIEW_SCHEDULE), interview.deleteInterview);

export default router;
