import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requirePermission } from '../middlewares/rbac.middleware.js';
import { PERMISSIONS } from '@agnohire/shared';
import * as pipeline from '../controllers/pipeline.controller.js';

const router = Router();
router.use(authenticate);

// Board (grouped by stage) for a single job requisition.
router.get('/board', requirePermission(PERMISSIONS.PIPELINE_VIEW), pipeline.getBoard);

// Pipeline notes on an application.
router.get('/applications/:id/notes', requirePermission(PERMISSIONS.PIPELINE_VIEW), pipeline.listNotes);
router.post('/applications/:id/notes', requirePermission(PERMISSIONS.PIPELINE_MANAGE), pipeline.addNote);
router.delete('/applications/:id/notes/:noteId', requirePermission(PERMISSIONS.PIPELINE_MANAGE), pipeline.deleteNote);

// Drag-and-drop stage move.
router.patch('/applications/:id/stage', requirePermission(PERMISSIONS.PIPELINE_MANAGE), pipeline.moveApplication);

export default router;
