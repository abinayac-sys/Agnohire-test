import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { authenticate, optionalAuth, restoreTenantContext } from '../middlewares/auth.middleware.js';
import { requirePermission } from '../middlewares/rbac.middleware.js';
import { PERMISSIONS } from '@agnohire/shared';
import * as system from '../controllers/system.controller.js';

const router = Router();

// Public bootstrap (theme + branding) — needed before login.
router.get('/bootstrap', optionalAuth, restoreTenantContext, asyncHandler(system.bootstrap));
router.get('/themes', asyncHandler(system.listThemes));
// Public branding image (company logo) — rendered via <img> on the login screen
// before any auth, so it must be reachable without a token.
router.get('/branding/:key', optionalAuth, restoreTenantContext, asyncHandler(system.brandingImage));

// Active/upcoming maintenance window — any authenticated user, so the client
// banner can hydrate on load (in addition to the live socket push).
router.get('/maintenance-active', authenticate, asyncHandler(system.maintenanceActive));

// Admin-only configuration management.
router.use(authenticate);

router.get(
  '/config',
  requirePermission(PERMISSIONS.SYSTEM_CONFIG_MANAGE),
  asyncHandler(system.listConfig),
);
router.put(
  '/config/:key',
  requirePermission(PERMISSIONS.SYSTEM_CONFIG_MANAGE),
  asyncHandler(system.updateConfig),
);
// Read-only DB connection capacity (Postgres/PgBouncer/app pool). SUPERADMIN-only
// enforced inside the controller, same pattern as the global-setting checks above.
router.get(
  '/connection-info',
  requirePermission(PERMISSIONS.SYSTEM_CONFIG_MANAGE),
  asyncHandler(system.connectionInfo),
);
router.post(
  '/email/test',
  requirePermission(PERMISSIONS.SYSTEM_CONFIG_MANAGE),
  asyncHandler(system.testEmail),
);
router.post(
  '/calendar/test',
  requirePermission(PERMISSIONS.SYSTEM_CONFIG_MANAGE),
  asyncHandler(system.testCalendar),
);
router.put(
  '/themes/:name',
  requirePermission(PERMISSIONS.SYSTEM_THEME_MANAGE),
  asyncHandler(system.updateTheme),
);
router.put(
  '/active-theme',
  requirePermission(PERMISSIONS.SYSTEM_THEME_MANAGE),
  asyncHandler(system.setActiveTheme),
);

export default router;
