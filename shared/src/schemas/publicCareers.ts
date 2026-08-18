import { z } from 'zod';

// ─── PUBLIC CAREERS PAGE (no auth — tenant resolved by slug) ────────────────

export const publicJobFiltersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  location: z.string().optional(),
});
export type PublicJobFilters = z.infer<typeof publicJobFiltersSchema>;

export const publicApplySchema = z.object({
  fullName: z.string().min(2, 'Full name must be at least 2 characters').max(150),
  email: z.string().email('A valid email is required'),
  phone: z.string().max(30).optional().or(z.literal('')),
  coverNote: z.string().max(2000).optional().or(z.literal('')),
});
export type PublicApplyInput = z.infer<typeof publicApplySchema>;
