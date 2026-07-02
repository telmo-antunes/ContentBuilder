import { randomUUID } from 'node:crypto';
import type { CampaignConcept } from '@contentbuilder/shared';
import { aiDraftConfigured } from '../config';
import { aiMessage, premiumModel, textOf } from './ai';
import { recordUsage } from './usage';

interface PlanContext {
  brief: string;
  count: number;
  businessName?: string;
  voice?: string;
  styleDescriptor?: string;
  profile?: { category?: string; offer?: string; audience?: string; goal?: string; tone?: string[] };
  goal?: string;
}

const MAX_CONCEPTS = 12;

function parseArray(raw: string): unknown[] | null {
  const s = raw.indexOf('[');
  const e = raw.lastIndexOf(']');
  if (s < 0 || e < 0) return null;
  try {
    const parsed = JSON.parse(raw.slice(s, e + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Pure parse of a model's JSON reply into validated concepts (drops malformed
 * entries, caps at `count`). `idFor` supplies concept ids so this stays testable.
 */
export function parseConcepts(raw: string, count: number, idFor: () => string): CampaignConcept[] {
  const arr = parseArray(raw) ?? [];
  const concepts: CampaignConcept[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const it = item as Record<string, unknown>;
    const title = typeof it.title === 'string' ? it.title.trim().slice(0, 120) : '';
    const paragraph = typeof it.paragraph === 'string' ? it.paragraph.trim().slice(0, 2000) : '';
    if (!title || !paragraph) continue;
    concepts.push({
      id: idFor(),
      title,
      angle: typeof it.angle === 'string' ? it.angle.trim().slice(0, 200) : '',
      paragraph,
    });
    if (concepts.length >= count) break;
  }
  return concepts;
}

/**
 * Plan a themed content series: turn a brief into N distinct post concepts, each
 * with a title, an angle, and a paragraph ready to feed the draft engine. This is
 * the cheap step — no slides are drafted here; the user drafts each concept on
 * demand. Grounded in the brand voice + profile so the arc feels coherent.
 */
export async function planCampaign(ctx: PlanContext): Promise<CampaignConcept[]> {
  if (!aiDraftConfigured()) return [];
  const count = Math.max(1, Math.min(ctx.count || 5, MAX_CONCEPTS));
  const p = ctx.profile ?? {};
  const prompt =
    `Plan a themed Instagram content series of ${count} posts.\n\n` +
    `Campaign brief: ${ctx.brief}\n` +
    (ctx.businessName ? `Business: ${ctx.businessName}\n` : '') +
    (p.category ? `Category: ${p.category}\n` : '') +
    (p.offer ? `What they offer: ${p.offer}\n` : '') +
    (p.audience ? `Audience: ${p.audience}\n` : '') +
    (ctx.goal || p.goal ? `Goal: ${ctx.goal || p.goal}\n` : '') +
    (ctx.voice ? `Brand voice (match it): ${ctx.voice}\n` : '') +
    (p.tone?.length ? `Tone tags: ${p.tone.join(', ')}\n` : '') +
    `\nProduce exactly ${count} DISTINCT posts that together form a coherent arc (no repeats, varied angles). ` +
    `For each: a short "title" (working title), a one-line "angle" (the hook/perspective), and a "paragraph" ` +
    `— 2–4 sentences of real, on-brand copy that a designer could lay out onto slides (this is the actual post copy, not a description of it).\n\n` +
    `Return STRICT JSON only: [{"title": "...", "angle": "...", "paragraph": "..."}, ...]`;

  // Premium tier: the series arc is the creative heart of a campaign — the
  // concepts it produces get amplified through N drafts downstream.
  const model = premiumModel();
  const resp = await aiMessage({
    model,
    max_tokens: 6000, // roomy: Fable-family thinking bills against max_tokens
    messages: [{ role: 'user', content: prompt }],
  });
  await recordUsage({
    feature: 'campaign-plan',
    model,
    inputTokens: resp.usage?.input_tokens,
    outputTokens: resp.usage?.output_tokens,
  });

  return parseConcepts(textOf(resp), count, randomUUID);
}
