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
  const out: RenderedSlide[] = [];

  for (let i = 0; i < ordered.length; i++) {
    const slide = ordered[i]!;
    const page = await browser.newPage();
    try {
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      const url = `${base}/render?projectId=${project._id}&slideId=${encodeURIComponent(slide.id)}`;
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 45000 });

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
      out.push({ name, buffer, key: stored.key, url: stored.url });
    } finally {
      await page.close().catch(() => {});
    }
  }

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
