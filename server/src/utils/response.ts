import type { Response } from 'express';
import type { ApiResponse, Paginated, PaginationMeta } from '@agnohire/shared';

export function ok<T>(res: Response, data: T, status = 200): Response {
  const body: ApiResponse<T> = { success: true, data };
  return res.status(status).json(body);
}

export function fail(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: Record<string, string[]>,
): Response {
  const body: ApiResponse<never> = {
    success: false,
    error: { code, message, details },
  };
  return res.status(status).json(body);
}

export function paginate<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): Paginated<T> {
  const meta: PaginationMeta = {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
  return { items, meta };
}
