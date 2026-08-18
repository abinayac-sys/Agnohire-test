import type { NextFunction, Request, Response } from 'express';
import { assertActiveSubscription } from '../services/entitlementService.js';

/**
 * Global read-only gate for delinquent tenants. Most of this app already
 * blocks specific quota-gated actions via assertWithinLimit/
 * assertActiveSubscription (entitlementService.ts) — but a tenant whose
 * subscription has lapsed (PAST_DUE/HALTED/CANCELLED, or a TRIALING period
 * that ended) could otherwise still mutate anything NOT explicitly
 * quota-gated (e.g. editing a candidate's name). This closes that gap by
 * running the same check on every non-GET request.
 *
 * Deliberately delegates entirely to assertActiveSubscription rather than
 * keeping its own status list — there is exactly one place that decides
 * what "active" means (including the TRIALING → EXPIRED self-heal), and
 * this middleware just applies it more broadly.
 */
export async function enforceSubscription(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (req.method === 'GET') return next();
  // Billing routes themselves must stay reachable so a delinquent tenant can
  // actually pay/upgrade/cancel.
  if (req.originalUrl.startsWith('/api/billing')) return next();
  if (!req.user?.tenantId) return next();

  try {
    await assertActiveSubscription(req.user.tenantId);
    next();
  } catch (err) {
    next(err);
  }
}
