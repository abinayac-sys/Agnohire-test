import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { runWithTenant, runAsPlatform } from '../config/tenantContext.js';

/**
 * Tenant scoping for PUBLIC token routes (interview / assessment / offer).
 *
 * These routes are authenticated by high-entropy per-entity tokens rather than
 * a JWT, so before this middleware they ran with NO tenant context (choke-point
 * pass-through — the pre-SaaS model). Here we derive the tenant from the token
 * entity itself and wrap the rest of the request in that context, so every
 * subsequent DB read/write in the request is scoped and stamped exactly like
 * an authenticated request of the same tenant.
 *
 * Fail-open on unresolvable tokens (context absent, service 404s as before):
 * the token IS the credential; this middleware only narrows the blast radius.
 *
 * Usage: router.param('token', tenantScopeFromToken('interview')).
 */

type TokenKind = 'interview' | 'assessment' | 'offer';

async function resolveTenantId(kind: TokenKind, token: string): Promise<string | null> {
  // Lookups run as platform: the whole point is that no tenant context exists yet.
  return runAsPlatform(async () => {
    switch (kind) {
      case 'interview': {
        const row = await prisma.interview.findFirst({
          where: { accessToken: token },
          select: { tenantId: true },
        });
        return row?.tenantId ?? null;
      }
      case 'assessment': {
        const row = await prisma.assessmentAssignment.findFirst({
          where: { accessToken: token },
          select: { tenantId: true },
        });
        return row?.tenantId ?? null;
      }
      case 'offer': {
        const offer = await prisma.offer.findFirst({
          where: { acceptanceToken: token },
          select: { tenantId: true },
        });
        if (offer) return offer.tenantId;
        // Document-portal links may carry a per-document re-upload token.
        const doc = await prisma.offerDocument.findFirst({
          where: { reToken: token },
          select: { offer: { select: { tenantId: true } } },
        });
        return doc?.offer.tenantId ?? null;
      }
    }
  });
}

export function tenantScopeFromToken(kind: TokenKind) {
  return async (
    _req: Request,
    _res: Response,
    next: NextFunction,
    token: string,
  ): Promise<void> => {
    try {
      const tenantId = typeof token === 'string' && token ? await resolveTenantId(kind, token) : null;
      if (tenantId) {
        runWithTenant(tenantId, () => next());
        return;
      }
    } catch {
      /* fall through — behave exactly as pre-SaaS (no context) */
    }
    next();
  };
}
