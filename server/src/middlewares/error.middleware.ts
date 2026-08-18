import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '../utils/errors.js';
import { fail } from '../utils/response.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

/** Maps the common Prisma known-request errors to clean HTTP responses. */
function handlePrismaError(err: Prisma.PrismaClientKnownRequestError, res: Response): boolean {
  switch (err.code) {
    case 'P2002': { // unique constraint violation
      const target = (err.meta?.target as string[] | undefined)?.join(', ');
      fail(res, 409, 'CONFLICT', target ? `A record with that ${target} already exists` : 'That record already exists');
      return true;
    }
    case 'P2003': // foreign-key constraint violation (referenced row does not exist)
      fail(res, 400, 'INVALID_REFERENCE', 'A referenced record does not exist');
      return true;
    case 'P2025': // record not found (update/delete on a missing row)
      fail(res, 404, 'NOT_FOUND', 'The requested record was not found');
      return true;
    default:
      return false;
  }
}

export function notFoundHandler(req: Request, res: Response): void {
  fail(res, 404, 'NOT_FOUND', `Route not found: ${req.method} ${req.path}`);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    logger.error(`AppError [${err.statusCode}]: ${err.message}`, { code: err.code });
    fail(res, err.statusCode, err.code, err.message, err.details);
    return;
  }

  // Known Prisma errors (FK / unique / missing) → clean 4xx instead of a 500.
  if (err instanceof Prisma.PrismaClientKnownRequestError && handlePrismaError(err, res)) {
    return;
  }

  // Multer upload errors (oversized file, too many files) → clean 400 instead
  // of a 500. Duck-typed to avoid importing multer here.
  if (err instanceof Error && err.name === 'MulterError') {
    const code = (err as { code?: string }).code;
    const message =
      code === 'LIMIT_FILE_SIZE'
        ? 'File exceeds the maximum allowed size'
        : code === 'LIMIT_FILE_COUNT' || code === 'LIMIT_UNEXPECTED_FILE'
          ? 'Too many files in upload'
          : 'File upload rejected';
    fail(res, 400, 'UPLOAD_ERROR', message);
    return;
  }

  // Zod validation errors from controllers that parse req.query/body directly.
  if (err instanceof ZodError) {
    const details: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const path = issue.path.join('.') || '_';
      (details[path] ??= []).push(issue.message);
    }
    fail(res, 400, 'VALIDATION_ERROR', 'Validation failed', details);
    return;
  }

  logger.error('Unhandled error', {
    message: (err as Error)?.message,
    stack: env.isProd ? undefined : (err as Error)?.stack,
  });
  fail(
    res,
    500,
    'INTERNAL_ERROR',
    env.isProd ? 'Internal server error' : String((err as Error)?.message ?? err),
  );
}
