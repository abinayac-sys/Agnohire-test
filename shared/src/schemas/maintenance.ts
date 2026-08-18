import { z } from 'zod';

/** Schedule a platform-wide maintenance window (SUPERADMIN only). */
export const createMaintenanceWindowSchema = z
  .object({
    title: z.string().trim().min(2).max(160),
    message: z.string().trim().min(2).max(2000),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
  })
  .refine((v) => v.endAt > v.startAt, { message: 'endAt must be after startAt', path: ['endAt'] })
  .refine((v) => v.startAt.getTime() > Date.now(), { message: 'startAt must be in the future', path: ['startAt'] });
export type CreateMaintenanceWindowInput = z.infer<typeof createMaintenanceWindowSchema>;
