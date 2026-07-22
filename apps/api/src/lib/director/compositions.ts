import { BLOCK_TYPES, type ArtDirection } from '@contentbuilder/shared';
import { aiMessage, modelFor, textOf, withOpusReasoning } from '../ai';
import { recordUsage } from '../usage';
import { TEMPLATE_COUNT, STORY_PURPOSES } from '../templates';
import { extractCompositions, type DirectorLayout } from './schema';
import { brandFactLines, loadDirectorPrompt, type DirectorInputs } from './prompt';

/**
 * Call 2 of the director: turn the brief into 6 post + 4 story FreePosition
 * compositions (frames only, no copy), each tagged with the background intensity
 * its content can afford. The brief is law; frames are validated + repaired.
 */

export const DIRECTOR_LAYOUT_SYSTEM = `You are the layout designer executing an art-direction brief for a brand's Instagram design system: ${TEMPLATE_COUNT} post compositions and ${STORY_PURPOSES.length} story compositions. The brief you are given is LAW — your compositions must look like the brand the brief describes, not like your defaults.

CANVASES — all positions are FRACTIONS (0..1); a "frame" is { "x","y","w","h" }:
- POST: 1080x1350. Keep every frame inside x in [0.08, 0.92], y in [0.07, 0.93].
- STORY: 1080x1920. Instagram overlays the top and bottom — keep ALL frames inside y in [0.14, 0.86]. Stories are taller and airier: fewer, larger elements.

BACKGROUNDS — a separate artist paints three background intensities from the same brief: "canvas" (near-silent), "texture" (quiet), "statement" (bold). For each layout choose the intensity its CONTENT can afford: dense text (content, list) -> "canvas"; normal copy (quote, image-feature side copy) -> "texture"; short-copy heroes (cover, cta) -> "statement". A layout with "imageBackground": true uses a PHOTO -> null.

OUTPUT: ONLY a JSON object (no prose, no code fences):
{ "post": [${TEMPLATE_COUNT} layouts], "story": [${STORY_PURPOSES.length} layouts] }
Each layout:
{ "name": string (2-4 words), "purpose": string, "imageNeed": "none" | "upload", "backgroundRole": "canvas" | "texture" | "statement" | null, "blocks": [{ "type": one of ${BLOCK_TYPES.join(', ')}, "frame": {...}, "z": number }], "decorations"?: [{ "kind": "logo" | "rule" | "divider" | "scrim", "frame": {...}, "z": number }], "imageFrame"?: {...}, "imageBackground"?: boolean }

ENGAGEMENT — these are Instagram FEED posts, read thumb-sized on a phone:
- Make the hero message BIG and impossible to miss. A title frame should fill 55-75% of the width and be tall (h up to 0.34); short-copy covers/statements can go bigger still.
- Give text frames GENEROUS room so type renders LARGE — never pour copy into a cramped box that forces it to shrink into unreadable website-caption sizes. A body/list/quote frame should be roomy in BOTH width (>= 0.7) and height.
- Fill the canvas with intent. Leave breathing room around the focal point, not vast empty zones — a scroll-stopping post uses its space confidently.
- SHORT-COPY slides (cover, cta, statement, quote) must still COMMAND the whole canvas: set the hero line VERY large (title/quote h 0.36-0.52) as the vertical centre of gravity, pair it with a "statement" background, and anchor a bold eyebrow above + the cta/handle below so the composition feels deliberate and full. Never strand a few words in a small frame with a large void above or below — a short punchy line should feel intentional, not empty.

RULES:
- NO copy anywhere — skeletons only; text is poured in later.
- POST purposes, exactly one each: cover, content, list, quote, image-feature, cta.
- STORY purposes, exactly one each: ${STORY_PURPOSES.join(', ')}.
- Execute the brief's signature move on at least the cover and the cta; keep the brief's alignment habits on EVERY layout (but always favour big, legible type over emptiness).
- Vary the anchor across each set (top-weighted, bottom-weighted, side-hugging) while staying recognisably ONE designer's system.
- "list" needs a "list" block with a tall frame (h >= 0.4 post). "cta" anchors a "cta" block near the bottom of the safe area. Include the logo as a decoration where the system wants it (skip if there is no logo). Use "scrim" ONLY over photos.
- DECORATIONS must be ANCHORED to the text they accent — a "rule" or "divider" sits DIRECTLY against a text block (touching it, or within 0.02 of its edge, and roughly matching its x/width). NEVER place a rule/divider floating alone in empty space; a disconnected accent shape reads as a mistake. If a decoration has nothing to sit against, omit it.
- Frames never overlap. An eyebrow is short (h ~0.05-0.07 post); the title is the hero (h 0.18-0.34); paragraphs and lists sit in roomy columns, not thin ones.`;

