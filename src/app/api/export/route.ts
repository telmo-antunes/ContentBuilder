import { deckSchema } from '@/lib/schema';
import { exportDeck } from '@/lib/export';
import { body, failure, RequestError } from '@/lib/http';
import { withPage } from '@/lib/browser';
import { captureSlide } from '@/lib/render';
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    const deck = await body(request, deckSchema);
    const selected = new URL(request.url).searchParams.get('slide');
    let renderMs = 0; let renderCacheHits = 0; let bytes: Buffer;
    if (selected !== null) {
      const index = Number(selected);
      if (!Number.isInteger(index) || !deck.slides[index]) throw new RequestError('Choose an existing slide.');
      const start = Date.now();
      bytes = await withPage(async page => {
        const capture = await captureSlide(page, deck, index); renderCacheHits = Number(capture.hit);
        if (capture.missing) throw new RequestError('An image could not load. Check this slide before exporting.', 422);
        return capture.png;
      }, false, request.signal);
      renderMs = Date.now() - start;
    } else bytes = await exportDeck(deck, request.signal, metrics => { renderMs = metrics.renderMs; renderCacheHits = metrics.renderCacheHits; });
    return new Response(new Uint8Array(bytes), { headers: {
      'Content-Type': selected === null ? 'application/zip' : 'image/png',
      'Content-Disposition': `attachment; filename="${selected === null ? 'slides.zip' : `slide-${Number(selected) + 1}.png`}"`,
      'X-Render-Ms': String(renderMs), 'X-Render-Cache-Hits': String(renderCacheHits),
    } });
  } catch (error) { return failure(error); }
}
