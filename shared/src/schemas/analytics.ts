import { z } from 'zod';

const GRANULARITIES = ['day', 'week', 'month'] as const;

/** Optional reporting window + grouping. Defaults to the trailing 30 days. */
export const analyticsFiltersSchema = z.object({
  /** ISO date (YYYY-MM-DD) or full ISO datetime. */
  from: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  to: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  granularity: z.enum(GRANULARITIES).default('day'),
  domainId: z.string().uuid().optional(),
  /** Admins/global-analytics holders may pin a sector; others are forced to theirs. */
  sectorId: z.string().uuid().optional(),
});
export type AnalyticsFilters = z.infer<typeof analyticsFiltersSchema>;

const REPORT_TYPES = ['overview', 'funnel', 'timeseries', 'jobs', 'applications'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const exportReportSchema = analyticsFiltersSchema.extend({
  report: z.enum(REPORT_TYPES).default('overview'),
});
export type ExportReportInput = z.infer<typeof exportReportSchema>;

export const snapshotFiltersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(1000).default(25),
});
export type SnapshotFilters = z.infer<typeof snapshotFiltersSchema>;
