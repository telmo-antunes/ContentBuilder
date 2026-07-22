import type { ArtDirection, BackgroundRole, BrandLayout, Format, LayoutLibrary, MediaAsset } from '@contentbuilder/shared';
import { getStorage } from '../../storage';
import { MediaAssetModel } from '../../models';
import { generateArtBrief, DIRECTOR_BRIEF_SYSTEM } from './brief';
import { generateCompositions, DIRECTOR_LAYOUT_SYSTEM } from './compositions';
import { generateBackgroundSet, BACKGROUND_ROLES, type BackgroundSet, DIRECTOR_BACKGROUND_SYSTEM } from './backgrounds';
import { refineLibrary } from './critiqueLoop';
import { pruneFloatingDecorations } from './prune';
import { enforceReadingOrder } from './readingOrder';
import type { DirectorLayout } from './schema';
import type { DirectorInputs } from './prompt';

/**
 * The Brand Design Director: ONE pass per brand that authors its whole Instagram
 * design system — a written art brief, post + story compositions, and an
 * authored vector background system (three intensities) they sit on. Opus-tier,
 * best-effort at every stage (never throws; degrades to generics + motifs), so a
 * failure never blocks kit approval.
 */

export { DIRECTOR_BRIEF_SYSTEM, DIRECTOR_LAYOUT_SYSTEM, DIRECTOR_BACKGROUND_SYSTEM };
export type { DirectorInputs } from './prompt';

const FMT: Record<'post' | 'story', Format> = { post: '1080x1350', story: '1080x1920' };

/** Store one background SVG as a MediaAsset (deterministic key → stable URL on regen). */
async function storeBackground(
  businessId: string,
  fmt: 'post' | 'story',
  role: BackgroundRole,
  svg: string,
): Promise<string | null> {
  try {
    const storage = getStorage();
    const key = `backgrounds/${businessId}/sys-${fmt}-${role}.svg`;
    const stored = await storage.save(key, Buffer.from(svg, 'utf8'), { contentType: 'image/svg+xml' });
    const height = fmt === 'story' ? 1920 : 1350;
    const asset = await MediaAssetModel.findOneAndUpdate(
      { businessId, key: stored.key },
      {
        businessId,
        type: 'generated',
        label: `Brand background — ${role} (${fmt})`,
        key: stored.key,
        url: stored.url,
        width: 1080,
        height,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return String(asset._id);
  } catch (err) {
    console.error('[director] background store failed (layout kept, no bg):', err);
    return null;
  }
}

/** Store the 3 role backgrounds once, then attach the right asset id to each layout. */
async function attachBackgrounds(
  layouts: DirectorLayout[],
  set: BackgroundSet,
  businessId: string,
  fmt: 'post' | 'story',
): Promise<BrandLayout[]> {
  const idByRole: Partial<Record<BackgroundRole, string>> = {};
  for (const role of BACKGROUND_ROLES) {
    const id = await storeBackground(businessId, fmt, role, set[role]);
    if (id) idByRole[role] = id;
  }
  return layouts.map((l) => {
    const role = l.backgroundRole ?? undefined;
    const backgroundMediaAssetId = role && !l.imageBackground ? idByRole[role] : undefined;
    return { ...l, backgroundRole: role, backgroundMediaAssetId } as BrandLayout;
  });
}

export interface BrandPackageResult {
  artDirection: ArtDirection;
  library: LayoutLibrary;
}

export async function generateBrandPackage(inp: DirectorInputs): Promise<BrandPackageResult> {
  // 1) The brief (only vision call) — then compositions + both background sets in
  //    parallel (backgrounds depend only on the brief + palette, not the layouts).
  const brief = await generateArtBrief(inp);
  const [comps, postBg, storyBg] = await Promise.all([
    generateCompositions(brief, inp),
    generateBackgroundSet(brief, inp.colors, FMT.post, inp.businessId),
    generateBackgroundSet(brief, inp.colors, FMT.story, inp.businessId),
  ]);

  const clean = <T extends BrandLayout>(l: T): T => enforceReadingOrder(pruneFloatingDecorations(l));
  const post = (await attachBackgrounds(comps.post, postBg, inp.businessId, 'post')).map(clean);
  const story = (await attachBackgrounds(comps.story, storyBg, inp.businessId, 'story')).map(clean);

  const rawLibrary: LayoutLibrary = {
    direction: brief.brief.split('. ')[0]?.slice(0, 240),
    post,
    story,
  };

  // Feedback loop (best-effort, bounded): render each candidate, let a vision
  // judge critique it, apply small clamped fixes + keep-best. Skipped silently if
  // rendering/critique isn't available so it never blocks package generation.
  let library = rawLibrary;
  try {
    const docs = await MediaAssetModel.find({ businessId: inp.businessId }).lean();
    const media = docs.map((m) => ({ ...(m as Record<string, unknown>), _id: String((m as { _id: unknown })._id) })) as unknown as MediaAsset[];
    library = await refineLibrary(rawLibrary, brief, inp.renderKit ?? null, media);
  } catch (err) {
    console.warn('[director] feedback loop skipped:', err instanceof Error ? err.message : err);
  }

  return { artDirection: brief, library };
}
