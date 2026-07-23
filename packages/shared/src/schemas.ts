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
});

export type SlideInput = z.infer<typeof slideSchema>;
