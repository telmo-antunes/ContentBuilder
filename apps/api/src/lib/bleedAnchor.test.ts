import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { bleedAnchorFor } from './bleedAnchor';

/** A 300×300 image: top half `top`, bottom half `bottom`. */
const split = (top: string, bottom: string) =>
  sharp({ create: { width: 300, height: 300, channels: 3, background: top } })
    .composite([
      {
        input: { create: { width: 300, height: 150, channels: 3, background: bottom } },
        top: 150,
        left: 0,
      },
    ])
    .png()
    .toBuffer();

describe('bleedAnchorFor', () => {
  /**
   * Type goes where the picture is already dark, so the scrim only has to
   * finish a job the image started.
   */
  it('anchors to the top when the top is the dark end', async () => {
    expect(await bleedAnchorFor(await split('#0a0a0a', '#f2f2f2'))).toBe('top');
  });

  it('anchors to the bottom when the bottom is the dark end', async () => {
    expect(await bleedAnchorFor(await split('#f2f2f2', '#0a0a0a'))).toBe('bottom');
  });

  /**
   * Flipping a composition on a tiny difference would make the layout jitter
   * between renders of near-identical photographs.
   */
  it('declines to decide when the two ends are too close', async () => {
    expect(await bleedAnchorFor(await split('#808080', '#858585'))).toBeUndefined();
  });

  it('declines on an evenly lit picture', async () => {
    const flat = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#4a4a4a' } })
      .png()
      .toBuffer();
    expect(await bleedAnchorFor(flat)).toBeUndefined();
  });

  /**
   * Weighted for the eye, not a flat channel mean. Pure green and pure blue are
   * identical to a naive average — one channel at full each — and wildly
   * different to look at: 0.72 against 0.07. Type belongs on the blue.
   */
  it('weights channels for the eye rather than averaging them', async () => {
    expect(await bleedAnchorFor(await split('#00ff00', '#0000ff'))).toBe('bottom');
    expect(await bleedAnchorFor(await split('#0000ff', '#00ff00'))).toBe('top');
  });

  /**
   * And the corollary, which is why the threshold exists: a saturated blue is
   * so close to black perceptually that the two ends are not worth flipping a
   * composition over.
   */
  it('treats saturated blue and black as too close to call', async () => {
    expect(await bleedAnchorFor(await split('#0000ff', '#000000'))).toBeUndefined();
  });

  it('never throws on something that is not an image', async () => {
    expect(await bleedAnchorFor(Buffer.from('definitely not a png'))).toBeUndefined();
  });
});
