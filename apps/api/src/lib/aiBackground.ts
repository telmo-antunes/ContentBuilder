import Anthropic from '@anthropic-ai/sdk';
import { categoryLabel, renderMotif, MOTIF_CATALOG, type BgColors } from '@contentbuilder/shared';
import type { BusinessCategory } from '@contentbuilder/shared';
import { config, aiDraftConfigured } from '../config';

export interface AiBgOptions {
  category?: BusinessCategory;
  tone?: string[];
  /** The brand's aesthetic descriptor — the strongest brand-fit signal. */
  styleDescriptor?: string;
  businessName?: string;
  /** Rotates through the ranked picks so successive backgrounds differ. */
  variant?: number;
}

const IDS = MOTIF_CATALOG.map((m) => m.id);

/**
 * Hybrid background: the model CHOOSES from a menu of vetted, brand-safe motif
 * recipes (given full brand context) and code renders the chosen one. This
 * replaces asking a small model to freehand SVG — the old path that produced
 * samey, off-brand, sometimes-broken results. Output is always a clean,
 * on-brand, legible SVG; the only thing the AI does is exercise taste in
 * *selection*, which is what it's good at.
 */
export async function generateAiBackground(colors: BgColors, opts: AiBgOptions = {}): Promise<string | null> {
  const ranked = await rankMotifs(colors, opts);
  const motif = ranked[(opts.variant ?? 0) % ranked.length] ?? ranked[0] ?? 'mesh';
  // Random seed → even the same motif varies in placement between generations.
  const seed = Math.floor(Math.random() * 1_000_000_000);
  const bg = renderMotif(motif, colors, { tone: opts.tone, seed });
  return bg?.svg ?? null;
}

/** Ask the model to rank the best-fitting motifs; fall back to a shuffle if AI is off. */
async function rankMotifs(colors: BgColors, opts: AiBgOptions): Promise<string[]> {
  const shuffled = () => {
    const a = [...IDS];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  };
  if (!aiDraftConfigured()) return shuffled();
  try {
    const menu = MOTIF_CATALOG.map((m) => `- ${m.id}: ${m.desc}`).join('\n');
    const prompt =
      `Choose background motifs for a SUBTLE, on-brand social-post background (it sits behind text).\n\n` +
      `Brand: ${opts.businessName || 'this brand'} — ${categoryLabel(opts.category ?? 'other')}.\n` +
      `Aesthetic: ${opts.styleDescriptor || (opts.tone ?? []).join(', ') || 'clean, modern'}.\n` +
      `Palette dominant: ${colors.background} with ${colors.primary}/${colors.accent} accents.\n\n` +
      `Menu:\n${menu}\n\n` +
      `Rank the FOUR that best fit this brand, best first. Return STRICT JSON only: {"motifs":["id","id","id","id"]}`;
    const client = new Anthropic({ apiKey: config.ai.apiKey });
    const resp = await client.messages.create({
      model: config.ai.modelSmall!, // cheap — it's a menu pick, not SVG generation
      max_tokens: 120,
      messages: [{ role: 'user', content: prompt }],
    });
    const part = resp.content.find((c) => c.type === 'text');
    const raw = part && 'text' in part ? part.text : '';
    const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    const picked = Array.isArray(json.motifs) ? json.motifs.filter((m: unknown) => IDS.includes(m as string)) : [];
    return picked.length ? [...new Set([...picked, ...shuffled()])] : shuffled();
  } catch (err) {
    console.warn('[aiBackground] motif rank failed:', err instanceof Error ? err.message : err);
    return shuffled();
  }
}
