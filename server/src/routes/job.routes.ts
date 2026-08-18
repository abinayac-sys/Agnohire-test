import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requirePermission } from '../middlewares/rbac.middleware.js';
import { PERMISSIONS } from '@agnohire/shared';
import * as job from '../controllers/job.controller.js';

const router = Router();

// All job routes require authentication.
router.use(authenticate);

// ─── Static routes first (must be before /:id to avoid capture) ───────────
router.get('/stats', requirePermission(PERMISSIONS.JOB_VIEW), job.getJobStats);
router.get('/approvers', requirePermission(PERMISSIONS.JOB_CREATE), job.listApprovers);
router.post('/generate-jd', requirePermission(PERMISSIONS.JOB_CREATE), job.generateJd);
router.post('/ai/generate-complete', requirePermission(PERMISSIONS.JOB_CREATE), job.generateCompleteRequisition);
router.post('/ai/copilot', requirePermission(PERMISSIONS.JOB_CREATE), job.jobCopilot);
router.post('/ai/review', requirePermission(PERMISSIONS.JOB_CREATE), job.reviewRequisition);
// ─── TEMPLATES (before /:id) ───────────────────────────────────────────────
router.get('/templates', requirePermission(PERMISSIONS.JOB_VIEW), job.listTemplates);
router.post('/templates', requirePermission(PERMISSIONS.JOB_CREATE), job.createTemplate);
router.get('/templates/:id', requirePermission(PERMISSIONS.JOB_VIEW), job.getTemplate);
router.patch('/templates/:id', requirePermission(PERMISSIONS.JOB_EDIT), job.updateTemplate);
router.delete('/templates/:id', requirePermission(PERMISSIONS.JOB_DELETE), job.deleteTemplate);

// ─── JOB CRUD ─────────────────────────────────────────────────────────────
router.get('/', requirePermission(PERMISSIONS.JOB_VIEW), job.listJobs);
router.post('/', requirePermission(PERMISSIONS.JOB_CREATE), job.createJob);
router.get('/:id', requirePermission(PERMISSIONS.JOB_VIEW), job.getJob);
router.get('/:id/pdf', requirePermission(PERMISSIONS.JOB_VIEW), job.downloadJobPdf);
router.patch('/:id', requirePermission(PERMISSIONS.JOB_EDIT), job.updateJob);
router.delete('/:id', requirePermission(PERMISSIONS.JOB_DELETE), job.deleteJob);

// ─── WORKFLOW ACTIONS ─────────────────────────────────────────────────────
router.post('/:id/submit', requirePermission(PERMISSIONS.JOB_CREATE), job.submitJob);
router.post('/:id/approve', requirePermission(PERMISSIONS.JOB_APPROVE), job.approveJob);
router.post('/:id/reject', requirePermission(PERMISSIONS.JOB_APPROVE), job.rejectJob);
router.post('/:id/close', requirePermission(PERMISSIONS.JOB_EDIT), job.closeJob);
router.post('/:id/reopen', requirePermission(PERMISSIONS.JOB_EDIT), job.reopenJob);

export default router;
