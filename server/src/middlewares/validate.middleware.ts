import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodSchema } from 'zod';
import { ValidationError } from '../utils/errors.js';

type Target = 'body' | 'query' | 'params';

function zodToDetails(err: ZodError): Record<string, string[]> {
  const details: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const path = issue.path.join('.') || '_';
    (details[path] ??= []).push(issue.message);
  }
  return details;
}

/**
 * Validates and coerces a request segment against a Zod schema, replacing it
 * with the parsed result. Coerced query params (page/pageSize) land typed.
 */
export function validate(schema: ZodSchema, target: Target = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      return next(new ValidationError(zodToDetails(result.error)));
    }
    // req.query is a getter in Express 5; assign defensively.
    if (target === 'query') {
      Object.defineProperty(req, 'query', { value: result.data, writable: true });
    } else {
      req[target] = result.data;
    }
    next();
  };
}
