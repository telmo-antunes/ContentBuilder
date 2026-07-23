/**
 * Hand-authored brand recipes for the real seeded brands, written for the FULL
 * 1080×1350 export canvas (Instagram-legible type). These are the "authored
 * once" output the recipe-author touchpoint will eventually produce; for now
 * they are the proven reference recipes the lab validates the formula against,
 * and they double as fixtures.
 *
 * Each `stylesheet` is scoped to `.cb-slide` and written against the `--cb-*`
 * tokens the renderer injects. Per-slide, the composer writes only semantic
 * markup using the classes listed in `components` — coherence by construction.
 *
 * Sources: apps/api/src/seed.ts (real BrandKit colors/fonts/logo/voice) + the
 * real homepages. See the `contentbuilder-brands` memory.
 */
import { brandRecipeSchema, type BrandRecipe } from '@contentbuilder/shared';

/**
 * DYNATÓS PROGRAM — coaching for men (body, mind & discipline).
 * Real kit: bg #3F371C, gold #FCBC04, text #C4BCB4; Anton/DM-Serif → we render
 * condensed caps (Oswald) + gold italic serif (Source Serif 4). Ornate serif
 * DYNATÓS·PROGRAM wordmark. Voice: "Become the best version possible."
 */
export const dynatosRecipe: BrandRecipe = brandRecipeSchema.parse({
  tokens: {
    ground: '#0f0b06',
    groundAlt: '#1c160b',
    ink: '#ece4d3',
    inkMuted: '#c4bcb4',
    accent: '#fcbc04',
    accentAlt: '#fddc7b',
    line: 'rgba(236,228,211,0.14)',
    displayFamily: 'Oswald',
    bodyFamily: 'Inter',
    accentFamily: 'Source Serif 4',
    radius: 10,
  },
  typography: { displayCase: 'upper', displayWeight: 700, displayTracking: '0.005em', density: 'roomy' },
  signature: {
    name: 'gold italic-serif tagline',
    description:
      'A gold (accent) italic-serif line that punctuates each slide — sits under the headline or stands alone as the payoff. Uses --cb-accent-family, italic, --cb-accent.',
  },
  stylesheet: `
.cb-slide{ position:absolute; inset:0; padding:96px 88px 100px; display:flex; flex-direction:column; isolation:isolate;
  color:var(--cb-ink); font-family:var(--cb-body);
  background:
    radial-gradient(78% 50% at 50% -8%, rgba(252,188,4,.24), transparent 62%),
    radial-gradient(125% 88% at 50% 126%, rgba(0,0,0,.62), transparent 58%),
    radial-gradient(100% 100% at 15% 8%, rgba(148,108,12,.12), transparent 46%),
    linear-gradient(178deg,#231b0d,#0b0803); }
.cb-slide::before{ content:""; position:absolute; inset:0; z-index:0; pointer-events:none; opacity:.07; mix-blend-mode:overlay;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
.cb-slide::after{ content:""; position:absolute; inset:0; z-index:0; pointer-events:none;
  background:linear-gradient(108deg, transparent 42%, rgba(253,220,123,.07) 52%, transparent 61%); }
.cb-slide > *{ position:relative; z-index:1; }
.cb-slide .logo{ height:60px; width:420px; max-width:70%; background:var(--cb-logo, none) left center/contain no-repeat; align-self:flex-start; }
.cb-slide .fill{ flex:1 1 auto; }
.cb-slide .eyebrow{ font-family:var(--cb-display); font-weight:600; font-size:27px; letter-spacing:.26em; text-transform:uppercase; color:var(--cb-accent); }
.cb-slide .headline{ font-family:var(--cb-display); font-weight:700; text-transform:uppercase; font-size:112px; line-height:.94; letter-spacing:.005em; color:var(--cb-ink); margin-top:26px; }
.cb-slide .headline.sm{ font-size:82px; }
.cb-slide .tagline{ font-family:var(--cb-accent-family); font-style:italic; color:var(--cb-accent); font-size:44px; line-height:1.28; margin-top:34px; max-width:24ch; }
.cb-slide .rule{ height:6px; width:132px; background:var(--cb-accent); margin:36px 0; border-radius:3px; }
.cb-slide .body{ font-size:34px; line-height:1.5; color:var(--cb-ink-muted); margin-top:28px; max-width:24ch; }
.cb-slide .quote{ font-family:var(--cb-accent-family); font-style:italic; font-size:72px; line-height:1.22; color:var(--cb-ink); letter-spacing:-.01em; }
.cb-slide .quote .em{ color:var(--cb-accent); }
.cb-slide .attr{ font-family:var(--cb-display); font-weight:600; text-transform:uppercase; letter-spacing:.16em; font-size:26px; color:#a07d16; margin-top:38px; }
.cb-slide .cta{ font-family:var(--cb-display); font-weight:600; letter-spacing:.08em; text-transform:uppercase; align-self:flex-start; background:var(--cb-accent); color:#1c1305; border-radius:var(--cb-radius); padding:28px 46px; font-size:32px; margin-top:14px; }
.cb-slide .handle{ font-family:var(--cb-display); font-weight:600; letter-spacing:.2em; text-transform:uppercase; font-size:26px; color:#8f8778; margin-top:32px; }
`.trim(),
  components: [
    { className: 'logo', use: 'The DYNATÓS·PROGRAM wordmark. Put on covers and the CTA, top-left.' },
    { className: 'eyebrow', use: 'Small gold uppercase kicker above the headline (a section/label).' },
    { className: 'headline', use: 'The main statement — condensed uppercase. Add .sm for longer lines.' },
    { className: 'tagline', use: 'THE SIGNATURE: a gold italic-serif payoff line. Use on most slides.' },
    { className: 'rule', use: 'A short gold underline; separates headline from body when both are present.' },
    { className: 'body', use: 'Supporting sentence(s), muted. Keep to ~2 lines.' },
    { className: 'quote', use: 'A large italic-serif pull-quote; wrap the punchy phrase in <span class="em">.' },
    { className: 'attr', use: 'Quote attribution, small gold uppercase.' },
    { className: 'cta', use: 'A solid gold call-to-action button. One per CTA slide.' },
    { className: 'handle', use: 'The @handle, small muted uppercase, at the very bottom.' },
    { className: 'fill', use: 'An empty spacer div that pushes content down (flex-grow). Use to bottom-anchor.' },
  ],
  // Same 1080-wide type scale; only the vertical rhythm changes per canvas.
  formats: {
    // Story 9:16 — tall. Respect Instagram's top/bottom UI safe zones and let the
    // extra height breathe (bigger headline, roomier spacing).
    '1080x1920': {
      stylesheet: `
.cb-slide{ padding:210px 88px 240px; }
.cb-slide .headline{ font-size:124px; margin-top:30px; }
.cb-slide .headline.sm{ font-size:92px; }
.cb-slide .tagline{ font-size:48px; margin-top:42px; }
.cb-slide .body{ font-size:36px; margin-top:32px; }
.cb-slide .quote{ font-size:82px; }
`.trim(),
    },
    // Square 1:1 — short. Tighten padding and pull type down a notch so a full
    // composition still fits without overflow.
    '1080x1080': {
      stylesheet: `
.cb-slide{ padding:72px 84px 76px; }
.cb-slide .eyebrow{ font-size:24px; }
.cb-slide .headline{ font-size:92px; line-height:.96; margin-top:20px; }
.cb-slide .headline.sm{ font-size:68px; }
.cb-slide .tagline{ font-size:38px; margin-top:24px; }
.cb-slide .rule{ margin:26px 0; }
.cb-slide .body{ font-size:30px; margin-top:22px; }
.cb-slide .quote{ font-size:60px; }
.cb-slide .cta{ padding:22px 40px; font-size:29px; }
`.trim(),
    },
  },
  composition: {
    align: 'flush-left',
    patterns: [
      'cover: logo → fill → eyebrow → headline → tagline',
      'statement: eyebrow → fill → headline → rule → tagline',
      'quote: fill → quote → attr → fill',
      'cta: logo → fill → eyebrow → headline → cta → handle',
    ],
  },
  imagery: {
    treatment: 'Moody, warm-lit portraits of disciplined men; dark so gold + off-white type sits on top.',
    photoRole: 'accent',
    texture: 'faint warm grain',
  },
  voice: {
    description: 'Direct, masculine, motivational. Speaks to discipline and becoming a pillar for others.',
    dos: ['Short, declarative lines', 'Address the reader ("you")', 'Confidence without hype'],
    donts: ['Corporate filler', 'Exclamation marks', 'Softeners like "maybe" / "just"'],
  },
});

