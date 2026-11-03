import { deckSchema } from '@/lib/schema';
import { body, failure } from '@/lib/http';
import { operationResponse } from '@/lib/operation';
import { inspectDeck } from '@/lib/render';
export const maxDuration = 300;
export async function POST(request: Request) {
  try { const deck = await body(request, deckSchema); return operationResponse(request, operation => inspectDeck(deck, operation, true)); }
  catch (error) { return failure(error); }
}
