import { prisma } from '../config/database.js';

/** Resolves a tenant's IANA timezone, defaulting to UTC if unset/unknown/no tenant. */
export async function resolveTenantTimezone(tenantId: string | null | undefined): Promise<string> {
  if (!tenantId) return 'UTC';
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
  return tenant?.timezone ?? 'UTC';
}
