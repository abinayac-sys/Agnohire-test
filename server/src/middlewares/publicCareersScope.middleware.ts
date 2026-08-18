import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { runWithTenant, runAsPlatform } from '../config/tenantContext.js';
import { configService } from '../services/configService.js';
import { NotFoundError } from '../utils/errors.js';
import { CONFIG_KEYS } from '@agnohire/shared';

/**
 * Tenant scoping for the PUBLIC careers page (job listing, job detail, apply).
 *
 * Unlike `tenantScopeFromToken` (interview/assessment/offer), this does NOT
 * fail open to "no context" when the slug doesn't resolve. Those token routes
 * are safe with no context because the token itself is the sole selector in
 * every downstream query. Here there is no such anchor — with no tenant
 * context, `prisma.jobRequisition.findMany({ where: { status: 'OPEN' } })`
 * would return every tenant's open jobs. So an unresolved slug must hard-404
 * before reaching any route handler.
 *
 * Two independent gates must both pass, checked in this order:
 *  1. `Tenant.careersPageEnabled` — the platform-superadmin-only feature
 *     GRANT. Defaults false; a tenant never sets this itself (no endpoint
 *     lets tenant staff touch it — see tenantAdminService.ts). Checked
 *     before entering any tenant context at all, so an ungranted tenant
 *     never even gets a runWithTenant scope established for this request.
 *  2. `careers.enabled` (System Config, category CAREERS) — the tenant's own
 *     on/off switch for a page it HAS been granted, self-service via the
 *     Integrations UI.
 * Either being false 404s every /public/careers/* route and, with it, the
 * hosted page and any iframe embed on the tenant's own site.
 *
 * Usage: router.param('tenantSlug', resolveCareersTenant).
 */
export async function resolveCareersTenant(
  req: Request,
  _res: Response,
  next: NextFunction,
  tenantSlug: string,
): Promise<void> {
  try {
    // Lookup runs as platform: no tenant context exists yet at this point.
    const tenant = await runAsPlatform(() =>
      prisma.tenant.findFirst({
        where: { slug: tenantSlug, status: 'ACTIVE', approvalStatus: 'APPROVED' },
        select: { id: true, name: true, slug: true, careersPageEnabled: true },
      }),
    );
    if (!tenant || !tenant.careersPageEnabled) {
      next(new NotFoundError('Careers page not found'));
      return;
    }
    req.careersTenant = { id: tenant.id, name: tenant.name, slug: tenant.slug };
    await runWithTenant(tenant.id, async () => {
      const enabled = await configService.getBool(CONFIG_KEYS.CAREERS_ENABLED, true);
      if (!enabled) {
        next(new NotFoundError('Careers page not found'));
        return;
      }
      next();
    });
  } catch (err) {
    next(err);
  }
}
