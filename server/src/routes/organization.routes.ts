import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requirePermission } from '../middlewares/rbac.middleware.js';
import { PERMISSIONS } from '@agnohire/shared';
import * as org from '../controllers/organization.controller.js';

/**
 * Tenant self-service Organization management — NOT the SUPERADMIN-only
 * cross-tenant console (see routes/platform.routes.ts). Every handler here
 * operates within the caller's own tenant via the AsyncLocalStorage scope
 * context (see config/tenantContext.ts) — no tenantId is ever accepted from
 * the client.
 */
const router = Router();
router.use(authenticate);

// CRUD-granular — a role can be given e.g. org.view without also being able
// to create/edit/delete (see shared/src/constants/permissions.ts). Member
// management counts as "editing" the organization, not a separate resource.
const VIEW = requirePermission(PERMISSIONS.ORG_VIEW);
const CREATE = requirePermission(PERMISSIONS.ORG_CREATE);
const EDIT = requirePermission(PERMISSIONS.ORG_EDIT);
const DELETE = requirePermission(PERMISSIONS.ORG_DELETE);

router.get('/', VIEW, org.listOrganizations);
router.post('/', CREATE, org.createOrganization);
router.get('/:id', VIEW, org.getOrganization);
router.patch('/:id', EDIT, org.updateOrganization);
router.delete('/:id', DELETE, org.deleteOrganization);

router.get('/:id/members', VIEW, org.listOrganizationMembers);
router.post('/:id/members', EDIT, org.addOrganizationMember);
router.patch('/:id/members/:userId', EDIT, org.updateOrganizationMemberRole);
router.delete('/:id/members/:userId', EDIT, org.removeOrganizationMember);

export default router;
