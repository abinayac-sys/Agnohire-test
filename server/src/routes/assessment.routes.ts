import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requirePermission } from '../middlewares/rbac.middleware.js';
import { PERMISSIONS } from '@agnohire/shared';
import * as assessment from '../controllers/assessment.controller.js';

const router = Router();
router.use(authenticate);

// Static routes before parameterized ones.
router.get('/assignments', requirePermission(PERMISSIONS.ASSESSMENT_VIEW), assessment.listAssignments);
router.post('/assignments/bulk-send-result', requirePermission(PERMISSIONS.ASSESSMENT_VIEW), assessment.bulkSendResultEmail);
router.get('/assignments/:id', requirePermission(PERMISSIONS.ASSESSMENT_VIEW), assessment.getAssignment);
router.get('/assignments/:id/snapshots/:shotId', requirePermission(PERMISSIONS.ASSESSMENT_VIEW), assessment.getAssignmentProctorShot);
router.post('/assignments/:id/cancel', requirePermission(PERMISSIONS.ASSESSMENT_ASSIGN), assessment.cancelAssignment);
router.post('/assignments/:id/send-result', requirePermission(PERMISSIONS.ASSESSMENT_VIEW), assessment.sendResultEmail);

router.get('/', requirePermission(PERMISSIONS.ASSESSMENT_VIEW), assessment.listAssessments);
router.post('/', requirePermission(PERMISSIONS.ASSESSMENT_MANAGE), assessment.createAssessment);
router.get('/:id', requirePermission(PERMISSIONS.ASSESSMENT_VIEW), assessment.getAssessment);
router.patch('/:id', requirePermission(PERMISSIONS.ASSESSMENT_MANAGE), assessment.updateAssessment);
router.delete('/:id', requirePermission(PERMISSIONS.ASSESSMENT_MANAGE), assessment.deleteAssessment);
router.post('/:id/assign', requirePermission(PERMISSIONS.ASSESSMENT_ASSIGN), assessment.assignAssessment);

export default router;
