import sharp, { type OverlayOptions } from 'sharp';
import { dimensionsFor, type Format } from '@contentbuilder/shared';

/**
 * The deck at the size it is actually seen.
 *
 * A review page shows slides as a strip of small cards, and that is the one
 * view in which a monotonous deck looks fine — seven near-identical dark frames
 * read as "consistent" at 120px and as "one slide repeated" at feed scale. The
 * same is true of most layout faults: dead space, a widow, a headline running
 * four lines and a photo whose subject sits under the type are all invisible in
 * a thumbnail and obvious at the size a phone renders them.
 *
 * So this is not a nicety. It is the artifact that would have caught a whole
 * review's worth of findings before anyone posted, and it costs one compose of
 * already-rendered PNGs.
 */

/** Roughly what one slide occupies in a phone feed. */
export const FEED_SCALE_WIDTH = 350;

/** Slides per row. Three fits a laptop screen without shrinking below feed scale. */
const COLUMNS = 3;
const GUTTER = 20;
const MARGIN = 28;

export interface ContactSheetInput {
  buffer: Buffer;
  /** Marked under the slide when the render gates flagged something. */
  flags?: string[];
}

/**
 * Compose the deck into one image at feed scale.
 *
 * Deliberately no captions beyond the flags: the point is to look at the deck
 * the way a reader will, and a grid annotated with commentary invites reading
 * the commentary instead of the pictures.
 */
export async function buildContactSheet(
  slides: readonly ContactSheetInput[],
  format: Format,
): Promise<Buffer> {
  if (!slides.length) throw new Error('A contact sheet needs at least one slide');

  const { width: fw, height: fh } = dimensionsFor(format);
  const cellW = FEED_SCALE_WIDTH;
  const cellH = Math.round((fh / fw) * cellW);
  // A flagged slide carries a label strip under it; ungated decks get none, so
  // the grid stays tight when there is nothing to say.
  const labelH = slides.some((s) => s.flags?.length) ? 26 : 0;

  const rows = Math.ceil(slides.length / COLUMNS);
  const sheetW = MARGIN * 2 + COLUMNS * cellW + (COLUMNS - 1) * GUTTER;
  const sheetH = MARGIN * 2 + rows * (cellH + labelH) + (rows - 1) * GUTTER;

  const composites: OverlayOptions[] = [];

  for (const [i, slide] of slides.entries()) {
    const col = i % COLUMNS;
    const row = Math.floor(i / COLUMNS);
    const left = MARGIN + col * (cellW + GUTTER);
    const top = MARGIN + row * (cellH + labelH + GUTTER);

    composites.push({
      input: await sharp(slide.buffer).resize(cellW, cellH, { fit: 'fill' }).png().toBuffer(),
      left,
      top,
    });

    // The index goes ON the slide, small and in a corner, so a finding can be
    // reported as "slide 4" without counting across the grid.
    const badge = `<svg width="${cellW}" height="24" xmlns="http://www.w3.org/2000/svg">
      <text x="6" y="17" font-family="ui-monospace,Menlo,monospace" font-size="13"
            fill="#ffffff" opacity="0.75">${i + 1}</text></svg>`;
    composites.push({ input: Buffer.from(badge), left: left + 4, top: top + 4 });

    if (labelH && slide.flags?.length) {
      const text = slide.flags.join(' · ').replace(/[<&>]/g, '');
      const label = `<svg width="${cellW}" height="${labelH}" xmlns="http://www.w3.org/2000/svg">
        <text x="0" y="17" font-family="ui-sans-serif,system-ui,sans-serif" font-size="13"
              fill="#c2410c">${text}</text></svg>`;
      composites.push({ input: Buffer.from(label), left, top: top + cellH + 4 });
    }
  }

  return sharp({
    create: { width: sheetW, height: sheetH, channels: 3, background: '#f5f5f4' },
  })
    .composite(composites)
    .png()
    .toBuffer();
}
