import { ZodError, type ZodTypeAny, type output } from 'zod';

export class RequestError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function checkOrigin(request: Request): void {
  const target = new URL(request.url);
  // Next may normalize request.url to localhost even when the browser used
  // 127.0.0.1. The original Host header is the actual same-origin boundary.
  const host = request.headers.get('host') || target.host;
  const hostname = new URL(`${target.protocol}//${host}`).hostname;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname)) throw new RequestError('Open ContentBuilder on localhost.', 403);
  const origin = request.headers.get('origin');
  if (origin && origin !== `${target.protocol}//${host}`) throw new RequestError('This request must come from ContentBuilder.', 403);
}
export async function body<S extends ZodTypeAny>(request: Request, schema: S, limit = 8 * 1024 * 1024): Promise<output<S>> {
  checkOrigin(request);
  if (!request.headers.get('content-type')?.includes('application/json')) throw new RequestError('Expected JSON.', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError('The request is empty.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new RequestError(`This request exceeds the ${Math.round(limit / 1024 / 1024)} MB limit.`, 413); }
    chunks.push(value);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw new RequestError('The request contains invalid JSON.'); }
  return schema.parse(value);
}
export function failure(error: unknown): Response {
  if (error instanceof ZodError) return Response.json({ error: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') }, { status: 400 });
  if (error instanceof RequestError) return Response.json({ error: error.message }, { status: error.status });
  console.error('[contentbuilder]', error instanceof Error ? error.message : 'Unknown error');
  return Response.json({ error: 'The operation failed. Your current draft is unchanged. Please try again.' }, { status: 500 });
}
