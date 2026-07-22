import type Anthropic from '@anthropic-ai/sdk';
import {
  FORMAT_DIMENSIONS,
  safeAreaFor,
  type ArtDirection,
  type BackgroundRole,
  type BlockFrame,
  type BrandKit,
  type BrandLayout,
  type Format,
  type LayoutLibrary,
  type MediaAsset,
} from '@contentbuilder/shared';
import { aiMessage, modelFor, textOf } from '../ai';
import { recordUsage } from '../usage';
import { getBrowser } from '../browser';
import { shootComposition } from '../renderPreview';

/**
 * The visual feedback loop — the "sight" principle. For each format set: render
 * every composition with sample copy, hand the PNGs to a Sonnet vision judge, and
 * apply a SMALL, deterministic, clamped set of fixes (nudge / resize / calmer
 * background). Ground-truth overflow comes from the render, not the model.
 * Bounded (one round, one vision call per set, wall-clock budget) and best-effort
 * — a web-down / AI-off environment simply skips it and ships the package as-is.
 */

const ROLES: BackgroundRole[] = ['canvas', 'texture', 'statement'];
/** Calmer-ward ordering so a "background fights the text" verdict steps DOWN in intensity. */
const CALMER: Record<BackgroundRole, BackgroundRole> = { statement: 'texture', texture: 'canvas', canvas: 'canvas' };

export interface CompositionFix {
  op: 'nudge' | 'resize' | 'backgroundRole';
  block?: number;
  dx?: number;
  dy?: number;
  dw?: number;
  dh?: number;
  role?: BackgroundRole;
}

export interface CompositionVerdict {
  index: number;
  score: number; // 1-10
  backgroundFights?: boolean;
  /** The composition leaves large empty areas — the hero should grow to fill. */
  sparse?: boolean;
  fixes: CompositionFix[];
  note?: string;
}

const clampNum = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function coerceFix(raw: unknown): CompositionFix | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Record<string, unknown>;
  if (f.op === 'nudge') return { op: 'nudge', block: num(f.block), dx: clampNum(num(f.dx), -0.05, 0.05), dy: clampNum(num(f.dy), -0.05, 0.05) };
  if (f.op === 'resize') return { op: 'resize', block: num(f.block), dw: clampNum(num(f.dw), -0.1, 0.1), dh: clampNum(num(f.dh), -0.1, 0.1) };
  if (f.op === 'backgroundRole' && ROLES.includes(f.role as BackgroundRole)) return { op: 'backgroundRole', role: f.role as BackgroundRole };
  return null;
}

/** Parse the model's verdict array into a slot-per-composition array (pure). */
export function parseVerdicts(raw: string, n: number): Array<CompositionVerdict | null> {
  const out: Array<CompositionVerdict | null> = Array(n).fill(null);
  const s = raw.indexOf('[');
  const e = raw.lastIndexOf(']');
  if (s < 0 || e <= s) return out;
  let arr: unknown;
  try {
    arr = JSON.parse(raw.slice(s, e + 1));
  } catch {
    return out;
  }
  if (!Array.isArray(arr)) return out;
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const it = item as Record<string, unknown>;
    const idx = num(it.index, -1);
    if (!Number.isInteger(idx) || idx < 0 || idx >= n) continue;
    const fixes = Array.isArray(it.fixes) ? (it.fixes.map(coerceFix).filter(Boolean) as CompositionFix[]) : [];
    out[idx] = {
      index: idx,
      score: it.score != null ? clampNum(num(it.score, 5), 1, 10) : 5,
      backgroundFights: Boolean(it.backgroundFights),
      sparse: Boolean(it.sparse),
      fixes,
      note: typeof it.note === 'string' ? it.note.slice(0, 200) : undefined,
    };
  }
  return out;
}

function safeBounds(format: Format) {
  const { width, height } = FORMAT_DIMENSIONS[format];
  const type = format === '1080x1920' ? 'story' : 'carousel';
  const safe = safeAreaFor(type);
  return {
    xMin: safe.padding / width,
    xMax: 1 - safe.padding / width,
    yMin: (safe.topReserve || safe.padding) / height,
    yMax: 1 - (safe.bottomReserve || safe.padding) / height,
  };
}

function clampFrame(f: BlockFrame, b: ReturnType<typeof safeBounds>): BlockFrame {
  const w = clampNum(f.w, 0.05, b.xMax - b.xMin);
  const h = clampNum(f.h, 0.03, b.yMax - b.yMin);
  const x = clampNum(f.x, b.xMin, b.xMax - w);
  const y = clampNum(f.y, b.yMin, b.yMax - h);
  return { x, y, w, h };
}

