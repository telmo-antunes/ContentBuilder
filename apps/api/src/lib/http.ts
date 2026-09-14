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
/** zod's flattened errors plus every issue with its dotted path — `slides.0.photos.0.id`. */
function withIssues(error: { flatten(): unknown; issues: Array<{ path: PropertyKey[]; message: string }> }) {
  const flat = error.flatten() as Record<string, unknown>;
  return { ...flat, issues: error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })) };
}

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
    // `flatten()` names the top-level field only — a photo missing its id came
    // back as {slides: ["Required"]} with no slide index and no field path, and
    // every API-driving session paid a source dive to find `photos[].id`. The
    // issues carry the path; hand them over.
    throw new ApiError(400, 'Validation failed', withIssues(result.error));
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
    res.status(400).json({ error: 'Validation failed', details: withIssues(err) });
    return;
  }
  // Unexpected errors: full detail to the server log, generic message to the
  // client (raw messages can leak paths, hostnames, and library internals).
  console.error('[api] unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
}

/**
 * A short, single-line, safe-to-show summary of an upstream error for embedding
 * in intentional ApiError messages (e.g. "Draft failed: …"). Multi-line or long
 * messages (stacks, dumps) collapse to a generic phrase.
 */
export function publicErrMessage(err: unknown, fallback = 'unexpected error'): string {
  if (!(err instanceof Error) || !err.message) return fallback;
  const line = err.message.split('\n')[0]!.trim();
  return line.length > 0 && line.length <= 140 ? line : fallback;
}
