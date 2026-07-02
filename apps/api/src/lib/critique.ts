import {
  FORMAT_DIMENSIONS,
  safeAreaFor,
  isFreeLayout,
  type AssetType,
  type Format,
  type ThemePreset,
} from '@contentbuilder/shared';
import { config, aiVisionConfigured } from '../config';
import { aiMessage, textOf } from './ai';
import { getBrowser } from './browser';
import { recordUsage } from './usage';

const THEMES: ThemePreset[] = ['editorial', 'bold', 'minimal', 'soft'];
const TREATMENTS = ['none', 'tint', 'duotone'] as const;

export interface CritiqueReport {
  slideId: string;
  order: number;
  /** Human-readable problems detected. */
  issues: string[];
  /** What the fixer changed (empty = nothing changed). */
  applied: string[];
}

interface SlideShot {
  overflow: boolean;
  base64: string;
}

export interface VisionCritique {
  contrastPoor?: boolean;
  crowded?: boolean;
  unbalanced?: boolean;
  theme?: ThemePreset;
  imageTreatment?: (typeof TREATMENTS)[number];
}

type Slide = Record<string, any>;

/** Render one slide via the hidden /render route; read ground-truth overflow + a PNG. */
async function shootSlide(
  page: any,
  base: string,
  projectId: string,
  slideId: string,
): Promise<SlideShot> {
  const url = `${base}/render?projectId=${projectId}&slideId=${encodeURIComponent(slideId)}`;
  await page.goto(url, { waitUntil: 'load', timeout: 45000 });
  await page.evaluate(async () => {
    const doc = (globalThis as { document?: any }).document;
    if (doc?.fonts?.ready) await doc.fonts.ready;
    const imgs: any[] = Array.from(doc?.images ?? []);
    await Promise.all(
      imgs.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise((res) => {
              img.onload = () => res(null);
              img.onerror = () => res(null);
            }),
      ),
    );
  });
  await new Promise((r) => setTimeout(r, 400)); // let the text-fit pass settle + publish data-overflow
  const overflow = await page.evaluate(
    () => (globalThis as { document?: any }).document?.body?.dataset?.overflow === 'true',
  );
  const el = await page.$('[data-slide-root]');
  const shot = el ? await el.screenshot({ type: 'png' }) : await page.screenshot({ type: 'png' });
  return { overflow: Boolean(overflow), base64: Buffer.from(shot).toString('base64') };
}

/** Coerce one model-returned verdict object into a validated VisionCritique. */
export function parseCritiqueVerdict(raw: unknown): VisionCritique | null {
  if (!raw || typeof raw !== 'object') return null;
  const json = raw as Record<string, unknown>;
  const theme = THEMES.includes(json.theme as ThemePreset) ? (json.theme as ThemePreset) : undefined;
  const imageTreatment = TREATMENTS.includes(json.imageTreatment as (typeof TREATMENTS)[number])
    ? (json.imageTreatment as (typeof TREATMENTS)[number])
    : undefined;
  return {
    contrastPoor: Boolean(json.contrastPoor),
    crowded: Boolean(json.crowded),
    unbalanced: Boolean(json.unbalanced),
    theme,
    imageTreatment,
  };
}

/**
 * Judge ALL slides of a post in ONE multi-image vision call. Besides being ~N×
 * cheaper than per-slide calls, seeing the whole set lets the model judge what
 * per-slide critique structurally can't: cross-slide consistency (a slide whose
 * theme breaks the set's rhythm gets flagged relative to its siblings).
 * Returns one verdict per input slide (null = no judgement for that slide).
 */
