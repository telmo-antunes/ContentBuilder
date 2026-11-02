import { z } from 'zod';
import { analyzeWebsite } from '@/lib/analyze';
import { aiConfigured } from '@/lib/ai';
import { body, failure, RequestError } from '@/lib/http';
import { operationResponse } from '@/lib/operation';

export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    const { url, model } = await body(request, z.object({ url: z.string().url(), model: z.string().max(200).optional() }));
    if (!aiConfigured()) throw new RequestError('Set ANTHROPIC_API_KEY in .env, then restart the app.', 503);
    return operationResponse(request, operation => analyzeWebsite(url, operation, model));
  } catch (error) { return failure(error); }
}
