import { ask, decodeDeck, DESIGN_PROMPT, prepareGeneration } from '@/lib/ai';
import { generationContext, duplicateDirection } from '@/lib/directions';
import { generateSchema } from '@/lib/schema';
import { body, failure, RequestError } from '@/lib/http';
import { inspectDeck } from '@/lib/render';
import { operationResponse } from '@/lib/operation';

export const maxDuration = 600;
export async function POST(request: Request) {
  try {
    const input = await body(request, generateSchema);
    const context = generationContext(input);
    if (!context.brief.trim() && !context.directions.length && !input.instruction?.trim()) throw new RequestError('Add a main brief or instructions for at least one slide.');
    const duplicate = duplicateDirection(context.directions);
    if (duplicate !== undefined) throw new RequestError(`Slide ${duplicate} has two instruction fields. Combine them or choose a different slide number.`);
    if (input.instruction !== undefined && (!input.instruction.trim() || !input.deck)) throw new RequestError('A revision needs an existing deck and an instruction.');
    if (input.slideIndex !== undefined && (!input.instruction || !input.deck?.slides[input.slideIndex])) throw new RequestError('Choose an existing slide to revise.');
    return operationResponse(request, async operation => {
      const content = await prepareGeneration(input, operation);
      operation.progress(input.instruction ? 'Reviewing your revision…' : 'Designing your slides…');
      return inspectDeck(decodeDeck(await ask(DESIGN_PROMPT, content, operation, true, input.models[input.instruction ? 'revise' : 'generate'], { timeoutMs: 600_000, maxTokens: 64_000, effort: 'medium' }), input), operation);
    });
  } catch (error) { return failure(error); }
}
