import type { Block, LayoutType } from '@contentbuilder/shared';
import type { LayoutImage, RenderBrandKit } from './types';

/** Hardcoded brand kit for the dev gallery (no DB needed). */
export const SAMPLE_KIT: RenderBrandKit = {
  colors: {
    primary: '#00C2FF',
    secondary: '#1B3A5C',
    accent: '#C9A227',
    background: '#0B1F3A',
    text: '#F5F7FA',
    palette: ['#0B1F3A', '#1B3A5C', '#00C2FF', '#C9A227', '#F5F7FA'],
  },
  fonts: { render: { heading: 'Montserrat', body: 'Inter' } },
  logo: { url: '/sample/logo.svg' },
};

/** A lighter kit to show the contrast engine flipping text dark on a light bg. */
export const SAMPLE_KIT_LIGHT: RenderBrandKit = {
  colors: {
    primary: '#C2410C',
    secondary: '#E7E2D8',
    accent: '#C2410C',
    background: '#FBF7F0',
    text: '#1B1A17',
    palette: ['#FBF7F0', '#E7E2D8', '#C2410C', '#1B1A17', '#7C6F5A'],
  },
  fonts: { render: { heading: 'Playfair Display', body: 'Source Serif 4' } },
  logo: { url: '/sample/logo.svg' },
};

export const SAMPLE_IMAGE: LayoutImage = { url: '/sample/photo.svg', focalPoint: { x: 0.62, y: 0.4 } };

export interface GallerySlide {
  layoutType: LayoutType;
  label: string;
  blocks: Block[];
  withImage?: boolean;
}

export const GALLERY_SLIDES: GallerySlide[] = [
  {
    layoutType: 'Cover',
    label: 'Cover',
    blocks: [
      { type: 'eyebrow', text: 'LIMITED OFFER' },
      { type: 'title', text: 'Ceramic Coating Weekend' },
      { type: 'subtitle', text: '20% off all packages' },
      { type: 'date', text: 'This Sat–Sun only' },
    ],
  },
  {
    layoutType: 'BackgroundImage',
    label: 'BackgroundImage',
    withImage: true,
    blocks: [
      { type: 'eyebrow', text: 'THIS WEEKEND' },
      { type: 'title', text: '20% OFF Ceramic Coating' },
    ],
  },
  {
    layoutType: 'CenteredHero',
    label: 'CenteredHero',
    withImage: true,
    blocks: [
      { type: 'eyebrow', text: 'NEW' },
      { type: 'title', text: '9H Ceramic Shield' },
      { type: 'paragraph', text: 'A glass-hard layer that locks in the shine.' },
    ],
  },
  {
    layoutType: 'TextOnly',
    label: 'TextOnly',
    blocks: [
      { type: 'title', text: "What's included" },
      {
        type: 'list',
        text: '',
        items: [
          'Full exterior decontamination wash',
          'Single-stage paint correction',
          '9H ceramic coating',
          '12-month protection guarantee',
        ],
      },
    ],
  },
  {
    layoutType: 'SplitImageText',
    label: 'SplitImageText',
    withImage: true,
    blocks: [
      { type: 'title', text: 'Why ceramic?' },
      {
        type: 'paragraph',
        text: 'A ceramic coating bonds to your paint, repelling water, dirt, and UV — keeping that just-detailed look for years.',
      },
    ],
  },
  {
    layoutType: 'Quote',
    label: 'Quote',
    blocks: [
      { type: 'quote', text: 'My car looked better than the day I bought it.' },
      { type: 'attribution', text: '— Marco R., 5-star review' },
    ],
  },
  {
    layoutType: 'CTA',
    label: 'CTA',
    blocks: [
      { type: 'title', text: 'Your turn' },
      { type: 'cta', text: 'Book your slot this weekend' },
      { type: 'handle', text: '@apexdetailing' },
    ],
  },
];

const FILLER =
  'A ceramic coating bonds to your paint, repelling water, dirt, and UV, keeping that just-detailed look for years on end. ' +
  'Two-bucket washing, pre-rinsing, and proper drying all matter more than people think, and skipping them is how swirl marks creep in. ' +
  'Loose grit is what scratches paint, so a thorough pre-rinse lifts it before the wash mitt ever touches the surface of the panel. ' +
  'Paint correction removes the defects first, then the coating locks in that corrected finish under a glass-hard protective layer. ' +
  'This is exactly the situation where the editor must surface a clear text-too-long warning instead of clipping the content or shrinking the type below its readable minimum size, because consistency and legibility always come first. ';

/** Deliberately too-long copy to exercise the text-fit overflow warning. */
export const OVERFLOW_SLIDE: GallerySlide = {
  layoutType: 'TextOnly',
  label: 'TextOnly (overflow demo)',
  blocks: [
    { type: 'title', text: 'This title is intentionally far too long to ever fit within the slide safe area no matter how small the type gets' },
    { type: 'paragraph', text: FILLER.repeat(4) },
  ],
};
