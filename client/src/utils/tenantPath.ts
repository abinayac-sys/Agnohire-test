/** Synthetic slug for a platform-superadmin's own (non-tenant) session. */
export const PLATFORM_TENANT_SLUG = 'platform';

/** Prefixes an absolute app path with the tenant slug, e.g. ('/admin', 'agnoshin') -> '/agnoshin/admin'. */
export function withTenant(path: string, tenantSlug: string | null): string {
  return `/${tenantSlug ?? PLATFORM_TENANT_SLUG}${path}`;
}
