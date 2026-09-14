/**
 * WHY THIS SLIDE LOOKS LIKE THIS — the per-slide decision trace, as data.
 *
 * The audit's `scripts/autopsy.ts` printed the same trace as a markdown
 * table and it was the single most useful instrument in the whole exercise:
 * which path built the slide, which arrangement, which surface, what the
 * code decided on its behalf, what the copywriter said it was doing. This
 * is that trace lifted into a function the Studio can call, so the owner
 * reads it beside the slide instead of asking for a script to be run.
 */
import { GenerationModel, ProjectModel } from '../models';

export interface SlideAutopsy {
  index: number;
  id: string;
  role?: string;
  /** 'fragment' (substituted from the brand's own markup, free) or 'ai' (composed by the model). */
  path?: 'fragment' | 'ai';
  archetype?: string;
  surface?: string;
  align?: string;
  /** Which of the role's arrangements was used, when the recipe has more than one. */
  variant?: number;
  photos: Array<{ placement: string; slot?: string; zoom?: number }>;
  /** The copy parts as the copywriter delivered them. */
  parts?: Record<string, unknown>;
  /** The copywriter's one-line reasoning for this slide. */
  rationale?: string;
  /** Hand-edited since it was composed. */
  edited: boolean;
  /** Decisions the code took on this slide. */
  notes: string[];
  /** Copy the checks still object to. */
  faults: Array<{ label: string; text: string; reason: string }>;
  /** The art director's findings on this slide. */
  critique: Array<{ severity: string; fault: string; fix: string }>;
}

export interface DeckAutopsy {
  projectId: string;
  models?: { parse?: string; compose?: string };
  promptVersions?: Record<string, number>;
  recipe: 'pinned snapshot' | 'live kit';
  fragmentsFor: string[];
  spend?: { spentUsd: number; ceilingUsd: number | null; skipped: string[] };
  critique?: { status?: string; reason?: string; verdict?: string };
  deckNotes: string[];
  slides: SlideAutopsy[];
  /** Counts that say what kind of deck this is at a glance. */
  summary: { fragment: number; ai: number; withPicture: number; forms: number };
}

/** Which arrangement a fragment-substituted slide used: matched against the recipe's variants by skeleton. */
function variantOf(html: string | undefined, variants: string[] | undefined): number | undefined {
  if (!html || !variants?.length || variants.length === 1) return undefined;
  const skeleton = (s: string) => s.replace(/>[^<]*</g, '><').replace(/\s+/g, '').replace(/\{\{[^}]*\}\}/g, '');
  const mine = skeleton(html);
  let best: { i: number; score: number } | undefined;
  variants.forEach((v, i) => {
    const sk = skeleton(v);
    // Cheap similarity: shared class tokens, weighted by rarity across variants.
    const tokens = (x: string) => new Set(x.match(/class="[^"]+"/g) ?? []);
    const a = tokens(mine);
    const b = tokens(sk);
    let score = 0;
    for (const t of a) if (b.has(t)) score += 1;
    score -= Math.abs(a.size - b.size) * 0.5;
    if (!best || score > best.score) best = { i, score };
  });
  return best?.i;
}

export async function autopsyFor(projectId: string): Promise<DeckAutopsy | null> {
  const p = (await ProjectModel.findById(projectId).lean()) as any;
  if (!p) return null;
  const gen = (await GenerationModel.findOne({ projectId: p._id, kind: 'deck' }).sort({ createdAt: -1 }).lean()) as any;
  let recipe: any = p.recipeSnapshot;
  let pinned = Boolean(recipe);
  if (!recipe) {
    const { BrandKitModel } = await import('../models');
    recipe = ((await BrandKitModel.findOne({ businessId: p.businessId, status: 'approved' }).sort({ createdAt: -1 }).lean()) as any)?.recipe;
    pinned = false;
  }
  const fragments: Record<string, string | string[]> = recipe?.fragments ?? {};
  const variantsFor = (role: string | undefined) => {
    const v = role ? fragments[role] : undefined;
    return v === undefined ? undefined : Array.isArray(v) ? v : [v];
  };
  const slides: any[] = p.slides ?? [];
  const notes: Array<{ slide?: number; note: string }> = p.composeNotes ?? [];
  const faults: any[] = Array.isArray(p.copyFaults) ? p.copyFaults : [];
  const findings: any[] = Array.isArray(p.critique?.findings) ? p.critique.findings : [];
  const genSlide = (sid: string) => (gen?.slides ?? []).find((s: any) => s.id === sid);

  const rows: SlideAutopsy[] = slides.map((s, i) => {
    const a = s.authored ?? {};
    const g = genSlide(s.id);
    return {
      index: i,
      id: s.id,
      role: a.role,
      path: a.source ?? g?.path,
      archetype: a.archetype,
      surface: a.surface ?? a.bg,
      align: a.align,
      variant: a.source === 'fragment' ? variantOf(a.html, variantsFor(a.role)) : undefined,
      photos: (s.photos ?? []).map((ph: any) => ({ placement: ph.placement, ...(ph.slot ? { slot: ph.slot } : {}), ...(ph.zoom ? { zoom: ph.zoom } : {}) })),
      parts: g?.parts,
      rationale: s.rationale,
      edited: Boolean(g?.html && a.html && g.html !== a.html),
      notes: notes.filter((n) => n.slide === i + 1).map((n) => n.note),
      faults: faults.filter((f) => f.slide === i).map((f) => ({ label: f.label, text: f.text, reason: f.reason })),
      critique: findings.filter((f) => f.slide === i + 1).map((f) => ({ severity: f.severity, fault: f.fault, fix: f.fix })),
    };
  });
  const forms = new Set(rows.map((r) => `${r.role ?? '?'}:${r.variant ?? 0}:${r.photos.length ? 'p' : ''}`));
  return {
    projectId: String(p._id),
    models: gen?.models,
    promptVersions: gen?.promptVersions ?? p.slides?.[0]?.authored?.pv,
    recipe: pinned ? 'pinned snapshot' : 'live kit',
    fragmentsFor: Object.keys(fragments),
    spend: p.spend ? { spentUsd: Number(p.spend.spentUsd ?? 0), ceilingUsd: p.spend.ceilingUsd ?? null, skipped: p.spend.skipped ?? [] } : undefined,
    critique: p.critique ? { status: p.critique.status, reason: p.critique.reason, verdict: p.critique.verdict } : undefined,
    deckNotes: notes.filter((n) => n.slide === undefined || n.slide === null).map((n) => n.note),
    slides: rows,
    summary: {
      fragment: rows.filter((r) => r.path === 'fragment').length,
      ai: rows.filter((r) => r.path === 'ai').length,
      withPicture: rows.filter((r) => r.photos.length).length,
      forms: forms.size,
    },
  };
}