/**
 * Apply the verdict's bounded fixes + an overflow-driven frame-grow to a layout.
 * Pure, deterministic, always clamped to the safe area. Returns the (possibly
 * unchanged) layout, whether anything changed, and the new background role.
 */
export function applyBoundedFixes(
  layout: BrandLayout,
  verdict: CompositionVerdict | null,
  overflow: boolean,
  format: Format,
): { layout: BrandLayout; changed: boolean; newRole?: BackgroundRole } {
  const b = safeBounds(format);
  const blocks = layout.blocks.map((bl) => ({ ...bl, frame: { ...bl.frame } }));
  let changed = false;
  let newRole = layout.backgroundRole;

  for (const fix of verdict?.fixes ?? []) {
    if ((fix.op === 'nudge' || fix.op === 'resize') && typeof fix.block === 'number') {
      const bl = blocks[fix.block];
      if (!bl) continue;
      const fr = bl.frame;
      bl.frame =
        fix.op === 'nudge'
          ? clampFrame({ ...fr, x: fr.x + (fix.dx ?? 0), y: fr.y + (fix.dy ?? 0) }, b)
          : clampFrame({ ...fr, w: fr.w + (fix.dw ?? 0), h: fr.h + (fix.dh ?? 0) }, b);
      changed = true;
    } else if (fix.op === 'backgroundRole' && fix.role && fix.role !== newRole) {
      newRole = fix.role;
      changed = true;
    }
  }

  // A "background fights the text" verdict steps the intensity down one notch —
  // but ONLY on text-heavy slides. Short-copy heroes (cover/cta/statement/quote)
  // are designed around a bold background + a clear zone, so calming them just
  // makes them look empty; keep their statement background.
  const textHeavy = layout.purpose === 'content' || layout.purpose === 'list';
  if (verdict?.backgroundFights && newRole && textHeavy) {
    const calmer = CALMER[newRole];
    if (calmer !== newRole) {
      newRole = calmer;
      changed = true;
    }
  }

  // Too-empty slide → enlarge the hero (tallest) block so type fills the space.
  if (verdict?.sparse && blocks.length) {
    let idx = 0;
    for (let i = 1; i < blocks.length; i++) if (blocks[i]!.frame.h > blocks[idx]!.frame.h) idx = i;
    const fr = blocks[idx]!.frame;
    blocks[idx]!.frame = clampFrame({ ...fr, w: Math.max(fr.w, 0.82), h: fr.h + 0.08 }, b);
    changed = true;
  }

  // Ground-truth overflow → grow the tallest block a touch (still clamped).
  if (overflow && blocks.length) {
    let idx = 0;
    for (let i = 1; i < blocks.length; i++) if (blocks[i]!.frame.h > blocks[idx]!.frame.h) idx = i;
    const fr = blocks[idx]!.frame;
    blocks[idx]!.frame = clampFrame({ ...fr, h: fr.h + 0.06 }, b);
    changed = true;
  }

  return { layout: { ...layout, blocks, backgroundRole: newRole }, changed, newRole };
}

export const CRITIQUE_SYSTEM = `You are a design critic reviewing a brand's Instagram compositions against its art-direction brief. You are shown the compositions as images, in order (composition 0 is the first image, 1 the second, and so on), each filled with placeholder sample copy.

For EACH composition, judge: legibility of text over its background, visual hierarchy and balance, whether the background competes with the copy, whether it leaves large EMPTY areas (too sparse for a scroll-stopping feed post), and adherence to the brief. Then propose a FEW small, safe fixes — never a redesign.

OUTPUT: ONLY a JSON array (no prose, no code fences), one object per composition you want to change (omit ones that are already good):
[{ "index": number, "score": 1-10, "backgroundFights": boolean, "sparse": boolean, "fixes": [ ... ], "note": "one short reason" }]
Set "sparse": true when the slide has a lot of dead space and its hero could be larger — the hero block will be enlarged to fill.

Allowed fixes (values are FRACTIONS of the canvas; keep them small):
- { "op": "nudge", "block": <block index>, "dx": -0.05..0.05, "dy": -0.05..0.05 }  — move a text block
- { "op": "resize", "block": <block index>, "dw": -0.10..0.10, "dh": -0.10..0.10 } — grow/shrink a text block
- { "op": "backgroundRole", "role": "canvas" | "texture" | "statement" }             — swap to a calmer/bolder background

Set "backgroundFights": true when the background reduces text legibility. Prefer nudges and resizes over anything drastic. Do not invent block indices that don't exist.`;

