import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requirePermission } from '../middlewares/rbac.middleware.js';
import { PERMISSIONS } from '@agnohire/shared';
import * as schedule from '../controllers/schedule.controller.js';

const router = Router();
router.use(authenticate);

// Static routes before parameterized ones.
router.get('/availability', requirePermission(PERMISSIONS.INTERVIEW_SCHEDULE), schedule.getAvailability);
router.get('/candidates/passed', requirePermission(PERMISSIONS.INTERVIEW_SCHEDULE), schedule.listPassedCandidates);
router.get('/calendar-status', requirePermission(PERMISSIONS.INTERVIEW_SCHEDULE), schedule.getCalendarStatus);
router.get('/export/excel', requirePermission(PERMISSIONS.INTERVIEW_VIEW), schedule.exportSchedules);

router.get('/', requirePermission(PERMISSIONS.INTERVIEW_VIEW), schedule.listSchedules);
router.post('/', requirePermission(PERMISSIONS.INTERVIEW_SCHEDULE), schedule.createSchedule);
router.get('/:id', requirePermission(PERMISSIONS.INTERVIEW_VIEW), schedule.getSchedule);
router.patch('/:id', requirePermission(PERMISSIONS.INTERVIEW_SCHEDULE), schedule.rescheduleInterview);
router.post('/:id/cancel', requirePermission(PERMISSIONS.INTERVIEW_SCHEDULE), schedule.cancelSchedule);
router.post('/:id/sync-calendar', requirePermission(PERMISSIONS.INTERVIEW_SCHEDULE), schedule.syncSchedule);
router.post('/:id/generate-meet', requirePermission(PERMISSIONS.INTERVIEW_SCHEDULE), schedule.generateMeet);
router.post('/:id/complete', requirePermission(PERMISSIONS.INTERVIEW_SCHEDULE), schedule.completeSchedule);
router.post('/:id/send-invite', requirePermission(PERMISSIONS.INTERVIEW_SCHEDULE), schedule.sendScheduleInvite);
router.delete('/:id', requirePermission(PERMISSIONS.INTERVIEW_SCHEDULE), schedule.deleteSchedule);

export default router;
