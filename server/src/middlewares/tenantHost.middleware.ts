import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { runAsPlatform } from '../config/tenantContext.js';
import { env } from '../config/env.js';

/**
 * Subdomain → tenant resolution (isolation-safe, infra-deferred).
 *
 * When APP_ROOT_DOMAIN is configured, a request to `<slug>.<root>` has its slug
 * parsed and resolved to a tenant id, attached as `req.hostTenantId`. The apex
 * host, `www`, `app`, `api`, and any non-matching host (localhost, IPs) pass
 * through with `hostTenantId = null` — existing URLs behave exactly as before.
 *
 * This middleware NEVER grants access on its own. The authoritative isolation
 * check lives in auth.middleware: an authenticated principal's JWT tenant must
 * match the host tenant, so Host/URL manipulation cannot cross tenants. For
 * unauthenticated pages (login), the slug is only advisory (branding).
 *
 * INFRA (outside this repo): wildcard DNS `*.<root>` + wildcard TLS cert +
 * client allowedHosts/CORS for the wildcard. Until those exist, this resolves
 * nothing in local/dev (localhost has no root-domain suffix) and is inert.
 */

const RESERVED = new Set(['www', 'app', 'api', 'admin', 'static', 'assets']);

/** Small TTL cache so we don't hit the DB on every request for the same host. */
const cache = new Map<string, { tenantId: string | null; expires: number }>();
const TTL_MS = 60_000;

function parseSlug(hostname: string): string | null {
  const root = env.rootDomain.toLowerCase();
  if (!root) return null;
  const host = hostname.toLowerCase();
  if (host === root || !host.endsWith(`.${root}`)) return null;
  const sub = host.slice(0, -(root.length + 1)); // strip ".<root>"
  if (!sub || sub.includes('.')) return null; // only single-label subdomains
  if (RESERVED.has(sub)) return null;
  return sub;
}

async function resolveSlug(slug: string): Promise<string | null> {
  const hit = cache.get(slug);
  if (hit && hit.expires > Date.now()) return hit.tenantId;
  const tenant = await runAsPlatform(async () =>
    prisma.tenant.findUnique({ where: { slug }, select: { id: true, deletedAt: true } }),
  );
  const tenantId = tenant && !tenant.deletedAt ? tenant.id : null;
  cache.set(slug, { tenantId, expires: Date.now() + TTL_MS });
  return tenantId;
}

export async function resolveTenantHost(req: Request, _res: Response, next: NextFunction): Promise<void> {
  req.hostTenantId = null;
  try {
    const slug = parseSlug(req.hostname);
    if (slug) {
      req.tenantSlug = slug;
      req.hostTenantId = await resolveSlug(slug);
    }
  } catch {
    // Resolution failure must never block a request — fall back to JWT-only.
    req.hostTenantId = null;
  }
  next();
}
