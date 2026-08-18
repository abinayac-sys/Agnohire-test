import { z } from 'zod';

/** Filters for the audit-log viewer (paginated, sector-scoped server-side). */
export const auditFiltersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(1000).default(25),
  search: z.string().trim().optional(),
  action: z.string().trim().optional(),
  entity: z.string().trim().optional(),
  userId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  /**
   * Audit view split:
   *  - 'tenant' (default): actions by tenant staff (non platform-operators)
   *  - 'platform': cross-tenant platform-operator actions (SUPERADMIN only)
   */
  scope: z.enum(['tenant', 'platform']).default('tenant'),
});
export type AuditFilters = z.infer<typeof auditFiltersSchema>;

/** Same filter surface, used to drive the CSV export. */
export const auditExportSchema = auditFiltersSchema
  .omit({ page: true, limit: true })
  .extend({ limit: z.coerce.number().int().min(1).max(10000).default(5000) });
export type AuditExportInput = z.infer<typeof auditExportSchema>;
