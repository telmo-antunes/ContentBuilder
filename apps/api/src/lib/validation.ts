import { z } from 'zod';
import {
  BLOCK_TYPES,
  LAYOUT_TYPES,
  ASSET_TYPES,
  MAX_SLIDES_PER_PROJECT,
  isFormat,
  isValidTypeFormat,
  type AssetType,
  type Format,
} from '@contentbuilder/shared';

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
  overrides: z
    .object({
      focalPoint: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
      imageTreatment: z.enum(['none', 'tint', 'duotone']).optional(),
      theme: themeEnum.optional(),
      split: z.enum(['image-left', 'image-right', 'image-top', 'image-bottom']).optional(),
      imageAspect: z.enum(['square', 'landscape', 'wide', 'portrait']).optional(),
      imageSize: z.enum(['sm', 'md', 'lg']).optional(),
      imageFit: z.enum(['cover', 'contain']).optional(),
      imageFrame: frameSchema.optional(),
      imageBackground: z.boolean().optional(),
    })
    .optional(),
});

const settingsSchema = z.object({
  theme: themeEnum.optional(),
  slideCounter: z.boolean().optional(),
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
});

export type SlideInput = z.infer<typeof slideSchema>;
