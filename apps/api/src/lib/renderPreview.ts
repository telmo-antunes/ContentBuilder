import type { Page } from 'puppeteer';
import sharp from 'sharp';
import {
  applyBrandLayout,
  FORMAT_DIMENSIONS,
  type Block,
  type BlockType,
  type BrandKit,
  type BrandLayout,
  type Format,
  type MediaAsset,
  type Slide,
  type ThemePreset,
} from '@contentbuilder/shared';
import { config } from '../config';
import { putStash } from './renderStash';

/**
 * Renders an AD-HOC brand-layout candidate (no saved project) to a PNG so the
 * design director can SEE its own composition and a vision model can critique
 * it. Pours realistic sample copy into the skeleton, stashes a render-ready
 * payload, drives the shared browser to `/render?stashId=…`, and captures the
 * `[data-slide-root]` element — the exact path the exporter/critique already use.
 */

/** Realistic sample copy per block type — enough to exercise the composition. */
export const SAMPLE_TEXT: Record<BlockType, { text?: string; items?: string[] }> = {
  eyebrow: { text: 'NEW THIS WEEK' },
  title: { text: 'Make it unmistakably yours' },
  subtitle: { text: 'On-brand in seconds' },
  paragraph: {
    text: 'A short paragraph of body copy that shows how running text sits inside the composition without crowding the frame or fighting the background.',
  },
  quote: { text: '“The best decision we made all year.”' },
  attribution: { text: '— A. Customer' },
  date: { text: 'Sat 24 May' },
  price: { text: '$49' },
  list: { items: ['First key point worth sharing', 'Second point that adds value', 'Third point to round it out'] },
  caption: { text: 'A small supporting caption' },
  cta: { text: 'Book your slot today' },
  footer: { text: 'yourbrand.com' },
  handle: { text: '@yourbrand' },
};

/**
 * Build a render-ready FreePosition slide from a brand layout skeleton by pouring
 * sample copy (by block type) into its frames. Pure + deterministic.
 */
export function sampleSlideForLayout(layout: BrandLayout, backgroundAssetId?: string): Slide {
  const sourceBlocks: Block[] = layout.blocks.map((lb) => {
    const sample = SAMPLE_TEXT[lb.type as BlockType] ?? { text: 'Sample' };
    return { type: lb.type as BlockType, text: sample.text ?? '', items: sample.items };
  });
  const source: Slide = {
    id: 'preview',
    order: 0,
    layoutType: 'FreePosition',
    blocks: sourceBlocks,
    imageNeed: layout.imageNeed ?? 'none',
  };
  return applyBrandLayout(source, layout, backgroundAssetId ?? layout.backgroundMediaAssetId);
}

export interface CompositionShot {
  overflow: boolean;
  /** sharp-downscaled (≤768px) PNG, base64 — ready for a vision image block. */
  base64: string;
}

export interface ShootOptions {
  layout: BrandLayout;
  format: Format;
  kit: Partial<BrandKit> | null;
  /** Business media so any image slots / referenced assets resolve. */
  media?: MediaAsset[];
  /** Explicit background to render behind the composition (id is synthesized into media). */
  background?: { id: string; url: string };
  theme?: ThemePreset;
  slideIndex?: number;
  slideTotal?: number;
}

/** Render one candidate composition and return its overflow verdict + a PNG. */
export async function shootComposition(page: Page, opts: ShootOptions): Promise<CompositionShot | null> {
  const media: MediaAsset[] = [...(opts.media ?? [])];
  const backgroundId = opts.background?.id;
  if (opts.background) {
    media.push({
      _id: opts.background.id,
      businessId: '',
      type: 'generated',
      key: '',
      url: opts.background.url,
      width: 1080,
      height: 1350,
      createdAt: '',
    });
  }
  const slide = sampleSlideForLayout(opts.layout, backgroundId);

  const dims = FORMAT_DIMENSIONS[opts.format];
  const type = opts.format === '1080x1920' ? 'story' : 'carousel';
  const id = putStash({
    format: opts.format,
    type,
    slides: [slide],
    brandKit: opts.kit,
    media,
    settings: { theme: opts.theme },
  });

  await page.setViewport({ width: dims.width, height: dims.height, deviceScaleFactor: 1 });
  await page.goto(`${config.webUrl}/render?stashId=${id}`, { waitUntil: 'load', timeout: 45000 });

  // Wait for fonts + every image (incl. the SVG background) before capture.
  await page.evaluate(async () => {
    const doc = (globalThis as { document?: any }).document;
    if (doc?.fonts?.ready) await doc.fonts.ready;
    const imgs: any[] = Array.from(doc?.images ?? []);
    await Promise.all(
      imgs.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise((res) => {
              img.onload = () => res(null);
              img.onerror = () => res(null);
            }),
      ),
    );
  });
  await new Promise((r) => setTimeout(r, 400)); // let the text-fit pass settle + publish data-overflow

  const overflow = await page.evaluate(
    () => (globalThis as { document?: any }).document?.body?.dataset?.overflow === 'true',
  );
  const el = await page.$('[data-slide-root]');
  if (!el) return null;
  const shot = await el.screenshot({ type: 'png' });
  const small = await sharp(Buffer.from(shot))
    .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
  return { overflow: Boolean(overflow), base64: small.toString('base64') };
}
