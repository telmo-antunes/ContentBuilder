import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { bleedAnchorFor, hexLuminance, meanLuminanceOf, suitsBleedOver } from './bleedAnchor';

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

/** A flat field of one colour. */
const flat = (colour: string) =>
  sharp({ create: { width: 300, height: 300, channels: 3, background: colour } }).png().toBuffer();

describe('hexLuminance', () => {
  it('reads three- and six-digit hex, with or without the hash', () => {
    expect(hexLuminance('#000000')).toBe(0);
    // The sRGB coefficients sum to 0.9999999999999999, so white is "1" only to
    // within floating point — the callers compare distances, never equality.
    expect(hexLuminance('#ffffff')).toBeCloseTo(1, 10);
    expect(hexLuminance('fff')).toBeCloseTo(1, 10);
  });

  it('weights green over blue, as the eye does', () => {
    // A naive channel average would call these equal.
    expect(hexLuminance('#00ff00')!).toBeGreaterThan(hexLuminance('#0000ff')!);
  });

  it('returns undefined for anything that is not a hex colour', () => {
    expect(hexLuminance('rgb(0,0,0)')).toBeUndefined();
    expect(hexLuminance('')).toBeUndefined();
  });
});

describe('suitsBleedOver', () => {
  /**
   * A bleed photo replaces the slide's ground, and the type was coloured for
   * that ground. A pale photograph behind cream type on a near-black slide
   * splits the frame — that shipped, cutting a CTA slide in half at 53% with
   * the headline spanning the seam.
   */
  it('rejects a high-key photograph on a near-black ground', async () => {
    expect(await suitsBleedOver(await flat('#f2f2f2'), hexLuminance('#0D0D0F')!)).toBe(false);
  });

  it('accepts a dark photograph on the same ground', async () => {
    expect(await suitsBleedOver(await flat('#151515'), hexLuminance('#0D0D0F')!)).toBe(true);
  });

  it('accepts a mid-tone photograph — the scrim can finish that job', async () => {
    expect(await suitsBleedOver(await flat('#5a5a5a'), hexLuminance('#0D0D0F')!)).toBe(true);
  });

  it('judges against the ground it is given, not a fixed idea of dark', async () => {
    // Same photograph, light brand: now it is the DARK one that fights.
    const light = hexLuminance('#ffffff')!;
    expect(await suitsBleedOver(await flat('#f2f2f2'), light)).toBe(true);
    expect(await suitsBleedOver(await flat('#0a0a0a'), light)).toBe(false);
  });

  it('lets an undecodable image through rather than failing a compose', async () => {
    expect(await suitsBleedOver(Buffer.from('not an image'), 0)).toBe(true);
    expect(await meanLuminanceOf(Buffer.from('not an image'))).toBeUndefined();
  });
});