/** Reconstruct role → background asset id from a set's layouts. */
function roleAssetMap(layouts: BrandLayout[]): Partial<Record<BackgroundRole, string>> {
  const map: Partial<Record<BackgroundRole, string>> = {};
  for (const l of layouts) if (l.backgroundRole && l.backgroundMediaAssetId) map[l.backgroundRole] = l.backgroundMediaAssetId;
  return map;
}

interface RefineDeps {
  brief: ArtDirection;
  kit: Partial<BrandKit> | null;
  media: MediaAsset[];
  deadline: number; // epoch ms budget
}

/** Refine one format set: render → one vision critique → bounded fixes → keep-best. */
async function refineSet(layouts: BrandLayout[], format: Format, deps: RefineDeps): Promise<BrandLayout[]> {
  if (!layouts.length || Date.now() > deps.deadline) return layouts;
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    const idByRole = roleAssetMap(layouts);
    // 1) render every candidate with sample copy.
    const shots: Array<{ overflow: boolean; base64: string } | null> = [];
    for (const layout of layouts) {
      if (Date.now() > deps.deadline) shots.push(null);
      else shots.push(await shootComposition(page, { layout, format, kit: deps.kit, media: deps.media }));
    }
    const rendered = shots.map((s, i) => ({ i, s })).filter((x) => x.s);
    if (!rendered.length) return layouts;

    // 2) ONE vision call for the whole set.
    const model = await modelFor('critique');
    const content: Anthropic.ContentBlockParam[] = rendered.map((x) => ({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: x.s!.base64 },
    }));
    content.push({
      type: 'text',
      text: `ART-DIRECTION BRIEF:\n${deps.brief.brief}\n\nThere are ${rendered.length} compositions (indices ${rendered.map((x) => x.i).join(', ')}). Critique each and return the JSON array.`,
    });
    const verdicts: Array<CompositionVerdict | null> = Array(layouts.length).fill(null);
    try {
      const resp = await aiMessage({ model, max_tokens: 4000, system: CRITIQUE_SYSTEM, messages: [{ role: 'user', content }] });
      await recordUsage({ feature: `director:critique:${format}`, model, inputTokens: resp.usage?.input_tokens, outputTokens: resp.usage?.output_tokens });
      // Map the returned indices (which are positions among RENDERED items) back to layout indices.
      const parsed = parseVerdicts(textOf(resp), rendered.length);
      parsed.forEach((v, pos) => {
        const layoutIdx = rendered[pos]?.i;
        if (v && layoutIdx != null) verdicts[layoutIdx] = { ...v, index: layoutIdx };
      });
    } catch (err) {
      console.warn('[director] critique call failed — keeping compositions as-is:', err instanceof Error ? err.message : err);
      return layouts;
    }

    // 3) apply bounded fixes + keep-best (revert a change that introduces overflow).
    const out = [...layouts];
    for (let i = 0; i < layouts.length; i++) {
      const original = layouts[i]!;
      const overflow = Boolean(shots[i]?.overflow);
      const { layout: fixed, changed, newRole } = applyBoundedFixes(original, verdicts[i] ?? null, overflow, format);
      if (!changed) continue;
      if (newRole && newRole !== original.backgroundRole && idByRole[newRole]) {
        fixed.backgroundMediaAssetId = idByRole[newRole];
      }
      // keep-best: re-render the changed candidate; revert if it now overflows (and didn't before).
      if (Date.now() <= deps.deadline) {
        const reshot = await shootComposition(page, { layout: fixed, format, kit: deps.kit, media: deps.media });
        if (reshot && reshot.overflow && !overflow) continue; // reject the change
      }
      out[i] = fixed;
    }
    return out;
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Run the feedback loop over a whole library (post + story). Best-effort: returns
 * the input library unchanged if rendering/critique isn't available. Bounded by a
 * wall-clock budget so it can never stall package generation.
 */
export async function refineLibrary(
  library: LayoutLibrary,
  brief: ArtDirection,
  kit: Partial<BrandKit> | null,
  media: MediaAsset[],
  budgetMs = 120_000,
): Promise<LayoutLibrary> {
  const deadline = Date.now() + budgetMs;
  try {
    const deps: RefineDeps = { brief, kit, media, deadline };
    const post = await refineSet(library.post, '1080x1350', deps);
    const story = await refineSet(library.story, '1080x1920', deps);
    return { ...library, post, story };
  } catch (err) {
    console.warn('[director] feedback loop skipped:', err instanceof Error ? err.message : err);
    return library;
  }
}
