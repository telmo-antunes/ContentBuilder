/**
 * Hand-authored brand recipes, written for the FULL 1080×1350 export canvas
 * (Instagram-legible type). These are the "authored once" output the
 * recipe-author touchpoint produces; here they are the proven reference recipes
 * the lab validates the formula against, the worked examples the author prompt
 * ships, and fixtures.
 *
 * Each `stylesheet` is scoped to `.cb-slide` and written against the `--cb-*`
 * tokens the renderer injects. Per-slide, the composer writes only semantic
 * markup using the classes listed in `components` — coherence by construction.
 *
 * TWO of them are the real seeded brands (Dynatós, DetailMasters) — sources:
 * apps/api/src/seed.ts (real BrandKit colors/fonts/logo/voice) + the real
 * homepages; see the `contentbuilder-brands` memory. The THIRD (Halftone Press)
 * is an INVENTED reference brand, not seeded and not real: both seeded brands
 * are dark + gold, so the exemplar set had no high-key member and every authored
 * recipe drifted toward dark-moody-premium. It exists to teach LIGHT-ground
 * craft, which is a different discipline (grain must multiply, not overlay; the
 * vignette is warm grey, not black; the "light" is a near-white bloom).
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
  /**
   * SIZED FOR THE PHONE (2026-09): body 44, rows 46, tagline 46, eyebrow 34,
   * cta 40 — and a list / figures / card vocabulary this brand never had, so a
   * "three traits" post is a numbered poster rather than a paragraph.
   */
  stylesheet: `
.cb-slide{ position:absolute; inset:0; padding:96px 88px 100px; display:flex; flex-direction:column; isolation:isolate;
  color:var(--cb-ink); font-family:var(--cb-body);
  background:
    radial-gradient(78% 50% at var(--cb-glow-x,50%) var(--cb-glow-y,-8%), rgba(252,188,4,.24), transparent 62%),
    radial-gradient(125% 88% at 50% 126%, rgba(0,0,0,.62), transparent 58%),
    radial-gradient(100% 100% at 15% 8%, rgba(148,108,12,.12), transparent 46%),
    linear-gradient(178deg,#231b0d,#0b0803); }
.cb-slide::before{ content:""; position:absolute; inset:0; z-index:0; pointer-events:none; opacity:.07; mix-blend-mode:overlay;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
.cb-slide::after{ content:""; position:absolute; inset:0; z-index:0; pointer-events:none;
  background:linear-gradient(108deg, transparent 42%, rgba(253,220,123,.07) 52%, transparent 61%); }
.cb-slide > *{ position:relative; z-index:1; }
.cb-slide.photo{ background:
    linear-gradient(180deg, rgba(15,11,6,.30), rgba(11,8,3,.60) 44%, rgba(11,8,3,.94) 88%),
    var(--cb-photo, none) center/cover no-repeat,
    linear-gradient(178deg,#231b0d,#0b0803); }
.cb-slide .logo{ height:60px; width:420px; max-width:70%; background:var(--cb-logo, none) left center/contain no-repeat; align-self:flex-start; }
.cb-slide .fill{ flex:1 1 auto; }
.cb-slide .eyebrow{ font-family:var(--cb-display); font-weight:600; font-size:34px; letter-spacing:.22em; text-transform:uppercase; color:var(--cb-accent); }
.cb-slide .headline{ font-family:var(--cb-display); font-weight:var(--cb-display-weight,700); text-transform:var(--cb-display-case,uppercase); font-size:112px; line-height:.94; letter-spacing:var(--cb-display-tracking,.005em); color:var(--cb-ink); margin-top:calc(26px * var(--cb-step,1)); }
.cb-slide .headline.sm{ font-size:82px; }
.cb-slide .tagline{ font-family:var(--cb-accent-family); font-style:italic; color:var(--cb-accent); font-size:46px; line-height:1.28; margin-top:32px; max-width:24ch; }
.cb-slide .rule{ height:6px; width:132px; background:var(--cb-accent); margin:34px 0; border-radius:3px; }
.cb-slide .body{ font-size:44px; line-height:1.45; color:var(--cb-ink-muted); margin-top:26px; max-width:22ch; }
.cb-slide .quote{ font-family:var(--cb-accent-family); font-style:italic; font-size:68px; line-height:1.22; color:var(--cb-ink); letter-spacing:-.01em; }
.cb-slide .quote .em{ color:var(--cb-accent); }
.cb-slide .attr{ font-family:var(--cb-display); font-weight:600; text-transform:uppercase; letter-spacing:.16em; font-size:34px; color:#a07d16; margin-top:34px; }
.cb-slide .stat{ font-family:var(--cb-display); font-weight:700; font-size:240px; line-height:.86; color:var(--cb-accent); letter-spacing:-.01em; margin-top:8px; }
.cb-slide .stat + .tagline{ margin-top:16px; }
.cb-slide .panel{ border-left:6px solid var(--cb-accent); padding:6px 0 6px 40px; margin-top:12px; }
.cb-slide .panel .row{ font-family:var(--cb-display); font-weight:600; text-transform:uppercase; letter-spacing:.03em; padding:20px 0; font-size:46px; line-height:1.2; color:var(--cb-ink); }
.cb-slide .panel .row + .row{ border-top:1px solid var(--cb-line); }
.cb-slide .panel .row em{ display:block; font-family:var(--cb-body); font-weight:400; text-transform:none; letter-spacing:0; font-style:normal; font-size:34px; line-height:1.35; color:var(--cb-ink-muted); margin-top:6px; }
.cb-slide .figures{ display:grid; grid-template-columns:1fr 1fr; gap:22px; margin-top:8px; }
.cb-slide .figure{ border:1px solid var(--cb-line); border-radius:var(--cb-radius); padding:30px 32px 26px; background:rgba(252,188,4,.05); }
.cb-slide .figure b{ display:block; font-family:var(--cb-display); font-weight:700; font-size:120px; line-height:.9; color:var(--cb-accent); }
.cb-slide .figure em{ display:block; font-style:normal; font-size:34px; line-height:1.3; color:var(--cb-ink-muted); margin-top:14px; }
.cb-slide .card{ border:1px solid var(--cb-line); border-left:6px solid var(--cb-accent); border-radius:var(--cb-radius); padding:38px 42px; background:rgba(252,188,4,.05); margin-top:28px; }
.cb-slide .card .body, .cb-slide .card .quote{ margin-top:0; }
.cb-slide .cta{ font-family:var(--cb-display); font-weight:600; letter-spacing:.08em; text-transform:uppercase; align-self:flex-start; background:var(--cb-accent); color:#1c1305; border-radius:var(--cb-radius); padding:28px 48px; font-size:40px; margin-top:20px; }
.cb-slide .handle{ font-family:var(--cb-display); font-weight:600; letter-spacing:.2em; text-transform:uppercase; font-size:34px; color:#8f8778; margin-top:32px; }
.cb-slide{ --cb-row-index-color:var(--cb-accent); --cb-row-index-size:1em; --cb-dont-opacity:.5; }
/* CONSTRUCTED EXHIBITS (2026-09) — the forms the swipe file is made of and the
   deck never had: a STEP CHEVRON for a short method, a two-column COMPARE for a
   verdict, a LEDGER of numbers with their labels, a CHECKLIST with ticks. Each
   is a list variant; compose picks it only when the content suits it. The steps
   and the ledger use their own unit classes (.step, .line) because the app owns
   the layout of every enumeration line — a grid with the marker in its gutter. */
.cb-slide .steps{ display:flex; gap:8px; margin-top:36px; }
.cb-slide .step{ flex:1 1 0; min-width:0; background:rgba(252,188,4,.12); color:var(--cb-ink); font-family:var(--cb-display); font-weight:600; text-transform:uppercase; letter-spacing:.03em; font-size:34px; line-height:1.15; padding:34px 22px 34px 48px;
  clip-path:polygon(0 0, calc(100% - 26px) 0, 100% 50%, calc(100% - 26px) 100%, 0 100%, 26px 50%); }
.cb-slide .step:first-child{ padding-left:30px; clip-path:polygon(0 0, calc(100% - 26px) 0, 100% 50%, calc(100% - 26px) 100%, 0 100%); }
.cb-slide .step:last-child{ background:var(--cb-accent); color:#1c1305; }
.cb-slide .compare{ display:grid; grid-template-columns:1fr 1fr; column-gap:28px; row-gap:16px; grid-auto-flow:row dense; margin-top:28px; }
.cb-slide .compare .row{ padding:22px 26px; font-family:var(--cb-display); font-weight:600; text-transform:uppercase; letter-spacing:.03em; font-size:38px; line-height:1.22; color:var(--cb-ink); border:1px solid var(--cb-line); border-radius:var(--cb-radius); background:rgba(236,228,211,.04); }
.cb-slide .compare .row.do{ grid-column:1; border-color:var(--cb-accent); }
.cb-slide .compare .row.dont{ grid-column:2; }
.cb-slide .compare .row em{ display:block; font-family:var(--cb-body); font-weight:400; text-transform:none; letter-spacing:0; font-style:normal; font-size:32px; line-height:1.3; color:var(--cb-ink-muted); margin-top:6px; }
.cb-slide .ledger{ margin-top:20px; }
.cb-slide .ledger .line{ display:flex; align-items:baseline; justify-content:space-between; gap:28px; padding:24px 0; border-bottom:1px solid var(--cb-line); }
.cb-slide .ledger .line em{ font-style:normal; font-size:40px; line-height:1.25; color:var(--cb-ink-muted); flex:1 1 auto; }
.cb-slide .ledger .line b{ font-family:var(--cb-display); font-weight:700; font-size:80px; line-height:.95; color:var(--cb-accent); letter-spacing:-.01em; flex:0 0 auto; white-space:nowrap; }
.cb-slide .checks .row.row::before{ content:"✓"; width:44px; height:44px; border-radius:50%; background:var(--cb-accent); color:#1c1305; font-size:26px; font-weight:700; line-height:44px; text-align:center; align-self:center; }
`.trim(),
  components: [
    { className: 'logo', use: 'The DYNATÓS·PROGRAM wordmark. Put on covers and the CTA, top-left.' },
    { className: 'eyebrow', use: 'Small gold uppercase kicker above the headline (a section/label).' },
    { className: 'headline', use: 'The main statement — condensed uppercase. Add .sm for longer lines.' },
    { className: 'tagline', use: 'THE SIGNATURE: a gold italic-serif payoff line. Under a headline, or the reading under a stat.' },
    { className: 'rule', use: 'A short gold underline; separates headline from body when both are present.' },
    { className: 'body', use: 'Supporting sentence(s), muted. Never the only thing on a slide.' },
    { className: 'quote', use: 'A large italic-serif line — the slide\'s OBJECT (a rule to live by, a line to keep) or a pull-quote; wrap the punchy phrase in <span class="em">.' },
    { className: 'attr', use: 'Quote attribution, small gold uppercase — only for a person\'s words.' },
    { className: 'stat', use: 'One giant gold number at poster size; the .tagline after it is its reading.' },
    { className: 'panel', use: 'A gold-ruled list of .row items in condensed caps (add .numbered for a counted method).' },
    { className: 'figures', use: 'A two-column exhibit of .figure cells for two to four numbers that ARE the slide.' },
    { className: 'figure', use: 'One exhibit cell: <b> the figure, <em> its label.' },
    { className: 'steps', use: 'A horizontal chevron of .step cells — a short method as a process, two to four steps of a few words each.' },
    { className: 'step', use: 'One arrow of the chevron; the last one is filled in the accent.' },
    { className: 'compare', use: 'Two columns of .row items with a verdict: rows marked do sit left, dont right. The contrast is the exhibit.' },
    { className: 'ledger', use: 'A table of .line items — <em> the label, <b> the figure right-aligned — for three to six numbers.' },
    { className: 'line', use: 'One ledger line: label left, figure right.' },
    { className: 'checks', use: 'Add to .panel: every .row gets a filled tick — a checklist, not a verdict.' },
    { className: 'card', use: 'A gold-ruled surface holding one claim\'s evidence or the slide\'s object.' },
    { className: 'cta', use: 'A solid gold call-to-action button. One per CTA slide.' },
    { className: 'handle', use: 'The @handle, small muted uppercase, at the very bottom.' },
    { className: 'fill', use: 'An empty spacer div (flex-grow). Use to bottom-anchor or centre.' },
  ],
  // Same 1080-wide type scale; only the vertical rhythm changes per canvas.
  formats: {
    '1080x1920': {
      stylesheet: `
.cb-slide{ padding:210px 88px 240px; }
.cb-slide .headline{ font-size:124px; margin-top:30px; }
.cb-slide .headline.sm{ font-size:92px; }
.cb-slide .tagline{ font-size:50px; margin-top:40px; }
.cb-slide .body{ font-size:46px; margin-top:32px; }
.cb-slide .quote{ font-size:78px; }
.cb-slide .panel .row{ font-size:48px; }
.cb-slide .stat{ font-size:260px; }
`.trim(),
    },
    '1080x1080': {
      stylesheet: `
.cb-slide{ padding:72px 84px 76px; }
.cb-slide .headline{ font-size:92px; line-height:.96; margin-top:20px; }
.cb-slide .headline.sm{ font-size:68px; }
.cb-slide .tagline{ font-size:44px; margin-top:22px; }
.cb-slide .rule{ margin:24px 0; }
.cb-slide .body{ font-size:44px; margin-top:20px; }
.cb-slide .quote{ font-size:58px; }
.cb-slide .panel .row{ font-size:42px; padding:14px 0; }
.cb-slide .stat{ font-size:180px; }
.cb-slide .figure b{ font-size:96px; }
.cb-slide .cta{ padding:22px 40px; font-size:40px; }
`.trim(),
    },
  },
  /**
   * WORKED FRAGMENTS — the seven forms, in this brand's blunter register:
   * cover (bleed · inset) · statement (one-liner · anchored low · card) ·
   * feature (type first · numbered poster · product proof) · list (ruled
   * panel · numbered · exhibit) · stat · quote (the object) · cta (the arrival).
   */
  fragments: {
    cover: [
      `<div class="logo"></div>
<div class="fill"></div>
<div class="eyebrow">{{eyebrow}}</div>
<div class="headline">{{headline}}</div>
<div class="tagline">{{tagline}}</div>`,
      `<div class="logo"></div>
<div class="fill"></div>
<div class="eyebrow">{{eyebrow}}</div>
<div class="headline">{{headline}}</div>
<div class="tagline">{{tagline}}</div>
<figure class="cb-shot" data-cb-slot="hero"></figure>`,
    ],
    statement: [
      `<div class="fill"></div>
<div class="eyebrow">{{eyebrow}}</div>
<div class="headline">{{headline}}</div>
<div class="tagline">{{tagline}}</div>
<div class="fill"></div>`,
      `<div class="eyebrow">{{eyebrow}}</div>
<div class="fill"></div>
<div class="headline">{{headline}}</div>
<div class="rule"></div>
<div class="body">{{body}}</div>`,
    ],
    feature: [
      `<div class="eyebrow">{{eyebrow}}</div>
<div class="headline sm">{{headline}}</div>
<div class="rule"></div>
<div class="body">{{body}}</div>
<div class="fill"></div>
<figure class="cb-shot" data-cb-slot="hero"></figure>`,
      `<div class="eyebrow">{{eyebrow}}</div>
<div class="headline sm">{{headline}}</div>
<div class="panel numbered">{{#rows}}<div class="row">{{row.text}}<em>{{row.note}}</em></div>{{/rows}}</div>
<div class="fill"></div>`,
      `<div class="eyebrow">{{eyebrow}}</div>
<div class="headline sm">{{headline}}</div>
<div class="body">{{body}}</div>
<div class="fill"></div>
<figure class="cb-shot wide" data-cb-slot="proof"></figure>`,
    ],
    list: [
      `<div class="eyebrow">{{eyebrow}}</div>
<div class="headline sm">{{headline}}</div>
<div class="panel">{{#rows}}<div class="row">{{row.text}}<em>{{row.note}}</em></div>{{/rows}}</div>
<div class="fill"></div>`,
      `<div class="eyebrow">{{eyebrow}}</div>
<div class="headline">{{headline}}</div>
<div class="body">{{body}}</div>
<div class="fill"></div>
<div class="panel numbered">{{#rows}}<div class="row">{{row.text}}<em>{{row.note}}</em></div>{{/rows}}</div>`,
      `<div class="eyebrow">{{eyebrow}}</div>
<div class="headline sm">{{headline}}</div>
<div class="fill"></div>
<div class="figures">{{#rows}}<div class="figure"><b>{{row.text}}</b><em>{{row.note}}</em></div>{{/rows}}</div>
<div class="fill"></div>`,
      // The STEP CHEVRON: a short method as a process — two to four rows of a few words, no notes.
      `<div class="eyebrow">{{eyebrow}}</div>
<div class="headline sm">{{headline}}</div>
<div class="body">{{body}}</div>
<div class="fill"></div>
<div class="steps">{{#rows}}<div class="step">{{row.text}}</div>{{/rows}}</div>
<div class="fill"></div>`,
      // The COMPARE: a verdict as two columns — do rows left, dont rows right.
      `<div class="eyebrow">{{eyebrow}}</div>
<div class="headline sm">{{headline}}</div>
<div class="fill"></div>
<div class="compare">{{#rows}}<div class="row">{{row.text}}<em>{{row.note}}</em></div>{{/rows}}</div>
<div class="fill"></div>`,
      // The LEDGER: three to six numbers with their labels, read as a table.
      `<div class="eyebrow">{{eyebrow}}</div>
<div class="headline sm">{{headline}}</div>
<div class="fill"></div>
<div class="ledger">{{#rows}}<div class="line"><em>{{row.note}}</em><b>{{row.text}}</b></div>{{/rows}}</div>
<div class="fill"></div>`,
      // The CHECKLIST: plain rows, each with a filled tick — things to have, not a verdict.
      `<div class="eyebrow">{{eyebrow}}</div>
<div class="headline sm">{{headline}}</div>
<div class="rule"></div>
<div class="panel checks">{{#rows}}<div class="row">{{row.text}}<em>{{row.note}}</em></div>{{/rows}}</div>
<div class="fill"></div>`,
    ],
    stat: `<div class="eyebrow">{{eyebrow}}</div>
<div class="fill"></div>
<div class="stat">{{stat}}</div>
<div class="tagline">{{tagline}}</div>
<div class="body">{{body}}</div>`,
    quote: `<div class="eyebrow">{{eyebrow}}</div>
<div class="fill"></div>
<div class="quote">{{quote}}</div>
<div class="attr">{{attribution}}</div>
<div class="fill"></div>`,
    cta: `<div class="logo"></div>
<div class="fill"></div>
<div class="headline">{{headline}}</div>
<div class="tagline">{{tagline}}</div>
<div class="cta">{{cta}}</div>
<div class="fill"></div>`,
  },
  composition: {
    align: 'flush-left',
    patterns: [
      'cover (photo as background): logo → fill → eyebrow → headline → tagline (the picture owns the frame)',
      'cover: logo → fill → eyebrow → headline → tagline → cb-shot hero (inset hero)',
      'statement: fill → eyebrow → headline → tagline → fill (ONE LINE, centred)',
      'statement: eyebrow → fill → headline → rule → body (anchored low)',
      'feature: eyebrow → headline.sm → rule → body → fill → cb-shot (type first, picture last)',
      'feature: eyebrow → headline.sm → panel.numbered of rows → fill (numbered teaching poster)',
      'feature: eyebrow → headline.sm → body → fill → cb-shot.wide (product proof closing the frame)',
      'list: eyebrow → headline.sm → panel of rows → fill (ruled list, verdict rows)',
      'list: eyebrow → headline → body (a lead-in line) → fill → panel.numbered of rows (a numbered method)',
      'list: eyebrow → headline.sm → fill → figures of figure cells → fill (an exhibit)',
      'list: eyebrow → headline.sm → body → fill → steps of step cells → fill (a step chevron: a method as a process)',
      'list: eyebrow → headline.sm → fill → compare of rows → fill (a verdict as two columns)',
      'list: eyebrow → headline.sm → fill → ledger of line items → fill (numbers as a table)',
      'list: eyebrow → headline.sm → rule → panel.checks of rows → fill (a checklist with ticks)',
      'stat: eyebrow → fill → stat → tagline (its reading) → body',
      'quote: eyebrow → fill → quote → attr → fill (the object, or a pull-quote)',
      'cta: logo → fill → headline → tagline → cta → fill (the arrival)',
    ],
  },
  imagery: {
    treatment: 'Moody, warm-lit portraits of disciplined men; dark so gold + off-white type sits on top.',
    photoRole: 'accent',
    texture: 'faint warm grain',
    subjects: ['moody gym portrait man', 'dark athletic training', 'sunrise discipline run'],
  },
  surfaces: {
    // One bone-coloured slide mid-carousel breaks the dark run and resets the eye.
    inverse: { ground: '#ece4d3', ink: '#171208', accent: '#8a6a06', inkMuted: '#5c5344' },
  },
  rationale: {
    palette: 'Near-black ground with a single rationed gold: the site is dark and the gold is the only bright note, so it must stay scarce to keep meaning.',
    type: 'Condensed uppercase display for force at thumbnail size; a serif italic accent supplies the warmth the caps refuse.',
    signature: 'The gold italic-serif line is the brand\'s voice made visible — it lands the payoff after the headline shouts.',
    motion: 'Discipline is repetition under load, so type arrives with force and no drift.',
  },
  voice: {
    description: 'Direct, masculine, motivational. Speaks to discipline and becoming a pillar for others.',
    dos: ['Short, declarative lines', 'Address the reader ("you")', 'Confidence without hype'],
    donts: ['Corporate filler', 'Exclamation marks', 'Softeners like "maybe" / "just"'],
  },
  // Discipline hits — type lands with force, fast and tight.
  motion: {
    style: 'punch',
    pace: 'punchy',
    description: 'Type lands with force — each line punches in fast and tight, like a rep completed.',
    roles: {
      // The cover sets the tone with weight rather than speed.
      cover: { style: 'rise', pace: 'balanced' },
      // A quote is a pause for breath — let it settle in.
      quote: { style: 'fade', pace: 'calm' },
      // A number should hit hardest of all.
      stat: { style: 'pop', pace: 'punchy' },
      // The ask arrives decisively.
      cta: { style: 'punch', pace: 'punchy' },
    },
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
  /**
   * SIZED FOR THE PHONE, NOT THE CANVAS — every size here clears the type
   * floor by design rather than by repair: body 44 (16pt), rows 46 (17pt),
   * tagline 48, cta 40, eyebrow/handle 34. The 2026-09 audit measured the
   * previous 33px body and 30px rows against the owner's bar and scored
   * legibility 1; the floor was raising them at render, which is a safety
   * net, not a design. A row is styled as a SURFACE only (no flex, no
   * margin-left:auto) — the app owns its gutter and marker.
   */
  stylesheet: `
.cb-slide{ position:absolute; inset:0; padding:88px 84px 92px; display:flex; flex-direction:column; isolation:isolate;
  color:var(--cb-ink); font-family:var(--cb-body);
  background:
    radial-gradient(64% 44% at var(--cb-glow-x,82%) var(--cb-glow-y,6%), rgba(193,154,92,.30), transparent 60%),
    radial-gradient(120% 92% at 50% 124%, rgba(0,0,0,.58), transparent 56%),
    linear-gradient(158deg,#2f2415,#100a04); }
.cb-slide::before{ content:""; position:absolute; inset:0; z-index:0; pointer-events:none; opacity:.06; mix-blend-mode:overlay;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
.cb-slide::after{ content:""; position:absolute; right:-90px; bottom:-110px; width:600px; height:600px; z-index:0; pointer-events:none;
  background:var(--cb-logo, none) center/contain no-repeat; filter:invert(1); opacity:.05; }
.cb-slide > *{ position:relative; z-index:1; }
.cb-slide.photo{ background:
    linear-gradient(180deg, rgba(16,11,5,.28), rgba(12,8,4,.55) 42%, rgba(12,8,4,.92) 86%),
    var(--cb-photo, none) center/cover no-repeat,
    linear-gradient(135deg, #5a4630, #140d06 72%); }
.cb-slide .logo-row{ display:flex; align-items:center; gap:22px; align-self:flex-start; }
.cb-slide .monogram{ height:56px; width:56px; background:var(--cb-logo, none) center/contain no-repeat; filter:invert(1) brightness(1.25); flex:0 0 auto; }
.cb-slide .wordmark{ font-weight:600; font-size:40px; letter-spacing:.01em; }
.cb-slide .wordmark b{ color:var(--cb-ink); font-weight:600; } .cb-slide .wordmark i{ font-style:normal; color:var(--cb-accent); }
.cb-slide .fill{ flex:1 1 auto; }
.cb-slide .eyebrow{ font-size:34px; letter-spacing:.22em; text-transform:uppercase; color:var(--cb-accent); font-weight:600; }
.cb-slide .headline{ font-family:var(--cb-display); font-weight:var(--cb-display-weight,600); text-transform:var(--cb-display-case,none); letter-spacing:var(--cb-display-tracking,-.01em); line-height:1.06; color:var(--cb-ink); font-size:96px; margin-top:calc(28px * var(--cb-step,1)); }
.cb-slide .headline.sm{ font-size:72px; }
.cb-slide .headline .it{ font-family:var(--cb-accent-family); font-style:italic; font-weight:400; color:var(--cb-accent-alt); }
.cb-slide .rule{ height:2px; width:132px; background:var(--cb-accent); opacity:.85; margin:32px 0; }
.cb-slide .tagline{ font-family:var(--cb-accent-family); font-style:italic; font-size:48px; line-height:1.3; color:var(--cb-accent-alt); margin-top:28px; max-width:20ch; }
.cb-slide .body{ font-size:44px; line-height:1.45; color:var(--cb-ink-muted); margin-top:26px; max-width:22ch; }
.cb-slide .quote{ font-family:var(--cb-accent-family); font-style:italic; font-size:64px; line-height:1.25; color:var(--cb-ink); letter-spacing:-.01em; }
.cb-slide .attr{ font-size:34px; font-weight:600; letter-spacing:.14em; text-transform:uppercase; color:var(--cb-accent); margin-top:32px; }
.cb-slide .stat{ font-family:var(--cb-display); font-weight:700; font-size:220px; line-height:.86; color:var(--cb-accent-alt); letter-spacing:-.02em; margin-top:8px; }
.cb-slide .stat + .tagline{ margin-top:18px; max-width:24ch; }
.cb-slide .panel{ border:1px solid var(--cb-line); border-radius:var(--cb-radius); padding:22px 34px; background:rgba(212,192,157,.05); margin-top:8px; }
.cb-slide .panel .row{ padding:22px 0; font-size:46px; line-height:1.25; color:var(--cb-ink); }
.cb-slide .panel .row + .row{ border-top:1px solid var(--cb-line); }
.cb-slide .panel .row em{ display:block; font-style:normal; font-size:34px; line-height:1.35; color:#a89f8f; margin-top:6px; }
.cb-slide .figures{ display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-top:8px; }
.cb-slide .figure{ border:1px solid var(--cb-line); border-radius:var(--cb-radius); padding:34px 36px 30px; background:rgba(212,192,157,.05); }
.cb-slide .figure b{ display:block; font-family:var(--cb-display); font-weight:700; font-size:112px; line-height:.9; color:var(--cb-accent-alt); letter-spacing:-.02em; }
.cb-slide .figure em{ display:block; font-style:normal; font-size:34px; line-height:1.3; color:var(--cb-ink-muted); margin-top:16px; }
.cb-slide .cta{ align-self:flex-start; background:var(--cb-accent); color:#1c1408; font-weight:600; font-size:40px; border-radius:var(--cb-radius); padding:28px 48px; margin-top:22px; }
.cb-slide .handle{ color:#8c857a; font-size:34px; margin-top:32px; letter-spacing:.06em; }
.cb-slide .card{ border:1.5px solid var(--cb-line); border-radius:var(--cb-radius); padding:40px 44px; background:linear-gradient(180deg, rgba(212,192,157,.06), rgba(212,192,157,.02)); position:relative; margin-top:30px; }
.cb-slide .card .body, .cb-slide .card .quote{ margin-top:0; }
.cb-slide .card.win{ border-color:var(--cb-accent); box-shadow:0 18px 60px rgba(193,154,92,.12); }
.cb-slide .badge{ position:absolute; top:-20px; left:44px; background:var(--cb-accent); color:#1c1408; border-radius:999px; padding:11px 24px; font-size:26px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; }
.cb-slide .chip{ display:inline-block; border:1.5px solid var(--cb-line); border-radius:999px; padding:14px 26px; font-size:30px; color:var(--cb-ink-muted); letter-spacing:.06em; margin-top:28px; }
.cb-slide{ --cb-row-index-color:var(--cb-accent); --cb-row-index-size:1.1em; --cb-dont-opacity:.55; }
/* CONSTRUCTED EXHIBITS (2026-09) — the forms the swipe file is made of and the
   deck never had: a STEP CHEVRON for a short method, a two-column COMPARE for a
   verdict, a LEDGER of numbers with their labels, a CHECKLIST with ticks. Each
   is a list variant; compose picks it only when the content suits it. The steps
   and the ledger use their own unit classes (.step, .line) because the app owns
   the layout of every enumeration line — a grid with the marker in its gutter. */
.cb-slide .steps{ display:flex; gap:8px; margin-top:36px; }
.cb-slide .step{ flex:1 1 0; min-width:0; background:rgba(212,192,157,.10); color:var(--cb-ink); font-weight:600; font-size:34px; line-height:1.15; padding:34px 22px 34px 48px;
  clip-path:polygon(0 0, calc(100% - 26px) 0, 100% 50%, calc(100% - 26px) 100%, 0 100%, 26px 50%); }
.cb-slide .step:first-child{ padding-left:30px; clip-path:polygon(0 0, calc(100% - 26px) 0, 100% 50%, calc(100% - 26px) 100%, 0 100%); }
.cb-slide .step:last-child{ background:var(--cb-accent); color:#1c1408; }
.cb-slide .compare{ display:grid; grid-template-columns:1fr 1fr; column-gap:28px; row-gap:16px; grid-auto-flow:row dense; margin-top:28px; }
.cb-slide .compare .row{ padding:22px 26px; font-weight:600; font-size:38px; line-height:1.22; color:var(--cb-ink); border:1px solid var(--cb-line); border-radius:var(--cb-radius); background:rgba(212,192,157,.05); }
.cb-slide .compare .row.do{ grid-column:1; border-color:var(--cb-accent); }
.cb-slide .compare .row.dont{ grid-column:2; }
.cb-slide .compare .row em{ display:block; font-style:normal; font-size:32px; line-height:1.3; color:var(--cb-ink-muted); margin-top:6px; }
.cb-slide .ledger{ margin-top:20px; }
.cb-slide .ledger .line{ display:flex; align-items:baseline; justify-content:space-between; gap:28px; padding:24px 0; border-bottom:1px solid var(--cb-line); }
.cb-slide .ledger .line em{ font-style:normal; font-size:40px; line-height:1.25; color:var(--cb-ink-muted); flex:1 1 auto; }
.cb-slide .ledger .line b{ font-family:var(--cb-display); font-weight:700; font-size:80px; line-height:.95; color:var(--cb-accent-alt); letter-spacing:-.01em; flex:0 0 auto; white-space:nowrap; }
.cb-slide .checks .row.row::before{ content:"✓"; width:44px; height:44px; border-radius:50%; background:var(--cb-accent); color:#1c1408; font-size:26px; font-weight:700; line-height:44px; text-align:center; align-self:center; }
`.trim(),
  components: [
    { className: 'logo-row', use: 'Wrapper for the DM monogram + wordmark. Contains .monogram and .wordmark.' },
    { className: 'monogram', use: 'The geometric DM mark (an empty div; the logo shows via CSS).' },
    { className: 'wordmark', use: 'Text "detail·masters": <b>detail</b><i>masters</i>.' },
    { className: 'eyebrow', use: 'Gold uppercase kicker above the headline.' },
    { className: 'headline', use: 'Serif statement. Wrap the emphasis phrase in <span class="it"> for the gold italic signature. Add .sm for long lines.' },
    { className: 'rule', use: 'A thin gold hairline under the headline.' },
    { className: 'tagline', use: 'One short payoff line in gold italic serif — the second voice under a headline, or the reading under a stat.' },
    { className: 'body', use: 'Supporting sentence(s), muted. Never the only thing on a slide.' },
    { className: 'quote', use: 'The slide\'s OBJECT in large italic serif — a template, a message to copy, a rule, or a testimonial. Usually inside a .card.' },
    { className: 'attr', use: 'Small gold uppercase attribution under a quote — only for a person\'s words.' },
    { className: 'stat', use: 'A giant gold serif number at poster size; the .tagline after it is its reading.' },
    { className: 'panel', use: 'A gold-bordered list surface holding .row items (add .numbered for a counted method).' },
    { className: 'figures', use: 'A two-column exhibit of .figure cards — each a number with its label — for two to four figures that ARE the slide.' },
    { className: 'figure', use: 'One exhibit cell: <b> the figure, <em> its label.' },
    { className: 'steps', use: 'A horizontal chevron of .step cells — a short method as a process, two to four steps of a few words each.' },
    { className: 'step', use: 'One arrow of the chevron; the last one is filled in the accent.' },
    { className: 'compare', use: 'Two columns of .row items with a verdict: rows marked do sit left, dont right. The contrast is the exhibit.' },
    { className: 'ledger', use: 'A table of .line items — <em> the label, <b> the figure right-aligned — for three to six numbers.' },
    { className: 'line', use: 'One ledger line: label left, figure right.' },
    { className: 'checks', use: 'Add to .panel: every .row gets a filled tick — a checklist, not a verdict.' },
    { className: 'card', use: 'A framed surface grouping a claim\'s evidence or holding the slide\'s object. Add .win for the option that carries the verdict.' },
    { className: 'badge', use: 'A small filled label on a card\'s corner, naming the winner or the point.' },
    { className: 'chip', use: 'A bordered capsule for one piece of metadata (a topic, a read time).' },
    { className: 'cta', use: 'A solid gold call-to-action button.' },
    { className: 'handle', use: 'The url / @handle at the bottom, muted.' },
    { className: 'fill', use: 'An empty flex-grow spacer to bottom-anchor or centre content.' },
  ],
  // Same 1080-wide serif scale; only vertical rhythm changes per canvas.
  formats: {
    // Story 9:16 — tall. Safe-area padding, roomier spacing, a bigger stat number.
    '1080x1920': {
      stylesheet: `
.cb-slide{ padding:210px 84px 240px; }
.cb-slide .headline{ font-size:100px; margin-top:34px; }
.cb-slide .headline.sm{ font-size:76px; }
.cb-slide .tagline{ font-size:50px; }
.cb-slide .body{ font-size:46px; margin-top:32px; }
.cb-slide .panel .row{ font-size:48px; }
.cb-slide .stat{ font-size:240px; }
`.trim(),
    },
    // Square 1:1 — short. Tighten the rhythm, never the floors.
    '1080x1080': {
      stylesheet: `
.cb-slide{ padding:68px 80px 72px; }
.cb-slide .monogram{ height:48px; width:48px; }
.cb-slide .wordmark{ font-size:36px; }
.cb-slide .headline{ font-size:76px; line-height:1.08; margin-top:22px; }
.cb-slide .headline.sm{ font-size:60px; }
.cb-slide .rule{ margin:22px 0; }
.cb-slide .tagline{ font-size:44px; margin-top:20px; }
.cb-slide .body{ font-size:44px; margin-top:20px; }
.cb-slide .quote{ font-size:56px; }
.cb-slide .stat{ font-size:160px; }
.cb-slide .panel{ padding:16px 28px; }
.cb-slide .panel .row{ font-size:42px; padding:16px 0; }
.cb-slide .figure b{ font-size:92px; }
.cb-slide .cta{ padding:22px 40px; font-size:40px; }
`.trim(),
    },
  },
  /**
   * WORKED FRAGMENTS — the seven forms a good deck is made of.
   *
   * The author prompt has always ASKED for fragments and no exemplar had
   * shown the FORMS, so every authored brand produced one eyebrow/headline/
   * body stack and one list panel — and every post read as the last one with
   * the words swapped. Prose lost to the exemplar, as it did for ground tone
   * before Halftone Press. So this exemplar carries, as variants the app
   * rotates per slide and per deck:
   *   cover     — the picture owns the frame (bleed) · an inset hero
   *   statement — a bare ONE-LINER · the claim with its evidence in a card ·
   *               the claim anchored low
   *   feature   — type first, picture last · a NUMBERED teaching poster ·
   *               PRODUCT PROOF (the screenshot closing the frame)
   *   list      — the marker panel · numbered · an EXHIBIT of figures
   *   stat      — one number at poster size with its reading
   *   quote     — the slide's OBJECT (a template, a rule) in a card
   *   cta       — an ARRIVAL: one line, one italic tagline, one button
   * Variant i implements arrangement i of that role's patterns.
   */
  fragments: {
    cover: [
      // The picture owns the frame: no slot — the app places the photograph as
      // the background layer under the scrim, and the lockup sits on the dark end.
      `<div class="logo-row"><div class="monogram"></div><div class="wordmark"><b>detail</b><i>masters</i></div></div>
<div class="fill"></div>
<div class="eyebrow">{{eyebrow}}</div>
<div class="headline">{{headline}}</div>
<div class="tagline">{{tagline}}</div>`,
      // An inset hero under the lockup — the picture as evidence for the line.
      `<div class="logo-row"><div class="monogram"></div><div class="wordmark"><b>detail</b><i>masters</i></div></div>
<div class="fill"></div>
<div class="eyebrow">{{eyebrow}}</div>
<div class="headline">{{headline}}</div>
<div class="tagline">{{tagline}}</div>
<figure class="cb-shot" data-cb-slot="hero"></figure>`,
    ],
    statement: [
      // ONE LINE, nothing under it — centred in the frame by the spacers.
      `<div class="fill"></div>
<div class="eyebrow">{{eyebrow}}</div>
<div class="headline">{{headline}}</div>
<div class="rule"></div>
<div class="tagline">{{tagline}}</div>
<div class="fill"></div>`,
      // Anchored low: the label on the top edge, the claim on the baseline.
      `<div class="eyebrow">{{eyebrow}}</div>
<div class="fill"></div>
<div class="headline">{{headline}}</div>
<div class="rule"></div>
<div class="body">{{body}}</div>`,
    ],
    feature: [
      // Type first, the picture last — a different silhouette, not the same one respaced.
      `<div class="eyebrow">{{eyebrow}}</div>
<div class="headline">{{headline}}</div>
<div class="rule"></div>
<div class="body">{{body}}</div>
<div class="fill"></div>
<figure class="cb-shot" data-cb-slot="hero"></figure>`,
      // The numbered teaching poster: the method as counted rows, big enough to read.
      `<div class="eyebrow">{{eyebrow}}</div>
<div class="headline sm">{{headline}}</div>
<div class="rule"></div>
<div class="panel numbered">{{#rows}}<div class="row">{{row.text}}<em>{{row.note}}</em></div>{{/rows}}</div>
<div class="fill"></div>`,
      // PRODUCT PROOF: the control as the headline, one line, the screenshot closing the frame.
      `<div class="eyebrow">{{eyebrow}}</div>
<div class="headline sm">{{headline}}</div>
<div class="body">{{body}}</div>
<div class="fill"></div>
<figure class="cb-shot wide" data-cb-slot="proof"></figure>`,
    ],
    list: [
      // The marker panel: quiet, scannable, the default. Verdict rows draw ✓/✕ here.
      `<div class="eyebrow">{{eyebrow}}</div>
<div class="headline sm">{{headline}}</div>
<div class="rule"></div>
<div class="panel">{{#rows}}<div class="row">{{row.text}}<em>{{row.note}}</em></div>{{/rows}}</div>
<div class="fill"></div>`,
      // Numbered: the app counts the rows in the gutter, which turns a list into a
      // method. Carries a lead-in body line — a planned brief writes one for every
      // beat, and without a hole for it every list went to the model.
      `<div class="eyebrow">{{eyebrow}}</div>
<div class="headline">{{headline}}</div>
<div class="body">{{body}}</div>
<div class="fill"></div>
<div class="panel numbered">{{#rows}}<div class="row">{{row.text}}<em>{{row.note}}</em></div>{{/rows}}</div>`,
      // The EXHIBIT: the rows are figures with labels, two to a line.
      `<div class="eyebrow">{{eyebrow}}</div>
<div class="headline sm">{{headline}}</div>
<div class="fill"></div>
<div class="figures">{{#rows}}<div class="figure"><b>{{row.text}}</b><em>{{row.note}}</em></div>{{/rows}}</div>
<div class="fill"></div>`,
      // The STEP CHEVRON: a short method as a process — two to four rows of a few words, no notes.
      `<div class="eyebrow">{{eyebrow}}</div>
<div class="headline sm">{{headline}}</div>
<div class="body">{{body}}</div>
<div class="fill"></div>
<div class="steps">{{#rows}}<div class="step">{{row.text}}</div>{{/rows}}</div>
<div class="fill"></div>`,
      // The COMPARE: a verdict as two columns — do rows left, dont rows right.
      `<div class="eyebrow">{{eyebrow}}</div>
<div class="headline sm">{{headline}}</div>
<div class="fill"></div>
<div class="compare">{{#rows}}<div class="row">{{row.text}}<em>{{row.note}}</em></div>{{/rows}}</div>
<div class="fill"></div>`,
      // The LEDGER: three to six numbers with their labels, read as a table.
      `<div class="eyebrow">{{eyebrow}}</div>
<div class="headline sm">{{headline}}</div>
<div class="fill"></div>
<div class="ledger">{{#rows}}<div class="line"><em>{{row.note}}</em><b>{{row.text}}</b></div>{{/rows}}</div>
<div class="fill"></div>`,
      // The CHECKLIST: plain rows, each with a filled tick — things to have, not a verdict.
      `<div class="eyebrow">{{eyebrow}}</div>
<div class="headline sm">{{headline}}</div>
<div class="rule"></div>
<div class="panel checks">{{#rows}}<div class="row">{{row.text}}<em>{{row.note}}</em></div>{{/rows}}</div>
<div class="fill"></div>`,
    ],
    // One number at poster size, and the sentence that says what it means to you.
    stat: `<div class="eyebrow">{{eyebrow}}</div>
<div class="fill"></div>
<div class="stat">{{stat}}</div>
<div class="tagline">{{tagline}}</div>
<div class="body">{{body}}</div>`,
    // The OBJECT: a template, a message, a rule — set as the thing the slide is about.
    quote: `<div class="eyebrow">{{eyebrow}}</div>
<div class="headline sm">{{headline}}</div>
<div class="fill"></div>
<div class="card"><div class="quote">{{quote}}</div></div>
<div class="attr">{{attribution}}</div>
<div class="fill"></div>`,
    // The ARRIVAL: one line, one italic tagline, one button — and nothing else.
    cta: `<div class="logo-row"><div class="monogram"></div><div class="wordmark"><b>detail</b><i>masters</i></div></div>
<div class="fill"></div>
<div class="headline">{{headline}}</div>
<div class="tagline">{{tagline}}</div>
<div class="cta">{{cta}}</div>
<div class="fill"></div>`,
  },
  composition: {
    align: 'flush-left',
    roles: { cta: 'center' },
    /**
     * ONE LINE PER ARRANGEMENT, role-prefixed, matching the fragment variants
     * index for index. A role with a single pattern gives the rotation nothing
     * to rotate.
     */
    patterns: [
      'cover (photo as background): logo-row → fill → eyebrow → headline(with .it) → tagline (the picture owns the frame)',
      'cover: logo-row → fill → eyebrow → headline(.it) → tagline → cb-shot hero (inset hero)',
      'statement: fill → eyebrow → headline(.it) → rule → tagline → fill (ONE LINE, centred)',
      'statement: eyebrow → fill → headline(.it) → rule → body (claim on the baseline)',
      'feature: eyebrow → headline(.it) → rule → body → fill → cb-shot (type first, picture last)',
      'feature: eyebrow → headline.sm(.it) → rule → panel.numbered of rows → fill (numbered teaching poster)',
      'feature: eyebrow → headline.sm(.it) → body → fill → cb-shot.wide (product proof closing the frame)',
      'list: eyebrow → headline.sm(.it) → rule → panel of rows → fill (marker panel, verdict rows)',
      'list: eyebrow → headline(.it) → fill → panel.numbered of rows (a numbered method)',
      'list: eyebrow → headline.sm(.it) → fill → figures of figure cells → fill (an exhibit)',
      'list: eyebrow → headline.sm(.it) → body → fill → steps of step cells → fill (a step chevron: a method as a process)',
      'list: eyebrow → headline.sm(.it) → fill → compare of rows → fill (a verdict as two columns)',
      'list: eyebrow → headline.sm(.it) → fill → ledger of line items → fill (numbers as a table)',
      'list: eyebrow → headline.sm(.it) → rule → panel.checks of rows → fill (a checklist with ticks)',
      'stat: eyebrow → fill → stat → tagline (its reading) → body',
      'quote: eyebrow → headline.sm(.it) → fill → card holding the quote → attr → fill (the object)',
      'cta: logo-row → fill → headline(.it) → tagline → cta → fill (the arrival, centred)',
    ],
  },
  imagery: {
    treatment: 'Cinematic premium-car photography, dusk-lit, with a dark gradient overlay so serif type stays legible; product screenshots cropped tight to the one control the slide is about.',
    photoRole: 'hero',
    texture: 'subtle grain on photo covers',
    subjects: ['luxury car detailing', 'polished car paint macro', 'car showroom dusk'],
  },
  surfaces: {
    // A warm off-white slide reads as the "spec sheet" beat in a dark deck.
    inverse: { ground: '#f2ece2', ink: '#171008', accent: '#8a6524', inkMuted: '#5f5749' },
  },
  rationale: {
    palette: 'Bronze on near-black mirrors showroom lighting on dark paint — premium without shouting.',
    type: 'Playfair throughout: the brand sells care and craft, and a serif carries that where a geometric sans would read as generic SaaS.',
    signature: 'The gold italic half-headline echoes the site\'s own emphasis, so posts feel continuous with the product.',
    motion: 'Nothing premium hurries; elements glide up as if easing into showroom light.',
  },
  voice: {
    description: 'Sophisticated, premium, plain. Sells trust and ease for detailing shop owners.',
    dos: ['Benefit-led headlines', 'Concrete outcomes (no-shows, rebookings)', 'Calm confidence'],
    donts: ['Techy jargon', 'Hype', 'Exclamation marks'],
  },
  // Premium and unhurried — elements glide up like a showroom reveal.
  motion: {
    style: 'rise',
    pace: 'calm',
    description: 'Unhurried and premium — each element glides up, like a car easing into the showroom light.',
    roles: {
      // A photo cover should simply appear, letting the image do the work.
      cover: { style: 'fade', pace: 'calm' },
      // The result number is the one moment allowed to show off.
      stat: { style: 'pop', pace: 'balanced' },
      // Feature rows read like a list being set down, one at a time.
      feature: { style: 'slide', pace: 'balanced' },
      cta: { style: 'rise', pace: 'balanced' },
    },
  },
});

