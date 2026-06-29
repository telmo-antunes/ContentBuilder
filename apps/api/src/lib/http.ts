import type { NextFunction, Request, Response } from 'express';
import { Types } from 'mongoose';
import { ZodError, type ZodTypeAny, type infer as ZodInfer } from 'zod';

/** An error carrying an HTTP status; thrown by routes, formatted by the handler. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Wrap an async route so rejected promises reach the error middleware. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

/** Parse + validate a request body against a Zod schema or throw a 400. */
export function parseBody<S extends ZodTypeAny>(schema: S, body: unknown): ZodInfer<S> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiError(400, 'Validation failed', result.error.flatten());
  }
  return result.data;
}

/** Validate a Mongo ObjectId path param or throw a 404. */
export function requireObjectId(id: string | undefined, label = 'resource'): string {
  if (!id || !Types.ObjectId.isValid(id)) {
    throw new ApiError(404, `${label} not found`);
  }
  return id;
}

/** Terminal Express error handler — emits a consistent JSON error shape. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Validation failed', details: err.flatten() });
    return;
  }
  const message = err instanceof Error ? err.message : 'Internal server error';
  console.error('[api] unhandled error:', err);
  res.status(500).json({ error: message });
}
