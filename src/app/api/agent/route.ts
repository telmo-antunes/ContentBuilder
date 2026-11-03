import { body, failure } from '@/lib/http';
import { operationResponse } from '@/lib/operation';
import { agentRequestSchema, contentAgent } from '@/lib/content-agent';

export const maxDuration = 120;
export async function POST(request: Request) {
  try { const input = await body(request, agentRequestSchema); return operationResponse(request, operation => contentAgent(input, operation)); }
  catch (error) { return failure(error); }
}