/**
 * HALFTONE PRESS — an independent risograph print studio & stationery shop.
 * INVENTED (see the module header): the light/high-key member of the exemplar
 * set, so a paper-ground brand has something to learn from.
 *
 * Why it is genuinely different, not an inverted clone of the dark two:
 * · GROUND — warm uncoated stock, not white and not inverted black. The layered
 *   ground is built the way a light ground has to be: a near-white bloom for the
 *   directional light, a warm-grey inset vignette (a black one reads as dirt on
 *   paper), and paper-fibre grain blended with MULTIPLY (overlay vanishes on a
 *   light ground — the single most common light-brand failure).
 * · INK — the two riso drums, federal blue and fluorescent pink. One accent does
 *   all the work; the second tone is rationed to the signature and the plate.
 * · TYPE — a wide, heavy grotesque (Archivo 800), not condensed caps and not a
 *   serif; the serif is demoted to plate captions, the one place print uses one.
 * · SIGNATURE — "second impression": the emphasis phrase printed a second time,
 *   hard-offset in pink, like a press one pass out of register. Neither dark
 *   exemplar's signature is a colour or an offset — both are italic serif lines.
 * · TEXTURE — CSS-native halftone dot fields (radial-gradient + background-size),
 *   so an exemplar shows texture that is not a feTurbulence data URI.
 * · It is also the only exemplar that carries `motion.ambient`, a `.cb-shot`
 *   treatment and an explicit `signature.emphasisWrap` — all three are demanded
 *   by the author prompt, and the two seeded recipes predate them.
 */
