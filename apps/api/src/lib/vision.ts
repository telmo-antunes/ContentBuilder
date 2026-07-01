import Anthropic from '@anthropic-ai/sdk';
import { config, aiVisionConfigured } from '../config';
import type { PaletteColor, DomRoles } from './analyze';

export type TypePersonality =
  | 'elegant-serif'
  | 'classic-serif'
  | 'editorial-serif'
  | 'bold-condensed'
  | 'impact-display'
  | 'geometric-sans'
  | 'modern-grotesque'
  | 'humanist-sans'
  | 'friendly-rounded'
  | 'clean-neutral';

/**
 * Curated taste table: map a headline's visual *personality* (seen in the
 * screenshot) to a bundled heading/body pairing. This is what makes an editorial
 * brand read as serif and a bold coaching brand read as condensed — instead of
 * everything collapsing to a generic sans via name matching.
 */
const FONT_BY_PERSONALITY: Record<TypePersonality, { heading: string; body: string }> = {
  'elegant-serif': { heading: 'Playfair Display', body: 'Inter' },
  'classic-serif': { heading: 'Merriweather', body: 'Inter' },
  'editorial-serif': { heading: 'Lora', body: 'Inter' },
  'bold-condensed': { heading: 'Oswald', body: 'Inter' },
  'impact-display': { heading: 'Bebas Neue', body: 'Inter' },
  'geometric-sans': { heading: 'Montserrat', body: 'Inter' },
  'modern-grotesque': { heading: 'Archivo', body: 'Inter' },
  'humanist-sans': { heading: 'Work Sans', body: 'Lato' },
  'friendly-rounded': { heading: 'Poppins', body: 'Nunito' },
  'clean-neutral': { heading: 'Inter', body: 'Inter' },
};

export function fontsForPersonality(p: TypePersonality | undefined): { heading: string; body: string } | null {
  return p && FONT_BY_PERSONALITY[p] ? FONT_BY_PERSONALITY[p] : null;
}

export interface RoleAssignment {
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
    palette: string[];
  };
  styleDescriptor: string;
  /** Headline type character seen on the page (drives font selection). */
  typePersonality?: TypePersonality;
  /** Heading/body pairing derived from the type personality (overrides name-matching). */
  fonts?: { heading: string; body: string };
  provenance: 'computed' | 'vision' | 'heuristic';
}

const ROLES = ['primary', 'secondary', 'accent', 'background', 'text'] as const;
type Role = (typeof ROLES)[number];
const PERSONALITIES = Object.keys(FONT_BY_PERSONALITY) as TypePersonality[];

