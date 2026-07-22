import {
  FORMAT_DIMENSIONS,
  safeAreaFor,
  type BackgroundRole,
  type BlockFrame,
  type BlockType,
  type Format,
  type Slide,
} from '@contentbuilder/shared';
import { reorderByReading } from './director/readingOrder';

/**
 * The intent-refinement engine — the core of the design-first editor. The user
 * reacts to a finished slide with a high-level intent ("bigger headline",
 * "calmer background"); each maps to a BOUNDED, DETERMINISTIC transform (clamped
 * to the safe area, copy never touched). No AI call — instant + predictable.
 */

export type RefineIntent =
  | 'bigger-headline'
  | 'fill-space'
  | 'more-breathing-room'
  | 'bolder-background'
  | 'calmer-background'
  | 'tidy';

export const REFINE_INTENTS: Array<{ intent: RefineIntent; label: string; hint: string }> = [
  { intent: 'bigger-headline', label: 'Bigger headline', hint: 'Enlarge the hero line' },
  { intent: 'fill-space', label: 'Fill the space', hint: 'Use more of the canvas' },
  { intent: 'more-breathing-room', label: 'More breathing room', hint: 'Add negative space' },
  { intent: 'bolder-background', label: 'Bolder background', hint: 'Step the background up' },
  { intent: 'calmer-background', label: 'Calmer background', hint: 'Quiet the background' },
  { intent: 'tidy', label: 'Tidy up', hint: 'Fix spacing and order' },
];

const REFINE_INTENT_SET = new Set<string>(REFINE_INTENTS.map((r) => r.intent));
export const isRefineIntent = (v: unknown): v is RefineIntent => typeof v === 'string' && REFINE_INTENT_SET.has(v);

const HEADING: BlockType[] = ['title', 'quote', 'subtitle', 'price', 'cta', 'eyebrow'];

const clampNum = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function bounds(format: Format) {
  const { width, height } = FORMAT_DIMENSIONS[format];
  const type = format === '1080x1920' ? 'story' : 'carousel';
  const s = safeAreaFor(type);
  return {
    xMin: s.padding / width,
    xMax: 1 - s.padding / width,
    yMin: (s.topReserve || s.padding) / height,
    yMax: 1 - (s.bottomReserve || s.padding) / height,
  };
}

function clampFrame(f: BlockFrame, b: ReturnType<typeof bounds>): BlockFrame {
  const w = clampNum(f.w, 0.05, b.xMax - b.xMin);
  const h = clampNum(f.h, 0.03, b.yMax - b.yMin);
  const x = clampNum(f.x, b.xMin, b.xMax - w);
  const y = clampNum(f.y, b.yMin, b.yMax - h);
  return { x: +x.toFixed(4), y: +y.toFixed(4), w: +w.toFixed(4), h: +h.toFixed(4) };
}

/** Index of the "hero" block — the largest-area heading, else the largest block. */
function heroIndex(blocks: Slide['blocks']): number {
  const framed = blocks.map((b, i) => ({ b, i })).filter((x) => x.b.frame);
  if (!framed.length) return -1;
  const heads = framed.filter((x) => HEADING.includes(x.b.type));
  const pool = heads.length ? heads : framed;
  let best = pool[0]!;
  for (const x of pool) {
    if (x.b.frame!.w * x.b.frame!.h > best.b.frame!.w * best.b.frame!.h) best = x;
  }
  return best.i;
}

const STEP_DOWN: Record<BackgroundRole, BackgroundRole> = { statement: 'texture', texture: 'canvas', canvas: 'canvas' };
const STEP_UP: Record<BackgroundRole, BackgroundRole> = { canvas: 'texture', texture: 'statement', statement: 'statement' };

export interface RefineOptions {
  /** role -> stored background asset id, from the brand's layout library (for bg intents). */
  backgroundsByRole?: Partial<Record<BackgroundRole, string>>;
}

export interface RefineResult {
  slide: Slide;
  changed: boolean;
  note: string;
}

export function refineSlide(slide: Slide, intent: RefineIntent, format: Format, opts: RefineOptions = {}): RefineResult {
  const b = bounds(format);
  const blocks = slide.blocks.map((bl) => ({ ...bl, frame: bl.frame ? { ...bl.frame } : bl.frame }));
  const overrides = { ...(slide.overrides ?? {}) };
  const hi = heroIndex(blocks);
  const hero = hi >= 0 ? blocks[hi] : undefined;

  const done = (changed: boolean, note: string): RefineResult => ({
    slide: changed ? { ...slide, blocks, overrides } : slide,
    changed,
    note: changed ? note : 'No change to make',
  });

  switch (intent) {
    case 'bigger-headline':
      if (hero?.frame) {
        hero.frame = clampFrame({ ...hero.frame, w: hero.frame.w + 0.08, h: hero.frame.h + 0.06 }, b);
        return done(true, 'Enlarged the headline');
      }
      return done(false, '');

    case 'fill-space':
      if (hero?.frame) {
        hero.frame = clampFrame({ ...hero.frame, w: Math.max(hero.frame.w, 0.84), h: hero.frame.h + 0.08 }, b);
        return done(true, 'Filled more of the canvas');
      }
      return done(false, '');

    case 'more-breathing-room':
      if (hero?.frame) {
        const f = hero.frame;
        hero.frame = clampFrame({ x: f.x + 0.02, y: f.y + 0.02, w: Math.max(0.4, f.w - 0.06), h: Math.max(0.06, f.h - 0.04) }, b);
        return done(true, 'Added breathing room');
      }
      return done(false, '');

    case 'tidy': {
      const reordered = reorderByReading(blocks).map((bl) => (bl.frame ? { ...bl, frame: clampFrame(bl.frame, b) } : bl));
      const before = JSON.stringify(slide.blocks.map((x) => x.frame ?? null));
      const after = JSON.stringify(reordered.map((x) => x.frame ?? null));
      const changed = before !== after;
      return { slide: changed ? { ...slide, blocks: reordered } : slide, changed, note: changed ? 'Tidied spacing and order' : 'Already tidy' };
    }

    case 'bolder-background':
    case 'calmer-background': {
      const map = opts.backgroundsByRole;
      const currentId = overrides.backgroundMediaAssetId;
      if (!map || !currentId) return done(false, '');
      const roleByAsset: Record<string, BackgroundRole> = {};
      for (const [role, id] of Object.entries(map)) if (id) roleByAsset[id] = role as BackgroundRole;
      const cur = roleByAsset[currentId];
      if (!cur) return done(false, '');
      const next = (intent === 'bolder-background' ? STEP_UP : STEP_DOWN)[cur];
      const nextId = map[next];
      if (next === cur || !nextId) return done(false, '');
      overrides.backgroundMediaAssetId = nextId;
      return done(true, intent === 'bolder-background' ? 'Bolder background' : 'Quieter background');
    }
  }
}
