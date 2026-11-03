import { ask, decodeDeck, DESIGN_PROMPT, polishDeck, prepareGeneration, slideStreamer } from '@/lib/ai';
import { generationContext, duplicateDirection } from '@/lib/directions';
import { generateSchema } from '@/lib/schema';
import { body, failure, RequestError } from '@/lib/http';
import { inspectDeck } from '@/lib/render';
import { retainFonts } from '@/lib/fonts';
import { operationResponse } from '@/lib/operation';

export const maxDuration = 900;
export async function POST(request: Request) {
  try {
    const input = await body(request, generateSchema);
    const context = generationContext(input);
    if (!context.brief.trim() && !context.directions.length && !input.instruction?.trim() && !input.remix) throw new RequestError('Add a main brief or instructions for at least one slide.');
    const duplicate = duplicateDirection(context.directions);
    if (duplicate !== undefined) throw new RequestError(`Slide ${duplicate} has two instruction fields. Combine them or choose a different slide number.`);
    if (input.instruction !== undefined && (!input.instruction.trim() || !input.deck)) throw new RequestError('A revision needs an existing deck and an instruction.');
    if (input.slideIndex !== undefined && (!input.instruction || !input.deck?.slides[input.slideIndex])) throw new RequestError('Choose an existing slide to revise.');
    if (input.remix && !input.deck) throw new RequestError('Make a post first, then ask for another format.');
    return operationResponse(request, async operation => {
      const content = await prepareGeneration(input, operation);
      const revising = Boolean(input.instruction);
      operation.progress(revising ? 'Reviewing your revision…' : 'Designing your slides…');
      const stream = slideStreamer(slide => operation.slide?.({ index: slide.n - 1, html: slide.html, mode: slide.mode }));
      const text = await ask(DESIGN_PROMPT, content, operation, false, input.models[revising ? 'revise' : 'generate'], { timeoutMs: 600_000, maxTokens: 64_000, effort: 'medium', onText: stream, writingLabel: revising ? 'Reworking your slides…' : 'Designing your slides…' });
      let deck = await inspectDeck(await retainFonts(decodeDeck(text, input), operation), operation);
      // A one-slide edit is small enough to judge by eye; whole decks get a second look.
      if (input.polish && input.slideIndex === undefined) {
        try {
          const polished = await polishDeck(input, deck, operation, slide => operation.slide?.({ index: slide.n - 1, html: slide.html, mode: 'patch', pass: 'polish' }));
          if (polished.changed.length) deck = await inspectDeck(await retainFonts(polished.deck, operation), operation);
        } catch (error) {
          // The deck is already good to use; a failed polish should not cost the user their result.
          operation.signal.throwIfAborted();
          operation.progress(`Skipped the polish pass: ${(error as Error).message}`);
        }
      }
      return deck;
    });
  } catch (error) { return failure(error); }
}
