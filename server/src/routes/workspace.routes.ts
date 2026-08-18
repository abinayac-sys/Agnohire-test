import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requirePermission } from '../middlewares/rbac.middleware.js';
import { PERMISSIONS } from '@agnohire/shared';
import * as ws from '../controllers/workspace.controller.js';

/**
 * Tenant self-service Workspace management — the same tenant-scoped pattern
 * as routes/organization.routes.ts. Workspace-credential management
 * (per-workspace Integration/SystemConfiguration) is intentionally NOT here
 * yet — it depends on configService's workspace-tier resolution, which is
 * separate follow-up work; these routes cover Workspace CRUD + membership
 * only.
 */
const router = Router();
router.use(authenticate);

// CRUD-granular — see organization.routes.ts's identical rationale. A role
// can hold workspace.view without also being able to create/edit/delete.
const VIEW = requirePermission(PERMISSIONS.WORKSPACE_VIEW);
const CREATE = requirePermission(PERMISSIONS.WORKSPACE_CREATE);
const EDIT = requirePermission(PERMISSIONS.WORKSPACE_EDIT);
const DELETE = requirePermission(PERMISSIONS.WORKSPACE_DELETE);

router.get('/', VIEW, ws.listWorkspaces);
router.post('/', CREATE, ws.createWorkspace);
router.get('/:id', VIEW, ws.getWorkspace);
router.patch('/:id', EDIT, ws.updateWorkspace);
router.delete('/:id', DELETE, ws.deleteWorkspace);

router.get('/:id/members', VIEW, ws.listWorkspaceMembers);
router.post('/:id/members', EDIT, ws.addWorkspaceMember);
router.patch('/:id/members/:userId', EDIT, ws.updateWorkspaceMemberRole);
router.delete('/:id/members/:userId', EDIT, ws.removeWorkspaceMember);

export default router;
