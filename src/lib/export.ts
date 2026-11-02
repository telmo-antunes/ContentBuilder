import { ZipArchive } from 'archiver';
import { withPage } from './browser';
import { RequestError } from './http';
import type { Deck } from './schema';
import { captureSlide } from './render';

export async function exportDeck(deck: Deck, signal?: AbortSignal, metrics?: (value: { renderMs: number; renderCacheHits: number }) => void): Promise<Buffer> {
  const start = Date.now(); let hits = 0;
  return withPage(async page => {
    await page.setViewport({ width: deck.width, height: deck.height, deviceScaleFactor: 1 });
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    const complete = new Promise<Buffer>((resolve, reject) => {
      archive.on('data', chunk => chunks.push(chunk));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);
    });
    // Attach rejection handling immediately, including before the first PNG.
    void complete.catch(() => {});
    try {
      for (const index of deck.slides.keys()) {
        signal?.throwIfAborted();
        const capture = await captureSlide(page, deck, index); hits += Number(capture.hit);
        if (capture.missing) throw new RequestError(`Slide ${index + 1} has an image that could not load. Check this slide before exporting.`, 422);
        const png = capture.png;
        archive.append(Buffer.from(png), { name: `slide-${String(index + 1).padStart(2, '0')}.png` });
      }
      await archive.finalize();
      const result = await complete; metrics?.({ renderMs: Date.now() - start, renderCacheHits: hits }); return result;
    } catch (error) { archive.abort(); throw error; }
  }, false, signal);
}
