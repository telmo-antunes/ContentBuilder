import Anthropic from '@anthropic-ai/sdk';
import { config, aiVisionConfigured } from '../config';
import type { PaletteColor, DomRoles } from './analyze';

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
  provenance: 'computed' | 'vision' | 'heuristic';
}

const ROLES = ['primary', 'secondary', 'accent', 'background', 'text'] as const;
type Role = (typeof ROLES)[number];

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

/**
 * Heuristic role assignment used whenever the vision model is unconfigured or
 * its output fails validation. Deterministic, free.
 */
export function heuristicRoles(palette: PaletteColor[]): RoleAssignment {
  const hexes = palette.map((p) => p.hex);
  const fallback = hexes[0] ?? '#111111';

  // Background: the most populous color (dominant area on the page).
  const background = palette[0]?.hex ?? '#FFFFFF';
  // Text: best contrast against the background.
  const text =
    hexes.slice().sort((a, b) => contrast(background, b) - contrast(background, a))[0] ?? '#111111';
  // Candidates for brand colors: not bg/text, ranked by saturation.
  const branded = palette
    .filter((p) => p.hex !== background && p.hex !== text)
    .sort((a, b) => b.hsl[1] - a.hsl[1]);
  const primary = branded[0]?.hex ?? fallback;
  const accent =
    branded.find((p) => Math.abs(p.hsl[0] - (branded[0]?.hsl[0] ?? 0)) > 25)?.hex ??
    branded[1]?.hex ??
    primary;
  const secondary =
    branded.find((p) => p.hex !== primary && p.hex !== accent)?.hex ?? primary;

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

/** Describe the overall aesthetic in one line (the only thing AI still does for colors). */
async function describeVibe(downscaledBase64: string): Promise<string> {
  if (!aiVisionConfigured()) return '';
  try {
    const client = new Anthropic({ apiKey: config.ai.apiKey });
    const resp = await client.messages.create({
      model: config.ai.model!,
      max_tokens: 120,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: downscaledBase64 } },
            {
              type: 'text',
              text:
                'In one short line, describe this brand\'s visual style ' +
                '(e.g. "minimal, high-contrast, generous whitespace"). Respond with the phrase only, no quotes.',
            },
          ],
        },
      ],
    });
    const part = resp.content.find((c) => c.type === 'text');
    return part && 'text' in part ? part.text.trim().replace(/^["']|["']$/g, '').slice(0, 160) : '';
  } catch (err) {
    console.warn('[vision] vibe call failed:', err instanceof Error ? err.message : err);
    return '';
  }
}

/**
 * Assign brand colors to roles + a style descriptor.
 *
 * When `domRoles` is supplied (colors read from the page's computed styles) those
 * roles are authoritative — accurate and AI-free — and the only AI touch is a
 * one-line vibe descriptor. Without them we fall back to the legacy path: let the
 * vision model pick roles from the screenshot-sampled palette (snapped back to
 * the palette), or the deterministic heuristic when AI is unconfigured/errors.
 */
export async function assignRolesAndVibe(
  palette: PaletteColor[],
  downscaledBase64: string,
  domRoles?: DomRoles,
): Promise<RoleAssignment> {
  // Preferred path: colors from computed styles, AI only for the vibe line.
  if (domRoles) {
    const palHexes = palette.map((p) => p.hex);
    const hexes = palHexes.length > 0 ? palHexes : Object.values(domRoles);
    return {
      colors: { ...domRoles, palette: hexes },
      styleDescriptor: await describeVibe(downscaledBase64),
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
      `Assign brand roles by choosing EXACTLY ONE hex from that list for each of: ` +
      `primary, secondary, accent, background, text. Choose only from the listed hexes — do not invent colors. ` +
      `background = the dominant page surface; text = a color that reads clearly on the background; ` +
      `primary = the main brand color; accent = a secondary highlight; secondary = a supporting color. ` +
      `Also write a one-line styleDescriptor (e.g. "minimal, high-contrast, generous whitespace"). ` +
      `Respond with STRICT JSON only, no prose: ` +
      `{"primary":"#hex","secondary":"#hex","accent":"#hex","background":"#hex","text":"#hex","styleDescriptor":"..."}`;

    const resp = await client.messages.create({
      model: config.ai.model!,
      max_tokens: 400,
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
    const raw = textPart && 'text' in textPart ? textPart.text : '';
    const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));

    const colors = { ...heuristic.colors };
    for (const role of ROLES) {
      const snapped = snapToPalette(String(json[role] ?? ''), hexes);
      if (snapped) colors[role as Role] = snapped;
    }
    const styleDescriptor =
      typeof json.styleDescriptor === 'string' ? json.styleDescriptor.trim().slice(0, 160) : '';

    return { colors, styleDescriptor, provenance: 'vision' };
  } catch (err) {
    console.warn('[vision] role/vibe call failed, using heuristic:', err instanceof Error ? err.message : err);
    return heuristic;
  }
}
