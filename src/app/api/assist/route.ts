import { assistWriting } from '@/lib/assistant';
import { writingRequestSchema } from '@/lib/writing';
import { body, failure, RequestError } from '@/lib/http';
import { operationResponse } from '@/lib/operation';

export const maxDuration = 90;
export async function POST(request: Request) {
  try {
    const input = await body(request, writingRequestSchema);
    if (input.mode !== 'chat' && !input.brief.trim()) throw new RequestError('Write a little of your description first.');
    if (input.mode === 'chat' && input.messages.at(-1)?.role !== 'user') throw new RequestError('Add a message for the writing assistant.');
    return operationResponse(request, operation => assistWriting(input, operation));
  } catch (error) { return failure(error); }
}