async function visionCritiqueBatch(
  shots: Array<{ base64: string; theme: ThemePreset }>,
): Promise<Array<VisionCritique | null>> {
  if (!aiVisionConfigured() || shots.length === 0) return shots.map(() => null);
  try {
    const model = config.ai.modelLarge ?? config.ai.model!;
    const prompt =
      `These are the ${shots.length} slides of ONE social post, in order (current themes: ${shots
        .map((s, i) => `#${i + 1}=${s.theme}`)
        .join(', ')}). Judge each as a designer for LEGIBILITY and COMPOSITION only — not the wording — ` +
      `AND judge the set as a whole: a slide that visibly breaks the set's consistency counts as "unbalanced".\n\n` +
      `Return STRICT JSON only — an array with EXACTLY ${shots.length} elements, one per slide in order:\n` +
      `[{"contrastPoor": bool (text hard to read against its background), "crowded": bool (elements cramped/too dense), ` +
      `"unbalanced": bool (weighting/whitespace off, or inconsistent with the rest of the set), ` +
      `"theme": one of ${JSON.stringify(THEMES)} or null (a theme that would read better, else null), ` +
      `"imageTreatment": one of ${JSON.stringify(TREATMENTS)} or null (only if a photo is hurting legibility), "note": string}, ...]`;
    const resp = await aiMessage({
      model,
      // Roomy: scales with slide count; Fable-family thinking bills against it.
      max_tokens: Math.min(1500 + shots.length * 400, 6000),
      messages: [
        {
          role: 'user',
          content: [
            ...shots.map((s) => ({
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: 'image/png' as const, data: s.base64 },
            })),
            { type: 'text' as const, text: prompt },
          ],
        },
      ],
    });
    await recordUsage({
      feature: 'critique',
      model,
      inputTokens: resp.usage?.input_tokens,
      outputTokens: resp.usage?.output_tokens,
    });
    const raw = textOf(resp);
    const s = raw.indexOf('[');
    const e = raw.lastIndexOf(']');
    const arr = s >= 0 && e > s ? (JSON.parse(raw.slice(s, e + 1)) as unknown[]) : [];
    if (!Array.isArray(arr)) return shots.map(() => null);
    return shots.map((_, i) => parseCritiqueVerdict(arr[i]));
  } catch (err) {
    console.warn('[critique] vision call failed:', err instanceof Error ? err.message : err);
    return shots.map(() => null);
  }
}

/**
 * Apply bounded, safe fixes to a slide IN PLACE. Returns issues found + changes made.
 * - overflow (objective): on FreePosition, grow the text frames within the safe area —
 *   more room can only *help* the fit, never worsen it. Preset layouts can't grow a
 *   frame, so overflow there is flagged, not auto-fixed.
 * - contrast/crowding (vision): swap the per-slide theme and/or image treatment.
 * Never touches copy.
 */
export function applyFixes(
  slide: Slide,
  overflow: boolean,
  critique: VisionCritique | null,
  type: AssetType,
  format: Format,
): { issues: string[]; applied: string[] } {
  const issues: string[] = [];
  const applied: string[] = [];
  const overrides = { ...(slide.overrides ?? {}) };
  const currentTheme: ThemePreset = overrides.theme ?? 'editorial';

  if (overflow) {
    issues.push('text overflow');
    if (isFreeLayout(slide.layoutType) && Array.isArray(slide.blocks)) {
      const { height } = FORMAT_DIMENSIONS[format];
      const safe = safeAreaFor(type);
      const yMax = 1 - (safe.bottomReserve / height || safe.padding / height);
      let grew = false;
      for (const b of slide.blocks) {
        const f = b?.frame;
        if (!f || typeof f.h !== 'number') continue;
        const target = Math.min(f.h * 1.3, 0.92);
        const capped = f.y + target > yMax ? Math.max(f.h, yMax - f.y) : target;
        if (capped > f.h + 0.001) {
          f.h = +capped.toFixed(4);
          grew = true;
        }
      }
      if (grew) applied.push('enlarged text frames');
    }
  }

  if (critique) {
    if (critique.contrastPoor) issues.push('low contrast');
    if (critique.crowded) issues.push('crowded');
    if (critique.unbalanced) issues.push('unbalanced');
    if ((critique.contrastPoor || critique.crowded || critique.unbalanced) && critique.theme && critique.theme !== currentTheme) {
      overrides.theme = critique.theme;
      applied.push(`theme → ${critique.theme}`);
    }
    const hasImage = Boolean(slide.mediaAssetId || overrides.backgroundMediaAssetId || overrides.imageObjects?.length);
    if (critique.imageTreatment && hasImage && critique.imageTreatment !== overrides.imageTreatment) {
      overrides.imageTreatment = critique.imageTreatment;
      applied.push(`image treatment → ${critique.imageTreatment}`);
    }
  }

  if (applied.length) slide.overrides = overrides;
  return { issues, applied };
}

