/**
 * The MOTION layer for animated (video) export.
 *
 * The choreography itself lives in shared (`recipeMotionCss`) so the API's video
 * exporter and this renderer agree on both the CSS and its duration. Each brand
 * carries its own motion SIGNATURE on `recipe.motion` (style + pace) — authored
 * once, exactly like the visual signature — and brands without one fall back to
 * a balanced rise.
 */
export { recipeMotionCss, recipeMotionMs, DEFAULT_MOTION } from '@contentbuilder/shared';
