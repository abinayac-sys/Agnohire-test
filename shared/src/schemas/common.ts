import { z } from 'zod';
import { DEFAULT_PAGE_SIZE } from '../types/api.js';

/** Coerced pagination query, shared by all list endpoints. */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(DEFAULT_PAGE_SIZE),
  sortBy: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().trim().optional(),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

export const uuidSchema = z.string().uuid();

export const idParamSchema = z.object({ id: z.string().uuid() });
