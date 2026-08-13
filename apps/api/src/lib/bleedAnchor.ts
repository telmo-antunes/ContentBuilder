import sharp, { type Sharp } from 'sharp';

/**
 * WHICH END OF A PHOTOGRAPH THE TYPE SHOULD SIT ON.
 *
 * A full-bleed slide lays cream type over a picture the app did not choose and
 * cannot predict. The scrim keeps it legible, but a scrim heavy enough to
 * rescue type over a bright sky ruins the photograph, and one gentle enough to
 * respect the photograph loses the type over that same sky.
 *
 * So pick the quiet end instead of darkening the loud one. A car photographed
 * in a bright workshop is dark along the bottom and blown out at the top; a car
 * against an evening sky is the reverse. Anchoring the type into whichever end
 * is already dark means the scrim only has to finish a job the image started.
 *
 * Deliberately luminance rather than a vision call: it is free, it is
 * deterministic, it runs in single-digit milliseconds on a thumbnail, and it
 * answers the only question being asked. A model would cost a call per photo to
 * be less predictable about "which end is darker".
 */

/** How much of the frame each end contributes to the verdict. */
const BAND = 0.33;

/**
 * Below this the two ends are too close to call, and the archetype's own
 * default wins. Flipping a composition on a 2% luminance difference would make
 * the layout jitter between renders of near-identical photographs.
 */
const DECISIVE_DIFFERENCE = 0.08;

export type BleedAnchor = 'top' | 'bottom';

/**
 * Mean relative luminance of a band, 0–1.
 *
 * Uses the sRGB coefficients rather than a plain channel average, because the
 * eye is far more sensitive to green than to blue and a naive mean calls a
 * saturated blue sky "dark".
 */
async function bandLuminance(
  image: Sharp,
  width: number,
  height: number,
  top: number,
  bandOverride?: number,
): Promise<number> {
  const band = bandOverride ?? Math.max(1, Math.round(height * BAND));
  const { data } = await image
    .clone()
    .extract({ left: 0, top, width, height: Math.min(band, height - top) })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let sum = 0;
  for (let i = 0; i < data.length; i += 3) {
    sum += 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
  }
  return sum / (data.length / 3) / 255;
}

/**
 * Where the type belongs on this picture, or `undefined` when the image cannot
 * be read or the two ends are too close to call.
 *
 * Never throws: a photograph that will not decode is a reason to fall back to
 * the archetype's default, not a reason to fail a compose.
 */
export async function bleedAnchorFor(buffer: Buffer): Promise<BleedAnchor | undefined> {
  try {
    // A thumbnail is enough — this is a question about broad tonal weight, and
    // downscaling first makes it cheap regardless of what was uploaded.
    const small = sharp(buffer).resize(160, 160, { fit: 'fill' });
    const meta = { width: 160, height: 160 };

    const [top, bottom] = await Promise.all([
      bandLuminance(small, meta.width, meta.height, 0),
      bandLuminance(small, meta.width, meta.height, Math.round(meta.height * (1 - BAND))),
    ]);

    if (Math.abs(top - bottom) < DECISIVE_DIFFERENCE) return undefined;
    // Type goes where the picture is already dark.
    return top < bottom ? 'top' : 'bottom';
  } catch {
    return undefined;
  }
}

/**
 * Mean relative luminance of a whole picture, 0–1, or `undefined` if it will
 * not decode.
 *
 * Answers a different question from {@link bleedAnchorFor}: not "which end is
 * darker" but "is this photograph the right WEIGHT to sit behind this brand's
 * type at all".
 */
export async function meanLuminanceOf(buffer: Buffer): Promise<number | undefined> {
  try {
    const small = sharp(buffer).resize(160, 160, { fit: 'fill' });
    return await bandLuminance(small, 160, 160, 0, 160);
  } catch {
    return undefined;
  }
}

/**
 * How far a full-bleed photograph's tone may sit from the surface it replaces.
 *
 * A bleed photo stands in for the slide's own ground, and the type was coloured
 * for that ground. Put a pale photograph behind cream type on a near-black
 * slide and the frame splits: the headline crosses from legible to invisible
 * mid-sentence, which reads as a rendering fault rather than a choice. That
 * shipped — a high-key photo behind a CTA slide cut it in half at 53% with the
 * headline spanning the seam.
 *
 * Generous on purpose. The background layer carries a scrim that can rescue a
 * moderate mismatch; this only rejects photographs the scrim cannot save.
 */
const MAX_GROUND_DRIFT = 0.42;

/**
 * Can this photograph carry the frame on a surface of `groundLuminance`?
 *
 * Unreadable images pass: a decode failure is a reason to fall back to the
 * archetype's default, never to fail a compose.
 */
export async function suitsBleedOver(
  buffer: Buffer,
  groundLuminance: number,
): Promise<boolean> {
  const mean = await meanLuminanceOf(buffer);
  if (mean === undefined) return true;
  return Math.abs(mean - groundLuminance) <= MAX_GROUND_DRIFT;
}

/** Relative luminance of a `#rgb`/`#rrggbb` token, 0–1. `undefined` if unparseable. */
export function hexLuminance(hex: string): number | undefined {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  const h = m[1]!.length === 3 ? m[1]!.split('').map((c) => c + c).join('') : m[1]!;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255;
}
