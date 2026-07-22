import { z } from 'zod';
import {
  TEMPLATE_COUNT,
  STORY_PURPOSES,
  templateSchema,
  sanitizeSkeleton,
  type BrandTemplate,
} from '../templates';

/**
 * Zod schemas + tolerant parsers for the three director calls. Parsing is
 * defensive (peel prose/fences, repair frames via sanitizeSkeleton, drop invalid
 * items rather than failing the whole pass) so one malformed element never loses
 * an entire brand package.
 */

// ── Art-direction brief ───────────────────────────────────────────────────────
export const briefSchema = z.object({
  brief: z.string().min(80).max(2000),
  backgroundConcept: z.string().min(30).max(1000),
  do: z.array(z.string().min(1).max(160)).min(2).max(10),
  dont: z.array(z.string().min(1).max(160)).min(2).max(10),
});
export type BriefParsed = z.infer<typeof briefSchema>;

export function extractBrief(raw: string): BriefParsed | null {
  const s = raw.indexOf('{');
  const e = raw.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(s, e + 1));
  } catch {
    return null;
  }
  const result = briefSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

// ── Compositions (post + story FreePosition skeletons) ────────────────────────
export const directorLayoutSchema = templateSchema.extend({
  backgroundRole: z.enum(['canvas', 'texture', 'statement']).nullable().optional(),
});
/** A composition skeleton that also carries which background intensity it sits on. */
export type DirectorLayout = z.infer<typeof directorLayoutSchema> & BrandTemplate;

/** Parse the { post: [...], story: [...] } compositions object. */
export function extractCompositions(raw: string): { post: DirectorLayout[]; story: DirectorLayout[] } {
  const s = raw.indexOf('{');
  const e = raw.lastIndexOf('}');
  if (s < 0 || e <= s) return { post: [], story: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(s, e + 1));
  } catch {
    return { post: [], story: [] };
  }
  if (!parsed || typeof parsed !== 'object') return { post: [], story: [] };
  const obj = parsed as { post?: unknown; story?: unknown };
  const take = (arr: unknown, max: number): DirectorLayout[] => {
    if (!Array.isArray(arr)) return [];
    const out: DirectorLayout[] = [];
    for (const item of arr) {
      sanitizeSkeleton(item);
      const r = directorLayoutSchema.safeParse(item);
      if (r.success) out.push(r.data as DirectorLayout);
      if (out.length >= max) break;
    }
    return out;
  };
  return { post: take(obj.post, TEMPLATE_COUNT), story: take(obj.story, STORY_PURPOSES.length) };
}

// ── Background set (three authored SVG variants) ──────────────────────────────
export const backgroundSetSchema = z.object({
  canvas: z.string().min(60),
  texture: z.string().min(60),
  statement: z.string().min(60),
});
export type BackgroundSetRaw = z.infer<typeof backgroundSetSchema>;

/** Parse { canvas, texture, statement } of raw SVG strings (sanitized separately). */
export function extractBackgroundSet(raw: string): BackgroundSetRaw | null {
  const s = raw.indexOf('{');
  const e = raw.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(s, e + 1));
  } catch {
    return null;
  }
  const result = backgroundSetSchema.safeParse(parsed);
  return result.success ? result.data : null;
}
