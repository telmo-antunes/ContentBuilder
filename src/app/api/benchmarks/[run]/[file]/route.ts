import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { checkOrigin, failure, RequestError } from '@/lib/http';
export async function GET(request: Request, { params }: { params: { run: string; file: string } }) {
  try {
    checkOrigin(request);
    if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(params.run) || !/^(review\.html|results\.json|[a-z0-9-]+\.png)$/.test(params.file)) throw new RequestError('Unknown benchmark artifact.', 404);
    const content = await readFile(resolve(process.cwd(), '.data/benchmarks', params.run, params.file)).catch(() => { throw new RequestError('This benchmark artifact was not found.', 404); });
    return new Response(new Uint8Array(content), { headers: {
      'Content-Type': params.file.endsWith('.png') ? 'image/png' : params.file.endsWith('.json') ? 'application/json' : 'text/html; charset=utf-8',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox allow-scripts allow-downloads; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'none'",
    } });
  } catch (error) { return failure(error); }
}
