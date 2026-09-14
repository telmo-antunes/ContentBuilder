/**
 * THE BRAND'S OWN PHOTOGRAPHS, AND HOW A FRESH DECK SPENDS THEM.
 *
 * Lifted out of the compose route so the prompt lab (`scripts/composeFromParse.ts`)
 * attaches pictures to a deck EXACTLY as production does — pool order, slot
 * filling, the full-bleed tone check and the bleed anchor — and a lab result
 * is a result about the product rather than about a re-implementation of it.
 */
import { randomUUID } from 'node:crypto';
import { archetypeFor, authoredSlots, type SlidePhoto } from '@contentbuilder/shared';
import { MediaAssetModel } from '../models';
import { getStorage } from '../storage';
import { SITE_PHOTO_LABEL } from './harvest';
import { bleedAnchorFor, hexLuminance, meanLuminanceOf, suitsBleedOver, type BleedAnchor } from './bleedAnchor';

/** The media label `promo-story` stores a rendered carousel cover under. */
export const PROMO_COVER_LABEL = 'Carousel cover';

/** How many of a brand's photos one compose will consider spending. */
const PHOTO_POOL_LIMIT = 24;

/**
 * THE BRAND'S OWN PICTURES, ready to be spent on a fresh deck.
 *
 * Photos harvested from the brand's website come first: they ARE the brand's
 * imagery, which is the whole reason analyze downloads them. Uploads follow,
 * newest first. Nothing from a stock library is ever in here — a composed deck
 * may arrive carrying the brand's own photographs, never a stranger's.
 *
 * EVERY CANDIDATE IS CHECKED AGAINST STORAGE. A media row whose bytes are gone
 * (a re-seed, a swapped storage dir, a manual clean-up) still lists fine and
 * renders as a broken image — which is worse than the empty slot this feature
 * exists to remove. The pool is what can actually be SHOWN, not what is merely
 * recorded, so an orphaned row can neither be attached nor talk the compose
 * step into asking for a slot it cannot fill.
 */
export async function brandPhotoPool(businessId: string) {
  /** Below this a photo cannot fill even the smallest slot without visible softness. */
  const MIN_POOL_DIMENSION = 800;

  const docs = await MediaAssetModel.find({
    businessId,
    // A logo, an avatar or a favicon harvested from the site lists fine and
    // ships as a blurry stamp — the review's "2 photos from your website" were
    // 640px site chrome. Size is a property the query can see; usefulness is
    // not, so the floor stands in for it.
    $or: [{ width: { $gte: MIN_POOL_DIMENSION } }, { height: { $gte: MIN_POOL_DIMENSION } }],
    /**
     * A rendered carousel cover is NOT brand imagery.
     *
     * `promo-story` keeps its cover as an ordinary media asset so the editor's
     * picker can swap it — but that also dropped it into this pool, newest
     * first, so the very next deck composed for the brand auto-filled its cover
     * slot with a picture of a different post. Seen on the first real run: an
     * English ceramic-coating carousel opened with a shrunken Portuguese slide
     * about add-ons.
     */
    label: { $ne: PROMO_COVER_LABEL },
  })
    .sort({ createdAt: -1 })
    .limit(PHOTO_POOL_LIMIT * 3)
    .lean<any[]>();
  const site = docs.filter((d) => d.label === SITE_PHOTO_LABEL);
  const ordered = [...site, ...docs.filter((d) => d.label !== SITE_PHOTO_LABEL)].slice(0, PHOTO_POOL_LIMIT * 2);
  const storage = getStorage();
  const present = await Promise.all(
    ordered.map(async (d) => ((await storage.exists(String(d.key)).catch(() => false)) ? d : null)),
  );
  const usable = present.filter(Boolean).slice(0, PHOTO_POOL_LIMIT) as any[];
  const orphaned = ordered.length - present.filter(Boolean).length;
  if (orphaned) console.warn(`[compose] ${orphaned} media record(s) have no file in storage — not offered to the deck`);
  return usable;
}