/**
 * DETAILMASTERS CRM — premium CRM/marketplace for auto-detailing.
 * Real kit: bg #4B3B27, bronze gold #B68C49 / #D4C09D, gray #6E6863;
 * Playfair Display + Inter. Geometric DM monogram + "detail·masters" wordmark.
 * Cinematic premium-car photography. Voice: "deserves exceptional care."
 */
export const detailMastersRecipe: BrandRecipe = brandRecipeSchema.parse({
  tokens: {
    ground: '#171008',
    groundAlt: '#2a2013',
    ink: '#efe7d7',
    inkMuted: '#cfc3ad',
    accent: '#c19a5c',
    accentAlt: '#d4c09d',
    line: 'rgba(212,192,157,0.20)',
    displayFamily: 'Playfair Display',
    bodyFamily: 'Inter',
    accentFamily: 'Playfair Display',
    radius: 12,
  },
  typography: { displayCase: 'sentence', displayWeight: 600, displayTracking: '-0.01em', density: 'balanced' },
  signature: {
    name: 'gold italic-serif accent line',
    description:
      'The second half of a headline set in gold italic Playfair (via <span class="it">) — an elegant emphasis, as on the site ("výjimečnou péči"). One per headline.',
  },
  stylesheet: `
.cb-slide{ position:absolute; inset:0; padding:88px 84px 92px; display:flex; flex-direction:column; isolation:isolate;
  color:var(--cb-ink); font-family:var(--cb-body);
  background:
    radial-gradient(64% 44% at 82% 6%, rgba(193,154,92,.30), transparent 60%),
    radial-gradient(120% 92% at 50% 124%, rgba(0,0,0,.58), transparent 56%),
    linear-gradient(158deg,#2f2415,#100a04); }
.cb-slide::before{ content:""; position:absolute; inset:0; z-index:0; pointer-events:none; opacity:.06; mix-blend-mode:overlay;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
.cb-slide::after{ content:""; position:absolute; right:-90px; bottom:-110px; width:600px; height:600px; z-index:0; pointer-events:none;
  background:var(--cb-logo, none) center/contain no-repeat; filter:invert(1); opacity:.05; }
.cb-slide > *{ position:relative; z-index:1; }
.cb-slide.photo{ background:
    radial-gradient(88% 62% at 72% 26%, rgba(150,112,66,.55), transparent 60%),
    linear-gradient(180deg, rgba(16,11,5,.15), rgba(12,8,4,.9) 82%),
    linear-gradient(135deg, #5a4630, #140d06 72%); }
.cb-slide .logo-row{ display:flex; align-items:center; gap:22px; align-self:flex-start; }
.cb-slide .monogram{ height:56px; width:56px; background:var(--cb-logo, none) center/contain no-repeat; filter:invert(1) brightness(1.25); flex:0 0 auto; }
.cb-slide .wordmark{ font-weight:600; font-size:40px; letter-spacing:.01em; }
.cb-slide .wordmark b{ color:var(--cb-ink); font-weight:600; } .cb-slide .wordmark i{ font-style:normal; color:var(--cb-accent); }
.cb-slide .fill{ flex:1 1 auto; }
.cb-slide .eyebrow{ font-size:25px; letter-spacing:.26em; text-transform:uppercase; color:var(--cb-accent); font-weight:600; }
.cb-slide .headline{ font-family:var(--cb-display); font-weight:600; letter-spacing:-.01em; line-height:1.06; color:var(--cb-ink); font-size:88px; margin-top:30px; }
.cb-slide .headline.sm{ font-size:70px; }
.cb-slide .headline .it{ font-family:var(--cb-accent-family); font-style:italic; font-weight:400; color:var(--cb-accent-alt); }
.cb-slide .rule{ height:2px; width:132px; background:var(--cb-accent); opacity:.85; margin:34px 0; }
.cb-slide .body{ font-size:33px; line-height:1.55; color:var(--cb-ink-muted); margin-top:28px; max-width:26ch; }
.cb-slide .stat{ font-family:var(--cb-display); font-weight:700; font-size:200px; line-height:.86; color:var(--cb-accent-alt); letter-spacing:-.02em; margin-top:8px; }
.cb-slide .panel{ border:1px solid var(--cb-line); border-radius:var(--cb-radius); padding:30px 32px; background:rgba(212,192,157,.05); margin-top:8px; }
.cb-slide .panel .row{ display:flex; align-items:center; gap:22px; padding:16px 0; font-size:30px; color:var(--cb-ink); }
.cb-slide .panel .row + .row{ border-top:1px solid var(--cb-line); }
.cb-slide .panel .row .tick{ color:var(--cb-accent); font-size:30px; }
.cb-slide .panel .row em{ margin-left:auto; font-style:normal; font-size:26px; color:#8c857a; }
.cb-slide .cta{ align-self:flex-start; background:var(--cb-accent); color:#1c1408; font-weight:600; font-size:32px; border-radius:var(--cb-radius); padding:28px 46px; margin-top:14px; }
.cb-slide .handle{ color:#8c857a; font-size:26px; margin-top:32px; letter-spacing:.06em; }
`.trim(),
  components: [
    { className: 'logo-row', use: 'Wrapper for the DM monogram + wordmark. Contains .monogram and .wordmark.' },
    { className: 'monogram', use: 'The geometric DM mark (an empty div; the logo shows via CSS).' },
    { className: 'wordmark', use: 'Text "detail·masters": <b>detail</b><i>masters</i>.' },
    { className: 'eyebrow', use: 'Gold uppercase kicker above the headline.' },
    { className: 'headline', use: 'Serif statement. Wrap the emphasis phrase in <span class="it"> for the gold italic signature. Add .sm for long lines.' },
    { className: 'rule', use: 'A thin gold hairline under the headline.' },
    { className: 'body', use: 'Supporting sentence(s), muted.' },
    { className: 'stat', use: 'A giant gold serif number (e.g. a percentage) for a results slide.' },
    { className: 'panel', use: 'An elegant gold-bordered card; rows via .row with a .tick and trailing <em> status.' },
    { className: 'cta', use: 'A solid gold call-to-action button.' },
    { className: 'handle', use: 'The url / @handle at the bottom, muted.' },
    { className: 'fill', use: 'An empty flex-grow spacer to bottom-anchor content.' },
  ],
  // Same 1080-wide serif scale; only vertical rhythm changes per canvas.
  formats: {
    // Story 9:16 — tall. Safe-area padding, roomier spacing, a bigger stat number.
    '1080x1920': {
      stylesheet: `
.cb-slide{ padding:210px 84px 240px; }
.cb-slide .headline{ font-size:98px; margin-top:34px; }
.cb-slide .headline.sm{ font-size:76px; }
.cb-slide .body{ font-size:35px; margin-top:32px; }
.cb-slide .stat{ font-size:230px; }
`.trim(),
    },
    // Square 1:1 — short. Tighten everything so a full composition fits.
    '1080x1080': {
      stylesheet: `
.cb-slide{ padding:68px 80px 72px; }
.cb-slide .eyebrow{ font-size:23px; }
.cb-slide .monogram{ height:48px; width:48px; }
.cb-slide .wordmark{ font-size:34px; }
.cb-slide .headline{ font-size:72px; line-height:1.08; margin-top:22px; }
.cb-slide .headline.sm{ font-size:58px; }
.cb-slide .rule{ margin:24px 0; }
.cb-slide .body{ font-size:29px; margin-top:22px; }
.cb-slide .stat{ font-size:150px; }
.cb-slide .panel{ padding:24px 26px; }
.cb-slide .panel .row{ font-size:26px; padding:12px 0; }
.cb-slide .cta{ padding:22px 40px; font-size:29px; }
.cb-slide .handle{ font-size:24px; }
`.trim(),
    },
  },
  composition: {
    align: 'flush-left',
    patterns: [
      'cover (add class "photo" to slide): logo-row → fill → eyebrow → headline(with .it) → body',
      'feature: eyebrow → headline(.it) → rule → body → fill → panel',
      'stat: eyebrow → headline → stat → body',
      'cta: logo-row → fill → eyebrow → headline(.it) → cta → handle',
    ],
  },
  imagery: {
    treatment: 'Cinematic premium-car photography, dusk-lit, with a dark gradient overlay so serif type stays legible.',
    photoRole: 'hero',
    texture: 'subtle grain on photo covers',
  },
  voice: {
    description: 'Sophisticated, premium, plain. Sells trust and ease for detailing shop owners.',
    dos: ['Benefit-led headlines', 'Concrete outcomes (no-shows, rebookings)', 'Calm confidence'],
    donts: ['Techy jargon', 'Hype', 'Exclamation marks'],
  },
});

/** Reference recipes keyed by seed business name (for the lab + wiring). */
export const REFERENCE_RECIPES: Record<string, BrandRecipe> = {
  'Dynatós Program': dynatosRecipe,
  'DetailMasters CRM': detailMastersRecipe,
};
