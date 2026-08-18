import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requirePermission } from '../middlewares/rbac.middleware.js';
import { PERMISSIONS } from '@agnohire/shared';
import { runAI } from '../controllers/ai.controller.js';
import { saveHistory, getHistories, getHistory, deleteHistory } from '../controllers/aiHistory.controller.js';

const router = Router();

router.use(authenticate);

// Individual tool calls are still permission-checked per-tool by
// PermissionChecker; this gate is the front door to the agent itself.
router.post('/run', requirePermission(PERMISSIONS.AI_ASSISTANT_USE), asyncHandler(runAI));

router.post('/history', asyncHandler(saveHistory));
router.get('/history', asyncHandler(getHistories));
router.get('/history/:id', asyncHandler(getHistory));
router.delete('/history/:id', asyncHandler(deleteHistory));

export default router;