/**
 * Fill the holes the composer left, with the brand's own photographs.
 *
 * An empty `cb-shot` renders as a dead grey rectangle taking a third of the
 * poster, and until now every composed slide that asked for a picture shipped
 * exactly that and waited for the user to notice. The compose step now only
 * asks for a slot it can fill (`photoBudget`), and this spends the pool: one
 * photo per slot, no repeats while unused photos remain, in deck order.
 *
 * These are suggestions with a real picture in them, not decisions — every one
 * is swappable from the Studio's photo panel exactly like a manual attachment.
 */
export function fillSlotsFromPool(
  slides: Array<{ id: string; authored?: { html: string; archetype?: string } }>,
  pool: Array<{ _id: unknown }>,
  /**
   * Pool ids known to SUIT the brand ground as a full-bleed picture. A bleed
   * slide takes the first unused one of these; slot fills keep pool order,
   * because a slot is judged by relevance the pool cannot see, not by tone.
   */
  bleedPreferred?: ReadonlySet<string>,
): { photos: SlidePhoto[][]; used: number } {
  const photos: SlidePhoto[][] = slides.map(() => []);
  const taken = new Set<number>();
  const take = (prefer?: ReadonlySet<string>): { _id: unknown } | undefined => {
    const pick = (pred: (m: { _id: unknown }) => boolean) => {
      const i = pool.findIndex((m, k) => !taken.has(k) && pred(m));
      if (i === -1) return undefined;
      taken.add(i);
      return pool[i];
    };
    return (prefer && pick((m) => prefer.has(String(m._id)))) || pick(() => true);
  };
  slides.forEach((slide, i) => {
    const wants = archetypeFor(slide.authored?.archetype);

    /**
     * FULL-BLEED, when the archetype asks for it.
     *
     * A picture that is meant to carry the frame cannot do it from inside a
     * card with margins around it — every photo being an inset rounded
     * rectangle on a black field is the strongest "template" signal a deck can
     * carry. The background layer already exists and already has the scrim that
     * keeps type legible over it, so this is a placement decision rather than a
     * new way to render.
     */
    if (wants?.placement === 'bleed' && wants.photo !== 'never') {
      const m = take(bleedPreferred);
      if (!m) return;
      photos[i]!.push({
        id: randomUUID(),
        mediaAssetId: String(m._id),
        placement: 'background',
        fit: 'cover',
      });
      // Any slot the fragment happened to leave stays empty, and an empty slot
      // is removed from the render — so it costs nothing rather than punching a
      // hole through the photograph now behind it.
      return;
    }

    for (const slot of authoredSlots(slide.authored?.html ?? '')) {
      const m = take();
      if (!m) return;
      photos[i]!.push({
        id: randomUUID(),
        mediaAssetId: String(m._id),
        placement: 'slot',
        slot,
        fit: 'cover',
      });
    }
  });
  return { photos, used: taken.size };
}

export interface AttachedPhotos {
  photos: SlidePhoto[][];
  /** How many pool photos were spent. */
  used: number;
  /** Per slide: where the type goes over a full-bleed picture, when one stayed. */
  anchors: Array<BleedAnchor | undefined>;
  /** Decisions the code took — a dropped bleed photo — for the project's ledger. */
  notes: Array<{ slide?: number; note: string }>;
}

/**
 * Fill the deck's holes from the pool, then judge every full-bleed picture
 * against the brand ground.
 *
 * A bleed photo REPLACES the slide's own ground, and the type was coloured for
 * that ground — so one whose tone is nowhere near it splits the frame. It is
 * measured against the recipe's `ground` and DROPPED rather than scrimmed
 * harder: a slide with no background still renders correctly on the brand
 * surface, which is the better of the two failures. The type on a kept bleed
 * goes to whichever end of the picture is already dark.
 */
