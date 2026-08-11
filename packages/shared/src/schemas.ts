/**
 * Zod schemas for the wire format — the SINGLE source of truth for slide /
 * project shapes. The API validates requests with these; the Mongoose models
 * and the TS interfaces in types.ts mirror them (drift shows up here first).
 * Living in shared (not the API) so the web app and tests can validate too.
 *
 * Legacy tolerance: slides from the block/layout era (stored snapshots carrying
 * `layoutType`, `blocks`, legacy `overrides.*`) still parse — zod object
 * schemas STRIP unknown keys by default, so restoring an old version snapshot
 * simply drops the retired fields instead of crashing. The render path only
 * ever mounts `authored` markup.
 */
import { z } from 'zod';
// Direct sibling imports (never './index') — the index re-exports this module,
// so importing back through it would make evaluation order load-bearing.
import { PHOTO_MOVES } from './slideMotion';
import { MAX_PLAN_SLIDES, MAX_SLIDE_DIRECTION_CHARS } from './brief';
import {
  ASSET_TYPES,
  MAX_SLIDES_PER_PROJECT,
  MAX_DRAFT_PARAGRAPH_CHARS,
  isFormat,
  isValidTypeFormat,
  type AssetType,
  type Format,
} from './formats';

const asEnum = <T extends readonly string[]>(values: T) =>
  z.enum(values as unknown as [string, ...string[]]);

const themeEnum = z.enum(['editorial', 'bold', 'minimal', 'soft']);

/** A canvas rectangle as fractions [0..1] (free photo overlays). */
const frameSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});

/**
 * One photo on a slide. A slide holds as many as you like; `placement` decides
 * how each one lands — see slidePhotos.ts for the layer model.
 */
export const slidePhotoSchema = z.object({
  id: z.string().min(1).max(64),
  mediaAssetId: z.string().min(1),
  placement: z.enum(['slot', 'background', 'free']).catch('free'),
  /** placement 'slot': the authored placeholder this fills (`data-cb-slot`). */
  slot: z.string().max(40).optional(),
  /** placement 'free': where it sits on the canvas, as fractions [0..1]. */
  frame: frameSchema.optional(),
  fit: z.enum(['cover', 'contain']).catch('cover'),
  /**
   * Which part of the photo to keep when it is cropped to its box, as
   * fractions [0..1]. Defaults to dead centre — which beheads a portrait in a
   * wide slot, so it is settable per photo.
   */
  focal: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
  /**
   * How this photo MOVES in a video export, overriding the brand's ambient
   * character. 'auto' lets the brand and the focal point decide.
   *
   * The preprocess is the migration for photos stored under the retired
   * `in`/`out` vocabulary. Without it `.catch('auto')` silently turned them
   * into 'auto', and a photo explicitly set to pull out with no focal point
   * came back as a sideways drift — a stored choice quietly changed. The
   * matching map inside `resolveMove` never saw those values, because this
   * boundary always runs first.
   */
  motion: z
    .preprocess((v) => (v === 'in' || v === 'out' ? 'zoom' : v), z.enum(PHOTO_MOVES).catch('auto'))
    .optional(),
  /** placement 'slot': resize the hole the composer left, without rewriting
   *  its markup. `shape` re-proportions it, `size` scales its budget. */
  shape: z.enum(['standard', 'wide', 'square', 'tall']).optional(),
  size: z.enum(['sm', 'md', 'lg']).optional(),
  /** placement 'free': negative sends it behind the composition. */
  z: z.number().min(-1).max(99).optional(),
  alt: z.string().max(160).optional(),
});

