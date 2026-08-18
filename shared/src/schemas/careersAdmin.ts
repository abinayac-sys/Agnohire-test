import { z } from 'zod';

// ─── STAFF-AUTHENTICATED CAREERS-PAGE ADMIN (per-job salary visibility) ─────

export const updateJobSalaryVisibilitySchema = z.object({
  showSalaryPublicly: z.boolean(),
});
export type UpdateJobSalaryVisibilityInput = z.infer<typeof updateJobSalaryVisibilitySchema>;

// ─── PLATFORM-SUPERADMIN: per-tenant careers-page feature grant ──────────

export const setTenantCareersFeatureSchema = z.object({
  enabled: z.boolean(),
});
export type SetTenantCareersFeatureInput = z.infer<typeof setTenantCareersFeatureSchema>;