/**
 * Self-critique a project's rendered slides and auto-apply bounded fixes. Runs the
 * SAME /render route the export uses (headless), so it judges exactly what will
 * ship. Keep-best: after applying, re-render changed slides and revert any override
 * change that newly *introduced* overflow (frame grows are kept — they can't worsen).
 * Mutates + saves the project doc. Best-effort at the call site; needs web running.
 */
export async function critiqueProject(project: {
  get: (k: string) => any;
  set: (k: string, v: unknown) => void;
  save: () => Promise<unknown>;
}): Promise<CritiqueReport[]> {
  const projectId = String(project.get('_id'));
  const format = project.get('format') as Format;
  const type = project.get('type') as AssetType;
  const slides: Slide[] = JSON.parse(JSON.stringify(project.get('slides') ?? []));
  if (slides.length === 0) return [];

  const { width, height } = FORMAT_DIMENSIONS[format];
  const base = config.webUrl.replace(/\/+$/, '');
  const browser = await getBrowser();
  const page = await browser.newPage();
  const reports: CritiqueReport[] = [];
  // Slides we changed: remember the pre-fix override + overflow to guard regressions.
  const changed: Array<{ index: number; prevOverflow: boolean; prevOverrides: unknown }> = [];

  try {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });

    // Phase 1: render every slide once (ground-truth overflow + a PNG each).
    const shots: Array<{ index: number; overflow: boolean; base64: string }> = [];
    for (let i = 0; i < slides.length; i++) {
      const shot = await shootSlide(page, base, projectId, slides[i]!.id).catch(() => null);
      if (shot) shots.push({ index: i, ...shot });
    }

    // Phase 2: ONE multi-image vision call for the whole set (cheaper than
    // per-slide calls, and the model can judge cross-slide consistency).
    const verdicts = await visionCritiqueBatch(
      shots.map((s) => ({ base64: s.base64, theme: slides[s.index]!.overrides?.theme ?? 'editorial' })),
    );

    // Phase 3: apply bounded fixes per slide.
    for (let k = 0; k < shots.length; k++) {
      const { index: i, overflow } = shots[k]!;
      const slide = slides[i]!;
      const prevOverrides = JSON.parse(JSON.stringify(slide.overrides ?? null));
      const { issues, applied } = applyFixes(slide, overflow, verdicts[k] ?? null, type, format);
      if (issues.length || applied.length) {
        reports.push({ slideId: slide.id, order: slide.order ?? i, issues, applied });
      }
      if (applied.length) changed.push({ index: i, prevOverflow: overflow, prevOverrides });
    }

    if (changed.length === 0) return reports;

    // Persist so the verification render sees the fixes.
    project.set('slides', slides);
    await project.save();

    // Keep-best: re-render only changed slides; revert override changes that
    // newly introduced overflow (a regression). Frame grows stay untouched.
    let reverted = false;
    for (const c of changed) {
      const slide = slides[c.index]!;
      const themeChanged = JSON.stringify(slide.overrides ?? null) !== JSON.stringify(c.prevOverrides);
      if (!themeChanged) continue;
      const after = await shootSlide(page, base, projectId, slide.id).catch(() => null);
      if (after && after.overflow && !c.prevOverflow) {
        slide.overrides = c.prevOverrides ?? undefined;
        reverted = true;
        const r = reports.find((x) => x.slideId === slide.id);
        if (r) r.applied = r.applied.filter((a) => !a.startsWith('theme') && !a.startsWith('image treatment'));
      }
    }
    if (reverted) {
      project.set('slides', slides);
      await project.save();
    }
    return reports.filter((r) => r.applied.length || r.issues.length);
  } finally {
    await page.close().catch(() => {});
  }
}