export const slideSchema = z.object({
  id: z.string().optional(),
  order: z.number().optional(),
  imageNeed: z.enum(['none', 'upload']).default('none'),
  /** Stock-photo search phrase (AI-chosen or user-edited); prefills the
   *  editor's stock picker. */
  imageQuery: z.string().max(80).optional(),
  /**
   * The user's own photos on this slide — slot fills, a background, and free
   * overlays. This replaced the single slide-level `mediaAssetId`, which was
   * folded in here once (`npm run migrate:photos`) and then retired; zod drops
   * it from any stored document that still carries it.
   */
  photos: z.array(slidePhotoSchema).max(24).default([]),
  overrides: z
    .object({
      focalPoint: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
      imageTreatment: z.enum(['none', 'tint', 'duotone']).optional(),
      theme: themeEnum.optional(),
    })
    .optional(),
  /**
   * AI-authored slide markup — semantic HTML that uses the brand recipe's
   * component classes. The renderer mounts this (sanitised, with the recipe
   * stylesheet + brand tokens injected); slides are authored-first.
   */
  authored: z
    .object({
      html: z.string().max(20000),
      /** Optional background-variant class applied to the slide root (e.g. 'photo',
       *  'statement') — the recipe stylesheet defines what each looks like. */
      bg: z.string().max(40).optional(),
      /** The composer's slide ROLE (cover/statement/quote/stat/cta/…). Drives the
       *  recipe's per-role motion in animated exports. */
      role: z.string().max(24).optional(),
      /**
       * WHICH PROMPT VERSIONS wrote and arranged this slide. Stamped at compose
       * so a post can be told what a newer copywriter or composer would improve.
       * Absent means it predates versioning — behind everything.
       */
      pv: z.record(z.string(), z.number()).optional(),
    })
    .optional(),
});

const settingsSchema = z.object({
  theme: themeEnum.optional(),
  slideCounter: z.boolean().optional(),
  /**
   * The ONE DM keyword for this post. The final slide, the caption and the
   * hand-off notes all read from here — a review found the payload saying GROW,
   * the slide saying COATING and the caption empty, with nothing comparing
   * them. One value, set once, used everywhere.
   */
  dmKeyword: z.string().trim().max(24).optional(),
  /**
   * Who reads this post. Chooses the voice register and shows on the review
   * page — a car-care guide composed in the studio-owner voice addresses the
   * wrong person on every slide, and nothing used to notice.
   */
  audience: z.enum(['car owner', 'studio owner']).optional(),
});

/** The generated social caption + hashtags for a post. */
export const captionSchema = z.object({
  text: z.string().max(2400).default(''),
  hashtags: z.array(z.string().max(60)).max(30).default([]),
});

export const createProjectSchema = z
  .object({
    businessId: z.string().min(1),
    title: z.string().trim().min(1, 'Title is required').max(160),
    type: asEnum(ASSET_TYPES),
    format: z.string(),
    slides: z.array(slideSchema).max(MAX_SLIDES_PER_PROJECT).optional(),
    settings: settingsSchema.optional(),
    /** Save the prompt now, compose later — how an Ideas card is created. */
    idea: z.string().trim().max(MAX_DRAFT_PARAGRAPH_CHARS).optional(),
    /** The per-slide plan, parked alongside the prompt on an Ideas card. */
    plan: z.array(z.string().trim().max(MAX_SLIDE_DIRECTION_CHARS)).max(MAX_PLAN_SLIDES).optional(),
    stage: z.enum(['idea', 'drafting', 'ready', 'shipped']).optional(),
    /** Arrives with the hand-off payload; editable like everything else. */
    caption: captionSchema.optional(),
  })
  .refine((d) => isFormat(d.format) && isValidTypeFormat(d.type as AssetType, d.format as Format), {
    message: 'Invalid type/format combination',
    path: ['format'],
  });

export const updateProjectSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  status: z.enum(['draft', 'rendered']).optional(),
  slides: z.array(slideSchema).max(MAX_SLIDES_PER_PROJECT).optional(),
  settings: settingsSchema.optional(),
  caption: captionSchema.optional(),
  /** Editing a parked Ideas card before composing it. Type/format are only
   *  honoured while the project has no slides — after that they're baked in. */
  idea: z.string().trim().max(MAX_DRAFT_PARAGRAPH_CHARS).optional(),
  plan: z.array(z.string().trim().max(MAX_SLIDE_DIRECTION_CHARS)).max(MAX_PLAN_SLIDES).optional(),
  type: asEnum(ASSET_TYPES).optional(),
  format: z.string().optional(),
}).refine(
  (d) =>
    d.type === undefined ||
    d.format === undefined ||
    (isFormat(d.format) && isValidTypeFormat(d.type as AssetType, d.format as Format)),
  { message: 'Invalid type/format combination', path: ['format'] },
);

export type SlideInput = z.infer<typeof slideSchema>;