/** Deterministic generic set — the AI-off / total-failure fallback (still on-brand via colours + fonts). */
export const GENERIC_POST_LAYOUTS: DirectorLayout[] = [
  { name: 'Cover', purpose: 'cover', imageNeed: 'none', backgroundRole: 'statement', blocks: [
    { type: 'eyebrow', frame: { x: 0.1, y: 0.3, w: 0.6, h: 0.05 }, z: 10 },
    { type: 'title', frame: { x: 0.1, y: 0.37, w: 0.8, h: 0.24 }, z: 11 },
  ], decorations: [{ kind: 'logo', frame: { x: 0.1, y: 0.82, w: 0.18, h: 0.06 }, z: 20 }] },
  { name: 'Content', purpose: 'content', imageNeed: 'none', backgroundRole: 'canvas', blocks: [
    { type: 'title', frame: { x: 0.1, y: 0.12, w: 0.8, h: 0.14 }, z: 10 },
    { type: 'paragraph', frame: { x: 0.1, y: 0.3, w: 0.78, h: 0.5 }, z: 11 },
  ] },
  { name: 'List', purpose: 'list', imageNeed: 'none', backgroundRole: 'canvas', blocks: [
    { type: 'title', frame: { x: 0.1, y: 0.1, w: 0.8, h: 0.12 }, z: 10 },
    { type: 'list', frame: { x: 0.1, y: 0.26, w: 0.8, h: 0.55 }, z: 11 },
  ] },
  { name: 'Quote', purpose: 'quote', imageNeed: 'none', backgroundRole: 'texture', blocks: [
    { type: 'quote', frame: { x: 0.1, y: 0.28, w: 0.8, h: 0.34 }, z: 10 },
    { type: 'attribution', frame: { x: 0.1, y: 0.66, w: 0.6, h: 0.06 }, z: 11 },
  ] },
  { name: 'Feature', purpose: 'image-feature', imageNeed: 'upload', backgroundRole: 'canvas', imageFrame: { x: 0.1, y: 0.1, w: 0.8, h: 0.5 }, blocks: [
    { type: 'title', frame: { x: 0.1, y: 0.64, w: 0.8, h: 0.12 }, z: 10 },
    { type: 'caption', frame: { x: 0.1, y: 0.78, w: 0.8, h: 0.06 }, z: 11 },
  ] },
  { name: 'Call to action', purpose: 'cta', imageNeed: 'none', backgroundRole: 'statement', blocks: [
    { type: 'title', frame: { x: 0.1, y: 0.34, w: 0.8, h: 0.16 }, z: 10 },
    { type: 'cta', frame: { x: 0.1, y: 0.54, w: 0.7, h: 0.08 }, z: 11 },
    { type: 'handle', frame: { x: 0.1, y: 0.82, w: 0.5, h: 0.05 }, z: 12 },
  ], decorations: [{ kind: 'logo', frame: { x: 0.72, y: 0.82, w: 0.18, h: 0.06 }, z: 20 }] },
];

export const GENERIC_STORY_LAYOUTS: DirectorLayout[] = [
  { name: 'Cover', purpose: 'cover', imageNeed: 'none', backgroundRole: 'statement', blocks: [
    { type: 'eyebrow', frame: { x: 0.1, y: 0.34, w: 0.6, h: 0.04 }, z: 10 },
    { type: 'title', frame: { x: 0.1, y: 0.4, w: 0.8, h: 0.2 }, z: 11 },
  ] },
  { name: 'Content', purpose: 'content', imageNeed: 'none', backgroundRole: 'canvas', blocks: [
    { type: 'title', frame: { x: 0.1, y: 0.16, w: 0.8, h: 0.12 }, z: 10 },
    { type: 'paragraph', frame: { x: 0.1, y: 0.32, w: 0.78, h: 0.42 }, z: 11 },
  ] },
  { name: 'Quote', purpose: 'quote', imageNeed: 'none', backgroundRole: 'texture', blocks: [
    { type: 'quote', frame: { x: 0.1, y: 0.3, w: 0.8, h: 0.3 }, z: 10 },
    { type: 'attribution', frame: { x: 0.1, y: 0.62, w: 0.6, h: 0.05 }, z: 11 },
  ] },
  { name: 'Call to action', purpose: 'cta', imageNeed: 'none', backgroundRole: 'statement', blocks: [
    { type: 'title', frame: { x: 0.1, y: 0.36, w: 0.8, h: 0.16 }, z: 10 },
    { type: 'cta', frame: { x: 0.1, y: 0.56, w: 0.7, h: 0.07 }, z: 11 },
    { type: 'handle', frame: { x: 0.1, y: 0.8, w: 0.5, h: 0.05 }, z: 12 },
  ] },
];

export async function generateCompositions(
  brief: ArtDirection,
  inp: DirectorInputs,
): Promise<{ post: DirectorLayout[]; story: DirectorLayout[] }> {
  const model = await modelFor('director');
  const system = await loadDirectorPrompt('directorLayoutSystem', DIRECTOR_LAYOUT_SYSTEM);
  const userMsg =
    `Design the composition set for this brand.\n\n` +
    `ART-DIRECTION BRIEF (law):\n${brief.brief}\n\n` +
    `BACKGROUND CONCEPT: ${brief.backgroundConcept}\n` +
    `DO: ${brief.do.join('; ')}\nDON'T: ${brief.dont.join('; ')}\n\n` +
    brandFactLines(inp);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const resp = await aiMessage(
        withOpusReasoning({
          model,
          max_tokens: 16000,
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: userMsg }],
        }),
      );
      await recordUsage({
        feature: 'director:compositions',
        model,
        inputTokens: resp.usage?.input_tokens,
        outputTokens: resp.usage?.output_tokens,
      });
      const { post, story } = extractCompositions(textOf(resp));
      if (post.length) {
        return { post, story: story.length ? story : GENERIC_STORY_LAYOUTS };
      }
    } catch (err) {
      console.warn(`[director] compositions attempt ${attempt} failed:`, err instanceof Error ? err.message : err);
    }
  }
  console.warn('[director] compositions unusable — falling back to the generic layout set');
  return { post: GENERIC_POST_LAYOUTS, story: GENERIC_STORY_LAYOUTS };
}