export const halftonePressRecipe: BrandRecipe = brandRecipeSchema.parse({
  tokens: {
    ground: '#f5f1e6',
    groundAlt: '#e9e2d0',
    ink: '#141310',
    inkMuted: '#5d5a4e',
    accent: '#1f4bd8',
    accentAlt: '#ff4f9a',
    line: 'rgba(20,19,16,0.22)',
    displayFamily: 'Archivo',
    bodyFamily: 'Work Sans',
    accentFamily: 'Source Serif 4',
    radius: 4,
  },
  typography: { displayCase: 'sentence', displayWeight: 800, displayTracking: '-0.03em', density: 'balanced' },
  signature: {
    name: 'second impression',
    description:
      'The emphasis phrase of a headline is printed twice — blue, with a hard 7px fluorescent-pink offset behind it, like a press one pass out of register. Wrap it in <span class="em">. Once per slide, never twice.',
    emphasisWrap: { tag: 'span', className: 'em' },
  },
  stylesheet: `
.cb-slide{ position:absolute; inset:0; padding:92px 84px 96px; display:flex; flex-direction:column; isolation:isolate;
  color:var(--cb-ink); font-family:var(--cb-body);
  background:
    radial-gradient(96% 62% at 14% -8%, rgba(255,255,255,.95), transparent 58%),
    radial-gradient(78% 58% at 104% 106%, rgba(31,75,216,.10), transparent 62%),
    radial-gradient(132% 104% at 50% 48%, transparent 54%, rgba(94,86,62,.17)),
    linear-gradient(174deg,#faf7ee,#ece5d4); }
.cb-slide::before{ content:""; position:absolute; inset:0; z-index:0; pointer-events:none; opacity:.11; mix-blend-mode:multiply;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='p'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.62' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23p)'/%3E%3C/svg%3E"); }
.cb-slide::after{ content:""; position:absolute; right:-70px; top:-70px; width:640px; height:640px; z-index:0; pointer-events:none;
  background-image:radial-gradient(var(--cb-accent) 26%, transparent 27%); background-size:24px 24px; opacity:.16;
  -webkit-mask-image:radial-gradient(66% 66% at 100% 0%, #000, transparent 74%);
  mask-image:radial-gradient(66% 66% at 100% 0%, #000, transparent 74%); }
.cb-slide > *{ position:relative; z-index:1; }
.cb-slide .logo{ height:58px; width:380px; max-width:66%; background:var(--cb-logo, none) left center/contain no-repeat; align-self:flex-start; }
.cb-slide .fill{ flex:1 1 auto; }
.cb-slide .eyebrow{ font-family:var(--cb-display); font-weight:700; font-size:36px; letter-spacing:.2em; text-transform:uppercase; color:var(--cb-accent); display:flex; align-items:center; gap:16px; }
.cb-slide .eyebrow::before{ content:""; width:20px; height:20px; border-radius:50%; background:var(--cb-accent-alt); flex:0 0 auto; }
.cb-slide .headline{ font-family:var(--cb-display); font-weight:var(--cb-display-weight,800); text-transform:var(--cb-display-case,none); font-size:104px; line-height:.94; letter-spacing:var(--cb-display-tracking,-.03em); color:var(--cb-ink); margin-top:calc(28px * var(--cb-step,1)); }
.cb-slide .headline.sm{ font-size:78px; }
.cb-slide .headline .em{ color:var(--cb-accent); text-shadow:7px 7px 0 var(--cb-accent-alt); }
.cb-slide .rule{ height:14px; width:196px; margin:34px 0; opacity:.6;
  background-image:radial-gradient(var(--cb-ink) 34%, transparent 35%); background-size:14px 14px; }
.cb-slide .body{ font-size:46px; line-height:1.48; color:var(--cb-ink-muted); margin-top:26px; max-width:23ch; }
.cb-slide .quote{ font-family:var(--cb-display); font-weight:700; font-size:84px; line-height:1.06; letter-spacing:-.025em; color:var(--cb-ink); }
.cb-slide .caption{ font-family:var(--cb-accent-family); font-size:36px; line-height:1.35; color:var(--cb-ink-muted); margin-top:20px; max-width:30ch; }
.cb-slide .stat{ font-family:var(--cb-display); font-weight:800; font-size:200px; line-height:.84; letter-spacing:-.045em; color:var(--cb-accent); text-shadow:12px 12px 0 var(--cb-accent-alt); margin-top:10px; }
.cb-slide .panel{ border:3px solid var(--cb-ink); border-radius:var(--cb-radius); padding:26px 30px; background:rgba(255,255,255,.55); box-shadow:12px 12px 0 rgba(31,75,216,.16); margin-top:10px; }
.cb-slide .panel .row{ display:flex; align-items:baseline; gap:20px; padding:16px 0; font-size:44px; line-height:1.24; color:var(--cb-ink); }
.cb-slide .panel .row + .row{ border-top:2px dotted var(--cb-line); }
.cb-slide .panel .row .tick{ font-family:var(--cb-display); font-weight:800; font-size:42px; color:var(--cb-accent); flex:0 0 auto; }
.cb-slide .cta{ align-self:flex-start; font-family:var(--cb-display); font-weight:800; text-transform:uppercase; font-size:52px; color:#fbf8f0; background:var(--cb-accent); border-radius:var(--cb-radius); padding:26px 44px; box-shadow:10px 10px 0 var(--cb-ink); margin-top:16px; }
.cb-slide .handle{ font-family:var(--cb-display); font-weight:600; letter-spacing:.16em; text-transform:uppercase; font-size:36px; color:var(--cb-ink-muted); margin-top:30px; }
.cb-slide .cb-shot{ filter:saturate(.72) contrast(1.06); box-shadow:0 0 0 3px var(--cb-ink), 16px 16px 0 rgba(31,75,216,.18); }
.cb-slide .cb-shot::after{ content:""; position:absolute; inset:0; z-index:2; pointer-events:none; mix-blend-mode:multiply; opacity:.32;
  background-image:radial-gradient(rgba(20,19,16,.9) 32%, transparent 33%); background-size:7px 7px; }
`.trim(),
  components: [
    { className: 'logo', use: 'The HALFTONE PRESS mark. Top-left on covers and the CTA.' },
    { className: 'eyebrow', use: 'Blue uppercase kicker opened by a pink registration dot; sits above the headline.' },
    { className: 'headline', use: 'The statement, heavy grotesque. Wrap the emphasis phrase in <span class="em"> for the signature. Add .sm for long lines.' },
    { className: 'body', use: 'Supporting sentence(s), muted. Keep to ~2 lines.' },
    { className: 'rule', use: 'A short halftone dot bar; separates the headline from the body.' },
    { className: 'quote', use: 'A large grotesque pull-quote, set tight. Follow it with .caption for the source.' },
    { className: 'caption', use: 'A small serif line: a plate caption under a photograph, or the source under a quote.' },
    { className: 'stat', use: 'A giant blue numeral with the pink offset impression, for a results slide.' },
    { className: 'panel', use: 'A hard-edged card on the sheet; rows via .row, each opened by a <span class="tick"> numeral.' },
    { className: 'cta', use: 'A solid blue button with a hard ink offset, like a stamped block. One per CTA slide.' },
    { className: 'handle', use: 'The @handle at the very bottom, small uppercase.' },
    { className: 'fill', use: 'An empty spacer div that pushes content down (flex-grow). Use to bottom-anchor.' },
  ],
  // Same 1080-wide type scale; only the vertical rhythm changes per canvas.
  formats: {
    // Story 9:16 — tall. Instagram's top/bottom UI safe zones, then let the
    // extra height breathe.
    '1080x1920': {
      stylesheet: `
.cb-slide{ padding:214px 84px 244px; }
.cb-slide .headline{ font-size:118px; margin-top:32px; }
.cb-slide .headline.sm{ font-size:88px; }
.cb-slide .body{ font-size:48px; margin-top:30px; }
.cb-slide .quote{ font-size:94px; }
.cb-slide .stat{ font-size:236px; }
.cb-slide .panel .row{ font-size:46px; }
`.trim(),
    },
    // Square 1:1 — short. Tighten the vertical rhythm, but nothing drops below
    // the phone-legibility floor (body stays at 44px, not 30).
    '1080x1080': {
      stylesheet: `
.cb-slide{ padding:70px 78px 74px; }
.cb-slide .eyebrow{ font-size:34px; }
.cb-slide .headline{ font-size:84px; line-height:.96; margin-top:20px; }
.cb-slide .headline.sm{ font-size:72px; }
.cb-slide .rule{ margin:24px 0; }
.cb-slide .body{ font-size:44px; margin-top:20px; max-width:26ch; }
.cb-slide .quote{ font-size:68px; }
.cb-slide .caption{ font-size:34px; margin-top:16px; }
.cb-slide .stat{ font-size:148px; }
.cb-slide .panel{ padding:22px 26px; }
.cb-slide .panel .row{ font-size:42px; padding:12px 0; }
.cb-slide .cta{ font-size:48px; padding:22px 38px; }
.cb-slide .handle{ font-size:34px; margin-top:24px; }
`.trim(),
    },
  },
  composition: {
    align: 'flush-left',
    patterns: [
      'cover: logo → fill → eyebrow → headline(with .em) → rule',
      'cover: logo → fill → headline(with .em) → caption (quieter, no eyebrow)',
      'plate (photo): eyebrow → headline.sm → cb-shot slot → caption → fill → handle',
      'feature: eyebrow → headline → rule → body → fill → panel',
      'stat: eyebrow → headline.sm → stat → body',
      'quote: fill → quote → caption → fill',
      'cta: logo → fill → eyebrow → headline(with .em) → cta → handle',
    ],
  },
  imagery: {
    treatment:
      'Daylit shots of the press, the ink drums and hands at work, printed as a two-ink plate: desaturated under a fine dot screen, squared off with an ink keyline and a blue offset block.',
    photoRole: 'hero',
    texture: 'paper fibre + a fine halftone dot screen',
    subjects: ['risograph press studio', 'ink drums close up', 'stacked paper stock', 'hands folding a printed zine'],
  },
  surfaces: {
    // One ink-black sheet mid-carousel reads as the back cover of the zine.
    inverse: { ground: '#141310', ink: '#f6f2e7', accent: '#8ea6ff', inkMuted: '#a49e8f' },
  },
  rationale: {
    palette:
      'Uncoated stock is the brand\'s actual substrate, so the ground is warm paper rather than white; the two riso drums (federal blue, fluorescent pink) are the only inks, which is why the pink is rationed to one phrase a slide.',
    type: 'A wide, heavy grotesque prints like a poster and keeps its counters open at thumbnail size; the serif is demoted to plate captions, the one place a printed sheet uses one.',
    signature:
      'A press one pass out of register is the most recognisable thing about riso, so the emphasis phrase carries a hard pink offset — the accident, made deliberate.',
    motion: 'Sheets are fed, not thrown: elements slide on in order, at the steady tempo of a press running.',
  },
  voice: {
    description:
      'Warm, plain-spoken and specific — a small workshop talking about its craft. Concrete nouns, real numbers, dry humour, no marketing gloss.',
    dos: ['Name the stock, the ink, the run length', 'Short sentences with one concrete detail', 'Dry, understated humour'],
    donts: ['Startup superlatives', 'Exclamation marks', 'Promises with no object'],
  },
  // A press runs at a steady tempo — sheets are fed on, one after another.
  motion: {
    style: 'slide',
    pace: 'balanced',
    description: 'Elements are fed onto the sheet one after another, at the steady tempo of a press running.',
    roles: {
      // The cover is the impression landing on the stock.
      cover: { style: 'punch', pace: 'balanced' },
      // A quote is read, not printed at you.
      quote: { style: 'fade', pace: 'calm' },
      stat: { style: 'pop', pace: 'balanced' },
      // Rows come off the press in quick succession.
      list: { style: 'slide', pace: 'punchy' },
      cta: { style: 'punch', pace: 'punchy' },
    },
    // The whole clip drifts like a sheet travelling through the machine.
    ambient: { style: 'drift', intensity: 'subtle' },
  },
});

/**
 * Reference recipes keyed by brand name (for the lab + wiring). Dynatós and
 * DetailMasters are seeded businesses; Halftone Press is the invented light
 * exemplar and has no seed record.
 */
export const REFERENCE_RECIPES: Record<string, BrandRecipe> = {
  'Dynatós Program': dynatosRecipe,
  'DetailMasters CRM': detailMastersRecipe,
  'Halftone Press': halftonePressRecipe,
};
