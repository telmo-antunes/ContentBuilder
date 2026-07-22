import { categoryLabel, type BgColors, type BrandKit, type BusinessCategory } from '@contentbuilder/shared';
import { SettingModel } from '../../models';
import type { TemplateBrandFacts } from '../templates';

/** Everything the Brand Design Director is given about a brand. */
export interface DirectorInputs extends TemplateBrandFacts {
  businessId: string;
  businessName?: string;
  colors: BgColors;
  /** Downscaled homepage screenshot (base64 PNG), if the kit captured one. */
  screenshotBase64?: string;
  /** Render-relevant kit fields (colors/fonts/logo) so the feedback loop can render candidates. */
  renderKit?: Partial<BrandKit>;
}

/** Operator prompt override from the AI Settings page (blank field → code default). */
export async function loadDirectorPrompt(field: string, fallback: string): Promise<string> {
  try {
    const doc = await SettingModel.findOne({ key: 'ai' }).lean<Record<string, unknown>>();
    const v = doc?.[field];
    return typeof v === 'string' && v.trim() ? v : fallback;
  } catch {
    return fallback;
  }
}

const toneText = (tone: string | string[] | undefined): string =>
  Array.isArray(tone) ? tone.join(', ') : (tone ?? '');

/** The brand-facts block appended to the director's user messages. */
export function brandFactLines(inp: DirectorInputs): string {
  const c = inp.colors;
  const palette = (c.palette && c.palette.length ? c.palette : [c.background, c.primary, c.secondary, c.accent, c.text]).join(', ');
  return [
    inp.businessName && `Business: ${inp.businessName}`,
    inp.category && `Category: ${categoryLabel(inp.category as BusinessCategory)}`,
    inp.tone && `Tone: ${toneText(inp.tone)}`,
    inp.styleDescriptor && `Visual character: ${inp.styleDescriptor}`,
    inp.voice && `Brand voice: ${inp.voice}`,
    inp.headingFont && `Heading typeface: ${inp.headingFont}`,
    `Logo available: ${inp.hasLogo ? 'yes' : 'no'}`,
    `Palette (hex): ${palette}`,
    `Roles — background ${c.background}, text ${c.text}, primary ${c.primary}, secondary ${c.secondary}, accent ${c.accent}`,
  ]
    .filter(Boolean)
    .join('\n');
}
