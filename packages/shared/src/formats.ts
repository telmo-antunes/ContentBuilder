/**
 * Asset types, formats, dimensions, and safe areas.
 *
 * The chosen `type` constrains the allowed `format`; always validate the
 * combination. Every layout must render correctly at all supported sizes.
 */
export type AssetType = 'carousel' | 'story';

export const ASSET_TYPES: readonly AssetType[] = ['carousel', 'story'];

export type Format = '1080x1080' | '1080x1350' | '1080x1920';

export interface Dimensions {
  width: number;
  height: number;
}

export const FORMAT_DIMENSIONS: Record<Format, Dimensions> = {
  '1080x1080': { width: 1080, height: 1080 },
  '1080x1350': { width: 1080, height: 1350 },
  '1080x1920': { width: 1080, height: 1920 },
};

/** Which formats each asset type may use. */
export const ALLOWED_FORMATS: Record<AssetType, readonly Format[]> = {
  carousel: ['1080x1080', '1080x1350'],
  story: ['1080x1920'],
};

export const FORMAT_LABELS: Record<Format, string> = {
  '1080x1080': '1:1 Square (1080×1080)',
  '1080x1350': '4:5 Portrait (1080×1350)',
  '1080x1920': '9:16 Story (1080×1920)',
};

export function isAssetType(value: unknown): value is AssetType {
  return typeof value === 'string' && (ASSET_TYPES as readonly string[]).includes(value);
}

export function isFormat(value: unknown): value is Format {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(FORMAT_DIMENSIONS, value);
}

/** True when `format` is permitted for the given asset `type`. */
export function isValidTypeFormat(type: AssetType, format: Format): boolean {
  return ALLOWED_FORMATS[type]?.includes(format) ?? false;
}

export function dimensionsFor(format: Format): Dimensions {
  return FORMAT_DIMENSIONS[format];
}

export function defaultFormatFor(type: AssetType): Format {
  return ALLOWED_FORMATS[type][0] ?? '1080x1080';
}

/**
 * Safe areas (in slide pixels at the 1080-wide canvas).
 *
 * `padding` — keep critical text/logo within this inset on every edge.
 * `topReserve` / `bottomReserve` — for Story only, additionally keep key
 * content clear of where Instagram overlays its own UI.
 */
export interface SafeArea {
  padding: number;
  topReserve: number;
  bottomReserve: number;
}

export const BASE_SAFE_PADDING = 80;
export const STORY_UI_RESERVE = 250;

export function safeAreaFor(type: AssetType): SafeArea {
  if (type === 'story') {
    return { padding: BASE_SAFE_PADDING, topReserve: STORY_UI_RESERVE, bottomReserve: STORY_UI_RESERVE };
  }
  return { padding: BASE_SAFE_PADDING, topReserve: 0, bottomReserve: 0 };
}

/** Hard cap on slides per project (cost control). */
export const MAX_SLIDES_PER_PROJECT = 12;

/** Hard cap on the draft-from-paragraph input length (cost control). */
export const MAX_DRAFT_PARAGRAPH_CHARS = 2000;
