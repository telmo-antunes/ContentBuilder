import { dimensionsFor, type Format } from '@contentbuilder/shared';
import { config } from '../config';
import { getBrowser } from './browser';
import { getStorage } from '../storage';

export interface RenderedSlide {
  /** Zero-padded filename for the zip: 01.png, 02.png, … */
  name: string;
  buffer: Buffer;
  key: string;
  url: string;
}

interface ExportableProject {
  _id: string;
  format: Format;
  slides: Array<{ id: string; order: number }>;
}

/**
 * Render every slide of a project to a PNG by driving the hidden /render route
 * with Puppeteer at the project's exact pixel dimensions. The SAME React layout
 * components used in the editor render here — what you see is what exports.
 * Each PNG is persisted through the StorageProvider and returned in swipe order.
 */
export async function renderSlidesToPng(project: ExportableProject): Promise<RenderedSlide[]> {
  const { width, height } = dimensionsFor(project.format);
  const browser = await getBrowser();
  const storage = getStorage();
  const base = config.webUrl.replace(/\/+$/, '');

  const ordered = [...project.slides].sort((a, b) => a.order - b.order);
  const out: RenderedSlide[] = new Array(ordered.length);

  // Concurrency pool: each worker reuses ONE page, pulling slides from a shared counter.
  const CONCURRENCY = 4;
  let next = 0;

  const worker = async () => {
    let page = await browser.newPage();
    try {
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      for (let i = next++; i < ordered.length; i = next++) {
        const slide = ordered[i]!;
        const url = `${base}/render?projectId=${project._id}&slideId=${encodeURIComponent(slide.id)}`;

        // The render page fetches its data CLIENT-side — 'load' fires before the
        // slide exists, so wait for the actual mount. A reused page's connection
        // pool occasionally goes stale (fetch hangs, page stuck on the shell);
        // ONE retry on a brand-new page reliably clears it.
        let mounted = false;
        for (let attempt = 1; attempt <= 2 && !mounted; attempt++) {
          await page.goto(url, { waitUntil: 'load', timeout: 45000 });
          try {
            await page.waitForSelector('[data-slide-root]', { timeout: attempt === 1 ? 20000 : 30000 });
            mounted = true;
          } catch {
            if (attempt === 2) {
              // Surface what the page ACTUALLY shows — beats a bare timeout.
              const shown = await page
                .evaluate(() => {
                  const doc = (globalThis as { document?: any }).document;
                  return String(doc?.body?.innerText ?? '').slice(0, 160);
                })
                .catch(() => '');
              throw new Error(`slide ${slide.id} never mounted — page shows: "${shown || '(blank)'}"`);
            }
            await page.close().catch(() => {});
            page = await browser.newPage();
            await page.setViewport({ width, height, deviceScaleFactor: 1 });
          }
        }

        // Wait for bundled fonts + all images, else we capture fallback fonts or
        // half-loaded images. (Runs in the browser; use globalThis to avoid
        // pulling DOM types into the Node build.)
        await page.evaluate(async () => {
          const doc = (globalThis as { document?: any }).document;
          if (doc?.fonts?.ready) await doc.fonts.ready;
          const imgs: any[] = Array.from(doc?.images ?? []);
          await Promise.all(
            imgs.map((img) =>
              img.complete
                ? Promise.resolve()
                : new Promise((resolve) => {
                    img.onload = () => resolve(null);
                    img.onerror = () => resolve(null);
                  }),
            ),
          );
        });
        // Short settle so the client-side text-fit pass has applied.
        await new Promise((r) => setTimeout(r, 350));

        const el = await page.$('[data-slide-root]');
        if (!el) throw new Error(`Render route produced no slide for ${slide.id}`);
        const shot = await el.screenshot({ type: 'png' });
        const buffer = Buffer.from(shot);

        const name = `${String(i + 1).padStart(2, '0')}.png`;
        const stored = await storage.save(`renders/${project._id}/${name}`, buffer, {
          contentType: 'image/png',
        });
        out[i] = { name, buffer, key: stored.key, url: stored.url };
      }
    } finally {
      await page.close().catch(() => {});
    }
  };

  const workers = Array.from({ length: Math.min(CONCURRENCY, ordered.length) }, () => worker());
  await Promise.all(workers);

  return out;
}

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'project'
  );
}
