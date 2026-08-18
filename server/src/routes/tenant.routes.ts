import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middlewares/auth.middleware.js';
import { requireRole } from '../middlewares/rbac.middleware.js';
import { ROLES, isValidTimezone, type CareersFeatureStatus } from '@agnohire/shared';
import { getUsage } from '../services/entitlementService.js';
import { createInvite, listInvites, acceptInvite, updateTenantTimezone } from '../services/tenantProvisioningService.js';
import { prisma } from '../config/database.js';
import { ok } from '../utils/response.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';

/** Tenant self-service: usage meters vs plan limits (client UX gating). */
const router = Router();

router.get('/usage', authenticate, async (req, res, next) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) throw new NotFoundError('No tenant on session');
    return ok(res, await getUsage(tenantId));
  } catch (err) {
    next(err);
  }
});

/**
 * Read-only, always-fresh check of superadmin-controlled per-tenant feature
 * grants (currently just the careers page). Deliberately NOT baked into the
 * JWT/AuthUser — those are cached client-side for the token's lifetime, so a
 * superadmin's grant/revoke wouldn't take effect until refresh/re-login.
 * `Tenant` isn't a tenant-scoped RLS model, so this reads directly — no
 * runAsPlatform needed, and a tenant can only ever see its own row.
 */
router.get('/features', authenticate, async (req, res, next) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) throw new NotFoundError('No tenant on session');
    const tenant = await prisma.tenant.findFirst({ where: { id: tenantId }, select: { careersPageEnabled: true } });
    const status: CareersFeatureStatus = { careersPageEnabled: tenant?.careersPageEnabled ?? false };
    return ok(res, status);
  } catch (err) {
    next(err);
  }
});

const manage = [authenticate, requireRole(ROLES.ADMIN, ROLES.TENANT_OWNER, ROLES.SUPERADMIN)] as const;

// ── Timezone ─────────────────────────────────────────────────────────────────
const timezoneSchema = z.object({ timezone: z.string().min(1) });
router.patch('/timezone', ...manage, async (req, res, next) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) throw new NotFoundError('No tenant on session');
    const { timezone } = timezoneSchema.parse(req.body);
    if (!isValidTimezone(timezone)) throw new BadRequestError('Unknown timezone');
    return ok(res, await updateTenantTimezone(tenantId, timezone, req));
  } catch (err) {
    next(err);
  }
});

// ── Invites ──────────────────────────────────────────────────────────────────
const inviteSchema = z.object({ email: z.string().email(), role: z.string().min(2) });
router.post('/invites', ...manage, async (req, res, next) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) throw new NotFoundError('No tenant on session');
    const { email, role } = inviteSchema.parse(req.body);
    return ok(res, await createInvite(tenantId, email, role), 201);
  } catch (err) {
    next(err);
  }
});

router.get('/invites', ...manage, async (req, res, next) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) throw new NotFoundError('No tenant on session');
    return ok(res, await listInvites(tenantId));
  } catch (err) {
    next(err);
  }
});

// Public: invitee sets their name + password using the emailed token.
const acceptSchema = z.object({
  token: z.string().min(16),
  fullName: z.string().min(2).max(120),
  password: z.string().min(8).max(128),
});
router.post('/invites/accept', async (req, res, next) => {
  try {
    const { token, fullName, password } = acceptSchema.parse(req.body);
    return ok(res, await acceptInvite(token, fullName, password));
  } catch (err) {
    next(err);
  }
});

export default router;
