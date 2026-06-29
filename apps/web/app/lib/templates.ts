import type { AssetType, BusinessCategory, Format } from '@contentbuilder/shared';

export interface StarterTemplate {
  name: string;
  blurb: string;
  type: AssetType;
  format: Format;
  /** Categories this template suits best (used to recommend per business). */
  categories: BusinessCategory[];
  shorthand: string;
}

/** Ready-made starter templates (the worked examples) — clone into shorthand. */
export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    name: 'Promo offer',
    blurb: 'Cover → why → what’s included → CTA',
    type: 'carousel',
    format: '1080x1350',
    categories: ['local-service', 'ecommerce', 'saas-product'],
    shorthand: `Slide 1: cover, eyebrow: LIMITED OFFER, title: Ceramic Coating Weekend, subtitle: 20% off all packages, date: This Sat–Sun only
Slide 2: split image, title: Why ceramic?, paragraph: A ceramic coating bonds to your paint, repelling water, dirt, and UV — keeping that just-detailed look for years., image
Slide 3: text only, title: What's included, list: Full exterior decontamination wash | Single-stage paint correction | 9H ceramic coating | 12-month protection guarantee
Slide 4: cta, cta: Book your slot this weekend, handle: @apexdetailing`,
  },
  {
    name: 'Feature highlight',
    blurb: 'Product cover → 3 benefits → social proof → CTA',
    type: 'carousel',
    format: '1080x1350',
    categories: ['saas-product', 'ecommerce', 'agency'],
    shorthand: `Slide 1: cover, eyebrow: NEW, title: Meet the feature that saves you hours
Slide 2: split image, title: Built for speed, paragraph: Type a few words and get a publish-ready draft in seconds., image
Slide 3: text only, title: Why teams switch, list: Set up in minutes | Works with your stack | No per-seat surprises | Cancel anytime
Slide 4: quote, quote: It paid for itself in the first week., attribution: — Jordan, Head of Growth
Slide 5: cta, cta: Start your free trial, handle: @yourproduct`,
  },
  {
    name: 'Educational tips',
    blurb: 'Listicle carousel that teaches, then converts',
    type: 'carousel',
    format: '1080x1350',
    categories: ['coach-creator', 'personal-brand', 'local-service'],
    shorthand: `Slide 1: cover, eyebrow: CAR CARE, title: 4 ways to keep your car cleaner for longer
Slide 2: text only, title: 1. Rinse before you wash, paragraph: Loose grit is what scratches paint. A pre-rinse lifts it before the wash mitt ever touches the surface.
Slide 3: text only, title: 2. Two-bucket method, paragraph: One bucket for soap, one to rinse your mitt — so you're not dragging grit back onto the paint.
Slide 4: cta, cta: Want it done properly? Book a detail, handle: @apexdetailing`,
  },
  {
    name: 'Founder lesson',
    blurb: 'Hook → story → the lesson → CTA (personal voice)',
    type: 'carousel',
    format: '1080x1350',
    categories: ['personal-brand', 'coach-creator'],
    shorthand: `Slide 1: cover, eyebrow: LESSON 01, title: The advice I wish I'd heard 5 years ago
Slide 2: text only, title: The mistake, paragraph: I said yes to every client — and slowly built a business I didn't want to run.
Slide 3: text only, title: The shift, paragraph: One question changed it: "Would I take this on if I were already fully booked?"
Slide 4: cta, cta: Want help finding your focus? DM me, handle: @yourname`,
  },
  {
    name: 'Testimonial',
    blurb: 'Social proof, then a call to action',
    type: 'carousel',
    format: '1080x1080',
    categories: ['personal-brand', 'coach-creator', 'saas-product', 'local-service', 'ecommerce', 'agency', 'nonprofit', 'other'],
    shorthand: `Slide 1: quote, quote: My car looked better than the day I bought it., attribution: — Marco R., 5-star review
Slide 2: cta, title: Your turn, cta: Book your detail today, handle: @apexdetailing`,
  },
  {
    name: 'Service announcement',
    blurb: 'Two-frame story for a new service',
    type: 'story',
    format: '1080x1920',
    categories: ['local-service', 'saas-product', 'nonprofit'],
    shorthand: `Frame 1: background image, eyebrow: NOW AVAILABLE, title: Interior Deep-Clean & Sanitise, image
Frame 2: cta, title: Limited slots this month, cta: DM us to book, handle: @apexdetailing`,
  },
];

/** Templates ranked for a category (matching first), with a `recommended` flag. */
export function rankedTemplates(
  category?: BusinessCategory,
): Array<StarterTemplate & { recommended: boolean }> {
  return STARTER_TEMPLATES.map((t) => ({
    ...t,
    recommended: Boolean(category && t.categories.includes(category)),
  })).sort((a, b) => Number(b.recommended) - Number(a.recommended));
}

/** A real placeholder example shown in the shorthand box. */
export const SHORTHAND_PLACEHOLDER = STARTER_TEMPLATES[0]!.shorthand;