export async function attachPoolPhotos(
  base: Array<{ id: string; authored?: { html: string; archetype?: string } }>,
  pool: Array<{ _id: unknown; key?: string; width?: number; height?: number }>,
  groundHex: string,
): Promise<AttachedPhotos> {
  const groundLuminance = hexLuminance(groundHex) ?? 0;
  /**
   * PICTURES THAT SUIT THE GROUND GO FIRST. The pool used to be spent in
   * upload order, and on a near-black brand the first six uploads were pale
   * UI screenshots — so every full-bleed cover had its picture handed to it
   * and then dropped by the tone check below, on every deck, while twelve
   * darker photographs sat further down the pool untouched. Measured once per
   * candidate on a 160px thumbnail; a picture that will not decode counts as
   * suitable rather than failing the compose. Only the BLEED pick prefers
   * them — ordering the whole pool by tone put car photographs on the
   * product-proof slots where the screenshots belong.
   */
  const suited = await Promise.all(
    pool.map(async (m) => {
      if (!m.key) return true;
      try {
        return await suitsBleedOver(await getStorage().read(m.key), groundLuminance);
      } catch {
        return true;
      }
    }),
  );
  const bleedPreferred = new Set(pool.filter((_, i) => suited[i]).map((m) => String(m._id)));
  const filled = fillSlotsFromPool(base, pool, bleedPreferred);
  const notes: AttachedPhotos['notes'] = [];
  const anchors = await Promise.all(
    filled.photos.map(async (ps, i) => {
      const bgPhoto = ps.find((ph) => ph.placement === 'background');
      if (!bgPhoto) return undefined;
      const asset = pool.find((m) => String(m._id) === String(bgPhoto.mediaAssetId));
      const key = asset?.key;
      if (!key) return undefined;
      try {
        const buffer = await getStorage().read(key);
        if (!(await suitsBleedOver(buffer, groundLuminance))) {
          filled.photos[i] = ps.filter((ph) => ph !== bgPhoto);
          console.warn(`[compose] slide ${i + 1}: dropped a full-bleed photo whose tone fights the brand ground`);
          notes.push({
            slide: i + 1,
            note: 'This composition wanted a full-bleed photograph, but the picture’s tone fights the brand ground — it was dropped rather than scrimmed harder. Attach a darker/quieter photo as the background to get the full-bleed look.',
          });
          return undefined;
        }
        return await bleedAnchorFor(buffer);
      } catch {
        return undefined;
      }
    }),
  );
  /**
   * A SCREENSHOT IN A SLOT IS ZOOMED TO ITS TOP ROWS. A whole dashboard
   * shrunk into a slot is the one legibility fault every critique named
   * as blocking: the rows become the smallest type on the sheet and prove
   * nothing. A wide, light picture is a screenshot far more often than a
   * photograph; it opens at 1.6× on its upper-left, where a table's names and
   * first rows sit, and the Studio slider adjusts from there.
   */
  await Promise.all(
    filled.photos.map(async (ps) => {
      for (const ph of ps) {
        if (ph.placement !== 'slot' || ph.zoom) continue;
        const asset = pool.find((m) => String(m._id) === String(ph.mediaAssetId));
        if (!asset?.key || !asset.width || !asset.height || asset.width / asset.height < 1.4) continue;
        try {
          const mean = await meanLuminanceOf(await getStorage().read(asset.key));
          if (mean !== undefined && mean >= 0.7) {
            // A modest default: a table's names and first rows sit upper-left.
            // The Studio's zoom slider and focal picker take it from here — an
            // automatic crop cannot know which row proves the slide's point.
            ph.zoom = 1.6;
            ph.focal = ph.focal ?? { x: 0.3, y: 0.3 };
          }
        } catch {
          /* a picture that will not decode stays as it is */
        }
      }
    }),
  );
  return { photos: filled.photos, used: filled.used, anchors, notes };
}