// ── Color math (mirrors the web contrast engine) ─────────────────────────────
function lin(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** HSL saturation 0..1 of a hex. */
function saturation(hex: string): number {
  const [r, g, b] = rgb(hex).map((n) => n / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const l = (max + min) / 2;
  return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}

/**
 * Score an extracted palette so a degraded capture (grey/monochrome, or
 * illegible) can be detected and retried instead of silently shipped. `ok` means
 * there's a genuine, saturated brand colour AND readable text/background contrast.
 */
export function brandColorQuality(colors: {
  primary: string;
  accent: string;
  secondary: string;
  background: string;
  text: string;
}): { score: number; ok: boolean } {
  const brandSat = Math.max(saturation(colors.primary), saturation(colors.accent), saturation(colors.secondary));
  const tc = contrast(colors.text, colors.background);
  const ok = brandSat >= 0.28 && tc >= 3;
  return { score: brandSat * 3 + Math.min(tc, 12) / 4, ok };
}

/** Heuristic role assignment used whenever the vision model is unconfigured or fails. */
export function heuristicRoles(palette: PaletteColor[]): RoleAssignment {
  const hexes = palette.map((p) => p.hex);
  const fallback = hexes[0] ?? '#111111';
  const background = palette[0]?.hex ?? '#FFFFFF';
  const text = hexes.slice().sort((a, b) => contrast(background, b) - contrast(background, a))[0] ?? '#111111';
  const branded = palette.filter((p) => p.hex !== background && p.hex !== text).sort((a, b) => b.hsl[1] - a.hsl[1]);
  const primary = branded[0]?.hex ?? fallback;
  const accent =
    branded.find((p) => Math.abs(p.hsl[0] - (branded[0]?.hsl[0] ?? 0)) > 25)?.hex ?? branded[1]?.hex ?? primary;
  const secondary = branded.find((p) => p.hex !== primary && p.hex !== accent)?.hex ?? primary;
  return {
    colors: { primary, secondary, accent, background, text, palette: hexes },
    styleDescriptor: '',
    provenance: 'heuristic',
  };
}

/** Snap a model-returned hex to the nearest sampled palette hex (Euclidean RGB). */
function snapToPalette(hex: string, palette: string[]): string | null {
  if (!/^#?[0-9a-fA-F]{6}$/.test(hex)) return null;
  const norm = (hex.startsWith('#') ? hex : `#${hex}`).toUpperCase();
  if (palette.includes(norm)) return norm;
  const [r, g, b] = rgb(norm);
  let best: { hex: string; d: number } | null = null;
  for (const p of palette) {
    const [pr, pg, pb] = rgb(p);
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (!best || d < best.d) best = { hex: p, d };
  }
  return best?.hex ?? null;
}

/** The stronger model when configured — brand identity is once-per-business, so spend on it. */
function visionModel(): string {
  return config.ai.modelLarge ?? config.ai.model!;
}
function parseJson(raw: string): Record<string, unknown> | null {
  try {
    const s = raw.indexOf('{');
    const e = raw.lastIndexOf('}');
    if (s < 0 || e < 0) return null;
    return JSON.parse(raw.slice(s, e + 1));
  } catch {
    return null;
  }
}

/**
 * Vision pass: from the screenshot, read the brand's *type personality* and a
 * vivid style descriptor. Grounded in the actual pixels (the whole point) and run
 * on the larger model since it's once per business.
 */
async function readTypeAndVibe(base64: string): Promise<{ styleDescriptor: string; typePersonality?: TypePersonality }> {
  if (!aiVisionConfigured()) return { styleDescriptor: '' };
  try {
    const client = new Anthropic({ apiKey: config.ai.apiKey });
    const prompt =
      `Look at this brand's homepage. Judge it by what you SEE — especially the HEADLINE typography and overall mood.\n\n` +
      `Return STRICT JSON only, no prose:\n` +
      `{"typePersonality": one of ${JSON.stringify(PERSONALITIES)}, "styleDescriptor": "one vivid sentence capturing the brand's visual identity — mood, contrast, era, feel"}\n\n` +
      `typePersonality guide (base it on the headlines): high-contrast/elegant serif → "elegant-serif"; traditional book serif → "classic-serif"; magazine serif → "editorial-serif"; heavy CONDENSED / tall all-caps → "bold-condensed"; poster/ultra-bold display → "impact-display"; clean geometric sans → "geometric-sans"; technical modern grotesque → "modern-grotesque"; warm humanist sans → "humanist-sans"; soft rounded sans → "friendly-rounded"; plain neutral UI sans → "clean-neutral".`;
    const resp = await client.messages.create({
      model: visionModel(),
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });
    const part = resp.content.find((c) => c.type === 'text');
    const json = parseJson(part && 'text' in part ? part.text : '') ?? {};
    const tp = PERSONALITIES.includes(json.typePersonality as TypePersonality) ? (json.typePersonality as TypePersonality) : undefined;
    const desc = typeof json.styleDescriptor === 'string' ? json.styleDescriptor.trim().slice(0, 200) : '';
    return { styleDescriptor: desc, typePersonality: tp };
  } catch (err) {
    console.warn('[vision] type/vibe call failed:', err instanceof Error ? err.message : err);
    return { styleDescriptor: '' };
  }
}

/**
 * Assign brand colors to roles + a style descriptor + type-personality-driven fonts.
 *
 * When `domRoles` is supplied those roles are authoritative (accurate, from the
 * page's computed styles). Either way the vision pass reads the type personality
 * from the screenshot and maps it to a bundled font pairing.
 */
export async function assignRolesAndVibe(
  palette: PaletteColor[],
  downscaledBase64: string,
  domRoles?: DomRoles,
): Promise<RoleAssignment> {
  if (domRoles) {
    const palHexes = palette.map((p) => p.hex);
    const hexes = palHexes.length > 0 ? palHexes : Object.values(domRoles);
    const { styleDescriptor, typePersonality } = await readTypeAndVibe(downscaledBase64);
    return {
      colors: { ...domRoles, palette: hexes },
      styleDescriptor,
      typePersonality,
      fonts: fontsForPersonality(typePersonality) ?? undefined,
      provenance: 'computed',
    };
  }

  const heuristic = heuristicRoles(palette);
  if (!aiVisionConfigured() || palette.length === 0) return heuristic;

  const hexes = palette.map((p) => p.hex);
  try {
    const client = new Anthropic({ apiKey: config.ai.apiKey });
    const prompt =
      `These colors were pixel-sampled from the attached homepage screenshot:\n${hexes.join(', ')}\n\n` +
      `Assign brand roles by choosing EXACTLY ONE hex from that list for each of primary, secondary, accent, background, text ` +
      `(background = dominant surface; text = reads clearly on background; primary = main brand color; accent = highlight; secondary = supporting). ` +
      `Also judge the HEADLINE typePersonality (one of ${JSON.stringify(PERSONALITIES)}) and write one vivid styleDescriptor sentence.\n\n` +
      `STRICT JSON only: {"primary":"#hex","secondary":"#hex","accent":"#hex","background":"#hex","text":"#hex","typePersonality":"...","styleDescriptor":"..."}`;
    const resp = await client.messages.create({
      model: visionModel(),
      max_tokens: 600,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: downscaledBase64 } },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });
    const textPart = resp.content.find((c) => c.type === 'text');
    const json = parseJson(textPart && 'text' in textPart ? textPart.text : '');
    if (!json) return heuristic;

    const colors = { ...heuristic.colors };
    for (const role of ROLES) {
      const snapped = snapToPalette(String(json[role] ?? ''), hexes);
      if (snapped) colors[role as Role] = snapped;
    }
    const typePersonality = PERSONALITIES.includes(json.typePersonality as TypePersonality)
      ? (json.typePersonality as TypePersonality)
      : undefined;
    const styleDescriptor = typeof json.styleDescriptor === 'string' ? json.styleDescriptor.trim().slice(0, 200) : '';

    return { colors, styleDescriptor, typePersonality, fonts: fontsForPersonality(typePersonality) ?? undefined, provenance: 'vision' };
  } catch (err) {
    console.warn('[vision] role/vibe call failed, using heuristic:', err instanceof Error ? err.message : err);
    return heuristic;
  }
}
