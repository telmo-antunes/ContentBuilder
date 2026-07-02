/**
 * Re-export of the shared Zod schemas (packages/shared/src/schemas.ts) — the
 * single source of truth for wire shapes. Kept so existing '../lib/validation'
 * imports stay stable.
 */
export {
  blockSchema,
  slideSchema,
  captionSchema,
  createProjectSchema,
  updateProjectSchema,
  type SlideInput,
} from '@contentbuilder/shared';
