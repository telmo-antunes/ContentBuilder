import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { buildContactSheet, FEED_SCALE_WIDTH } from './contactSheet';

const slide = (color: string) =>
  sharp({ create: { width: 1080, height: 1350, channels: 3, background: color } })
    .png()
    .toBuffer();

describe('buildContactSheet', () => {
  it('lays a deck out three to a row at feed scale', async () => {
    const slides = await Promise.all(['#111', '#222', '#333', '#444'].map(slide));
    const sheet = await buildContactSheet(slides.map((buffer) => ({ buffer })), '1080x1350');
    const { width, height } = await sharp(sheet).metadata();
    // 3 columns + 2 gutters + 2 margins
    expect(width).toBe(28 * 2 + 3 * FEED_SCALE_WIDTH + 2 * 20);
    // 4 slides wrap to 2 rows, so the sheet is taller than one cell
    const cellH = Math.round((1350 / 1080) * FEED_SCALE_WIDTH);
    expect(height).toBeGreaterThan(cellH * 2);
  });

  it('keeps the grid tight when no slide is flagged', async () => {
    const one = await slide('#111');
    const plain = await buildContactSheet([{ buffer: one }], '1080x1350');
    const flagged = await buildContactSheet([{ buffer: one, flags: ['collision'] }], '1080x1350');
    const a = await sharp(plain).metadata();
    const b = await sharp(flagged).metadata();
    // The label strip only exists when there is something to label.
    expect(b.height!).toBeGreaterThan(a.height!);
  });

  it('honours the format aspect — a story is taller than a carousel', async () => {
    const one = await slide('#111');
    const carousel = await buildContactSheet([{ buffer: one }], '1080x1350');
    const story = await buildContactSheet([{ buffer: one }], '1080x1920');
    expect((await sharp(story).metadata()).height!).toBeGreaterThan(
      (await sharp(carousel).metadata()).height!,
    );
  });

  it('refuses an empty deck rather than composing nothing', async () => {
    await expect(buildContactSheet([], '1080x1350')).rejects.toThrow(/at least one slide/i);
  });
})
