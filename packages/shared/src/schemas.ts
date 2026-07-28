/**
 * Zod schemas for the wire format — the SINGLE source of truth for slide /
 * project shapes. The API validates requests with these; the Mongoose models
 * and the TS interfaces in types.ts mirror them (drift shows up here first).
 * Living in shared (not the API) so the web app and tests can validate too.
 */
import { z } from 'zod';
// Direct sibling imports (never './index') — the index re-exports this module,
// so importing back through it would make evaluation order load-bearing.
import { BLOCK_TYPES } from './blocks';
import { LAYOUT_TYPES } from './layouts';
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

/** Block placement as fractions [0..1] of the canvas (FreePosition slides only). */
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
  /** placement 'free': negative sends it behind the composition. */
  z: z.number().min(-1).max(99).optional(),
  alt: z.string().max(160).optional(),
});

export const blockSchema = z.object({
  type: asEnum(BLOCK_TYPES),
  text: z.string().default(''),
  items: z.array(z.string()).optional(),
  frame: frameSchema.optional(),
  z: z.number().optional(),
});

export const slideSchema = z.object({
  id: z.string().optional(),
  order: z.number().optional(),
  layoutType: asEnum(LAYOUT_TYPES),
  blocks: z.array(blockSchema).default([]),
  imageNeed: z.enum(['none', 'upload']).default('none'),
  mediaAssetId: z.string().nullable().optional(),
  /** Stock-photo search phrase (AI-chosen or user-edited); the draft pipeline
   *  resolves it to media, and the editor's stock picker prefills from it. */
  imageQuery: z.string().max(80).optional(),
  /**
   * The user's own photos on this slide — slot fills, a background, and free
   * overlays. Replaces the single `mediaAssetId` (kept above for back-compat;
   * a legacy slide's asset is migrated into here as a background on save).
   */
  photos: z.array(slidePhotoSchema).max(24).default([]),
  overrides: z
    .object({
      focalPoint: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
      imageTreatment: z.enum(['none', 'tint', 'duotone']).optional(),
      theme: themeEnum.optional(),
      split: z.enum(['image-left', 'image-right', 'image-top', 'image-bottom']).optional(),
      imageAspect: z.enum(['square', 'landscape', 'wide', 'portrait']).optional(),
      imageSize: z.enum(['sm', 'md', 'lg']).optional(),
      imageFit: z.enum(['cover', 'contain']).optional(),
      imageZoom: z.number().min(1).max(5).optional(),
      imageFrame: frameSchema.optional(),
      imageBackground: z.boolean().optional(),
      backgroundMediaAssetId: z.string().nullable().optional(),
      imageObjects: z
        .array(
          z.object({
            id: z.string(),
            mediaAssetId: z.string().nullable().optional(),
            frame: frameSchema,
            fit: z.enum(['cover', 'contain']).optional(),
            crop: z
              .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), zoom: z.number().min(1).max(5) })
              .optional(),
          }),
        )
        .optional(),
      decorations: z
        .array(
          z.object({
            kind: z.enum(['logo', 'rule', 'divider', 'scrim']),
            frame: frameSchema,
            z: z.number().optional(),
            direction: z.enum(['to-top', 'to-bottom', 'to-left', 'to-right']).optional(),
            opacity: z.number().min(0).max(1).optional(),
          }),
        )
        .max(12)
        .optional(),
    })
    .optional(),
  /**
   * AI-authored slide markup — semantic HTML that uses the brand recipe's
   * component classes. When present, the renderer mounts this (sanitised, with
   * the recipe stylesheet + brand tokens injected) instead of the block layout.
   * `blocks` is kept alongside for free-canvas conversion and back-compat.
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
    })
    .optional(),
});

const settingsSchema = z.object({
  theme: themeEnum.optional(),
  slideCounter: z.boolean().optional(),
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
    stage: z.enum(['idea', 'drafting', 'ready', 'shipped']).optional(),
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
