import { z } from 'zod';
import { ask, DESIGN_PROMPT, parseTagged, prepareGeneration, withVariants, slideStreamer } from '@/lib/ai';
import { generateSchema } from '@/lib/schema';
import { body, failure, RequestError } from '@/lib/http';
import { retainFonts } from '@/lib/fonts';
import { operationResponse } from '@/lib/operation';

export const maxDuration = 600;
const variantsSchema = generateSchema.extend({ slideIndex: z.number().int().nonnegative(), count: z.number().int().min(2).max(4).default(3), wish: z.string().max(2000).optional() });

/** Alternatives for one slide. Nothing is applied: the user picks one. */
export async function POST(request: Request) {
  try {
    const input = await body(request, variantsSchema);
    const deck = input.deck;
    if (!deck?.slides[input.slideIndex]) throw new RequestError('Choose an existing slide.');
    return operationResponse(request, async operation => {
      const content = withVariants(await prepareGeneration({ ...input, instruction: input.wish || 'Show options for this slide', useUpdatedBrief: true }, operation), deck, input.slideIndex, input.count, input.wish);
      operation.progress('Sketching options…');
      const text = await ask(DESIGN_PROMPT, content, operation, false, input.models.revise, { timeoutMs: 600_000, maxTokens: 48_000, effort: 'medium', writingLabel: 'Sketching options…',
        onText: slideStreamer(slide => operation.slide?.({ index: slide.n - 1, html: slide.html, mode: 'variant' })) });
      const options = (parseTagged(text)?.slides ?? []).slice(0, input.count).map(slide => ({ html: slide.html }));
      if (!options.length) throw new RequestError('The model returned no options. Try again.', 502);
      // Reuse every asset the deck and its references can resolve, then keep any new fonts.
      const known = { ...deck.assets, ...Object.fromEntries([...(input.brand?.previews ?? []), ...input.references.flatMap(brand => brand.previews)].filter(p => p.original).map(p => [p.url, p.original!])),
        ...(input.kit.logo ? { [input.kit.logo]: input.kit.logo } : {}), ...Object.fromEntries([...input.pinned, ...input.revisionReferences].map(image => [image.original, image.original])) };
      const sample = await retainFonts({ ...deck, assets: known, slides: options }, operation);
      const assets = Object.fromEntries(Object.entries(sample.assets ?? {}).filter(([url]) => options.some(option => option.html.includes(url) || option.html.includes(url.replaceAll('&', '&amp;')))));
      return { options, assets };
    });
  } catch (error) { return failure(error); }
}
