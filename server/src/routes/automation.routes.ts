import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/rbac.middleware.js';
import { ROLES } from '@agnohire/shared';
import * as automationController from '../controllers/automation.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// Workflow automation configures tenant-wide behavior triggered off any
// event (candidate/interview/etc.) — an admin-level surface, not general
// staff access.
router.use(authenticate, requireRole(ROLES.ADMIN, ROLES.TENANT_OWNER));

router.post('/workflows', asyncHandler(automationController.createWorkflow));
router.get('/workflows', asyncHandler(automationController.getWorkflows));
router.get('/logs', asyncHandler(automationController.getAutomationLogs));

export default router;
