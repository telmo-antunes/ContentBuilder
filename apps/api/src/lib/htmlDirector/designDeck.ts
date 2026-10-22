/**
 * THE DESIGNER THAT SEES — one call designs the whole deck.
 *
 * Every slide used to be composed blind, one at a time, in a skeleton chosen
 * by role and position, and forty deterministic repairs kept the result from
 * failing. Reliable, and the reason every deck looked like the last one: the
 * three things the rubric scores lowest — variety, hierarchy, the sequence —
 * are qualities of a DECK, and nothing in that loop ever saw one.
 *
 * This is the replacement (docs/designer.md). The copywriter still writes the
 * words. Then a design-tier model is shown the brand's own stylesheet and
 * worked fragments as examples of the house style, the whole deck's copy, and
 * the library's tagged pictures — and writes every slide, assigns the
 * pictures, and may add a small DECK STYLESHEET for devices this deck needs
 * that the recipe does not define (shared/deckCss.ts says what it may contain).
 *
 * What stays mechanical, because taste is not the same as honesty:
 *   · the sanitisers (HTML, CSS) run on everything;
 *   · every copy part must survive verbatim, and the designer may not add
 *     words of its own — a slide that fails either is composed by the classic
 *     path instead, and the fallback is noted on the project;
 *   · pictures come only from the brand's library, by id;
 *   · the brand mark and the brand's domain are enforced after the fact.
 *
 * The second round (a REVISION) shows the designer the rendered contact sheet,
 * the review's findings and the measured faults beside its own previous
 * output, and asks it to revise rather than restart. `reviewDeck.ts` decides
 * whether that round is earned and which of the two decks ships.
 */
import { randomUUID } from 'node:crypto';
import {
  RECIPE_FORMAT_DIMS,
  STORY_UI_RESERVE,
  assignArchetypes,
  authoredSlots,
  cleanDeckCss,
  composeRecipeLayers,
  ensureBrandMark,
  fragmentVariantsFor,
  isSlideAlign,
  isSlideSurface,
  recipeStylesheetFor,
  DECK_CLASS_PREFIX,
  type BrandRecipe,
  type SlidePhoto,
} from '@contentbuilder/shared';
import { aiJson, cachedSystem, modelFor, type AiJsonTool } from '../ai';
import { affordsUsd } from '../spend';
import { sanitizeAuthoredHtml } from '../htmlSanitize';
import { sanitizeRecipeCss } from '../cssSanitize';
import type { PoolAsset } from '../photoPool';
import type { ReferenceSheet } from '../inspo';
import type { DeckFinding } from './deckCritique';
import { fragmentVerbatimGaps, stripFences, unwrapCbSlide } from './fragments';
import { enforceBrandDomain } from './compose';
import type { ComposeParts, ComposeSlideInput, SlideRole } from './prompt';

/** What one design call costs, near enough to gate on (Opus 5, ~14k in / ~8k out). */
export const DESIGN_ESTIMATE_USD = 0.45;
/** A revision reuses the cached prefix and writes about as much. */
export const REVISION_ESTIMATE_USD = 0.4;

export const DESIGN_PROMPT_VERSION = 6;

export type DesignPhotoPlacement = 'slot' | 'background';

export interface DesignedSlide {
  role: SlideRole;
  html: string;
  photos: SlidePhoto[];
  surface?: 'base' | 'raised' | 'deep';
  align?: 'flush-left' | 'center' | 'flush-right';
  /** 'inverse' when the designer put this slide on the brand's inverse surface. */
  bg?: string;
  /** The designer's one line on why this slide is composed as it is. */
  note?: string;
  /**
   * The app's composition archetype, assigned from role + picture exactly as
   * the classic path assigns it: it owns where a slide's leftover space lands
   * and caps the headline's lines. A designed slide without one left its slack
   * wherever the markup put it — the "dead zones" every review named.
   */
  archetype?: string;
  source: 'designer' | 'fragment' | 'ai';
}

export interface DesignedDeck {
  deckCss: string;
  slides: DesignedSlide[];
  rationale: string;
  /** 1-based slides that lost or invented copy and were composed classically instead. */
  fallbacks: number[];
  /** Everything the validators changed or refused, for the project's notes. */
  notes: string[];
  model: string;
}

export interface DesignRevision {
  previous: DesignedDeck;
  /** The rendered contact sheet of `previous`, PNG. */
  sheet: Buffer;
  findings: readonly DeckFinding[];
  scores?: Partial<Record<string, number>>;
  verdict?: string;
  /** What the render probe measured on `previous`, in words ("slide 3 overflows"). */
  measured: readonly string[];
}

export interface DesignContext {
  recipe: BrandRecipe;
  format: string;
  type: 'carousel' | 'story';
  /** The copywriter's deck: role + verbatim parts per slide, in order. */
  inputs: readonly ComposeSlideInput[];
  /** The brand's tagged library — the only pictures the designer may use. */
  pool: readonly PoolAsset[];
  brandName?: string;
  handle?: string;
  audience?: string;
  /** One or two reference strips from the swipe file, when affordable. */
  references?: readonly ReferenceSheet[];
  revision?: DesignRevision;
  model?: string;
  /**
   * The classic composer, for a slide the designer could not be trusted with.
   * Absent (tests): a faulty slide is dropped from the deck with a note.
   */
  classic?: (input: ComposeSlideInput) => Promise<{ html: string; source: 'fragment' | 'ai' } | null>;
}

// ── The prompt ───────────────────────────────────────────────────────────────

const SYSTEM = `You are the designer of a brand's Instagram carousel. The copy is written and approved, word for word. The brand's design system — its tokens, its stylesheet, its component classes, and worked example slides in its own markup — is given. The brand's photo library is given, each picture described. Your job is to design the WHOLE deck: every slide's markup, which picture goes where, and, when this deck needs a device the brand's stylesheet does not define, a few CSS rules of your own for this deck alone.

You can see the whole sequence, which no per-slide step ever could. Use that: vary the composition with the content, put the picture where it earns its place, make the deck read as one system with a beat to it. You are not filling a template with fields. You are composing posters.

THE BAR — a phone in one hand, one second per slide. If a slide has to be READ to be understood, it fails. The accounts this brand should stand beside construct the visual: a number at poster size, a numbered method with room to read, a cropped product screenshot that is legible at a third of this size, one line on a field, a verdict shown as ticks and crosses, a picture that owns the frame. They never ship a headline over a paragraph over a small card, seven times.

WHAT GOOD LOOKS LIKE, in the order the deck is judged:
1. HOOK — slide 1 alone earns the swipe. The cover is the reader's problem, an opinion or a number, at display size; a picture may own the frame with the line over its quiet end. Never a title over a dashboard.
2. VARIETY — consecutive slides differ in composition: ground, arrangement, picture placement change with what each slide says. Count the forms: a good deck shows at least four different kinds of slide. NO TWO CONSECUTIVE SLIDES share an arrangement, and the eyebrow-headline-body stack on a plain ground appears at most twice in the whole deck — the review counts it, and a deck of five of them scores 2 on variety whatever else it does. A run of "statement" roles is where decks die: give each a different form — one line alone on the field at poster size, a number at poster size, a quiet line with its reading, a photograph owning the frame, a two-column compare, the inverse beat, type anchored low against type anchored high — rather than the same stack on the same ground.
3. HIERARCHY — one subject per slide at display size, one anchor, supporting elements grouped tight to what they belong to. Spacing is grouping: a lockup (eyebrow + headline, button + line under it) sits tight; unrelated units sit noticeably apart. Nothing floats in leftover space; nothing is packed into a corner over an empty half-frame.
   · FILL THE FRAME WITH THE SUBJECT. The commonest failure the review names is a 60px headline floating on an empty field. A line alone on the field is set at poster size — write a deck device for it (\`.cb-slide .${DECK_CLASS_PREFIX}poster .headline{font-size:120px;line-height:1}\`); a number or a fraction is set at 180–240px; an equation is two or three big figures with their labels. Ink or picture should cover at least half of every frame; the probe reports a frame that is mostly empty, and the review marks it down.
   · COUNT THE LINES BEFORE YOU SET THE SIZE. The usable measure is about 880px. A display face fits roughly 880 ÷ (0.5 × font-size) characters per line: 132px → 13, 110px → 16, 96px → 18, 80px → 22, 64px → 27. A poster line carries at most 3 lines, a cover or a feature headline at most 3, a list heading 2 — so "Some cars are worth turning down" (32 characters) is a 96px line, not a 132px ladder. A headline that runs past its cap is measured, stripped of your device and set at the brand's size instead, so size it right the first time.
   · A COMPARE SPANS THE MEASURE. Two columns each get at least 40% of the width; a column that wraps every second word is not a compare. A DEVICE IS READ AT 36%: any text inside a compare, a fork, an equation or a chevron is set at 56px or more, its figures at 96px or more — a 36px label in a device is invisible on a phone.
   · AN EXHIBIT UNDER EVERY CLAIM. The reference accounts construct the visual for each claim — a number at poster size, a two-column compare, a numbered set, a fraction, a labelled equation, a product screenshot — and almost never ship a headline alone. Before writing a slide as a bare statement, ask what its exhibit is; use the brand's panel, rows, stat, card and verdict classes, and the deck stylesheet for what they lack.
   · ONE STACK PER FRAME. Two stacks aligned to the same edge in one narrow column collide; a flush-right turn is one lockup, not two.
4. LEGIBILITY — the canvas is 1080px wide and read at ~393pt, so everything is seen at about 36%. Body copy and rows must read at that size; a screenshot in a slot must show something a reader can make out; a story keeps its top and bottom bands clear.
5. BRAND — the signature move appears, the type personality holds, the imagery treatment is the brand's. Every colour is a token.
6. THE CLOSE — one sentence and one button, the brand's own button, nothing else competing on the frame. It should land like an arrival, not a form.

THE CONTRACT (checked mechanically — a slide that breaks it is thrown away and composed by the old machine instead, which is the plainer deck you are here to beat):
- THE WORDS. Every copy part of every slide appears verbatim, exactly as given, and you add NO words of your own: no labels, no "Before"/"After", no captions, no invented numbers, no filler. You may add numerals for numbering (01, 02…) and typographic marks (→, ·, —). Rows are copy too.
  · THE HEADLINE IS ONE ELEMENT. It appears as given, whole, in the brand's \`.headline\` class — never rewritten into figures, split across the cells of a device, or paraphrased to fit one ("Price. Commission. Your net." does not become "Price paid, minus commission"). A device — an equation, a fork, a compare — is built from the ROWS, the stat or the body, with the headline above or below it; when the copy has no rows to build it from, the slide is a poster line, not a device.
  · EVERY COPY PART KEEPS ITS BRAND CLASS inside your device: the headline stays \`.headline\`, the body \`.body\`, a row \`.row\`. Your \`${DECK_CLASS_PREFIX}\` classes go on wrappers and size the parts from there (\`.cb-slide .${DECK_CLASS_PREFIX}fork .headline{…}\`). Text in an element whose only class is yours loses all its typography when the probe strips the device.
- THE CLASSES. The brand's component classes, the app's \`fill\` spacer, and classes you define in the deck stylesheet (prefixed \`${DECK_CLASS_PREFIX}\`). Nothing else. No inline styles, no <style>, no <script>, no <img>, no ids, no \`cb-slide\` wrapper — you write the INSIDE of the slide.
- PICTURES come only from the library, by their id. A slide that wants a picture in a SLOT carries \`<figure class="cb-shot" data-cb-slot="NAME"></figure>\` where it goes (NAME: lowercase letters, digits, hyphens) and assigns a library picture to that slot; a picture that should OWN THE FRAME is assigned as the background and the slide carries no figure. Only a photograph owns a frame; a screenshot or a graphic sits in a slot at a size where it reads. Set fit "contain" for a screenshot, "cover" for a photograph. A slide with no suitable picture in the library is composed as type: a one-liner, a number, an exhibit. Never leave an empty slot.
  · USE THE LIBRARY. When it holds photographs, the cover carries one (owning the frame, the line over its quiet end) and at least one middle slide does too; a deck of seven type-only frames when the library has pictures is the "same slide repeated" failure. A photograph's subject should suit its line, not merely the topic.
  · A SCREENSHOT must be legible at a third of this size, and a whole page in a slot never is. Show ONE element of it: set "zoom" (paints the picture at that multiple of the slot width) and "focal" (which point stays in frame — the caption tells you where the element sits: a header row is {x:0.5,y:0.12}, a first card {x:0.5,y:0.3}, a price column {x:0.8,y:0.35}); a phone screen takes shape "tall", a desktop screen "wide", both size "lg". SIZE THE ZOOM TO THE ELEMENT: zoom = 0.8 ÷ (the element's share of the page width). A table or card that spans the page is zoom 1.3–1.5; a half-width panel 1.6; a narrow column 2.2; never more than 2.4. A zoom that paints the element wider than the slot clips its ends — the commonest blocking finding — and a slightly small element still reads, so when unsure zoom LESS. Use a screenshot only where its caption names the very thing the line is about; a dashboard under a line about payments proves nothing — set that slide as type instead. The slot's photo treatment dims a screenshot; inside your own device switch it off: \`.cb-slide .${DECK_CLASS_PREFIX}proof .cb-shot::after{display:none}\`.
  · NEVER NUMBER A SINGLE ROW. One sentence of body is a line, not a method; a numbered panel needs at least two rows.
  · A LIST'S ROWS are the slide's subject: set them in the brand's row classes at the brand's row size, never as body text inside a box; four rows at poster size beat a paragraph of four items.
- THE DECK STYLESHEET. A few rules, each under \`.cb-slide\`, naming a class of your own with the \`${DECK_CLASS_PREFIX}\` prefix (you may arrange brand classes INSIDE your device, e.g. \`.cb-slide .${DECK_CLASS_PREFIX}compare .headline{…}\`, but never restyle a brand class bare). Colours are the brand's tokens only: var(--cb-ground), var(--cb-ground-alt), var(--cb-ink), var(--cb-ink-muted), var(--cb-accent), var(--cb-accent-alt), var(--cb-line) — for a tint or a translucent surface write color-mix(in srgb, var(--cb-ink) 6%, transparent), never an rgba() or a hex; fonts are var(--cb-display-family), var(--cb-body-family), var(--cb-accent-family). Nothing loads (no url(), @import, @font-face); nothing is fixed. Prefer the brand's own devices; write a rule only when the deck genuinely needs a form the brand lacks. Leave the stylesheet empty when it does.
- THE BRAND'S MODIFIERS are yours to use: every class its stylesheet styles (a \`.sm\` headline, a \`.numbered\` panel, a \`.row\`) is known, not only the ones in the component list.
- GROUND AND ALIGNMENT. Per slide you may choose a surface ("raised" or "deep" for a quieter or heavier ground), an alignment deviation, and — on at most ONE slide, never the cover or the close — the brand's inverse surface, when the brand defines one. Use them as a beat, not decoration.
- A STORY (1080×1920) keeps the top ${STORY_UI_RESERVE}px and bottom ${STORY_UI_RESERVE}px free of anything that must be read.

HOW TO WORK. Read the brand's stylesheet and example slides first — they are what "this brand" looks like, and your slides must be continuous with them. Then read the whole deck's copy and decide the sequence: which slide is the beat, which gets the picture, which is type alone. Then write each slide for what it SAYS. Keep a spacer (\`<div class="fill"></div>\`) where leftover room should land. Explain each slide's composition in one line in its note, and the deck in one short paragraph.

For a REVISION you are shown your previous deck rendered, the review's scored verdict and findings, and what the probe measured. Keep what works; fix what is named; do not restart from nothing. Return the complete deck again.

Deliver the deck by CALLING THE "design_deck" TOOL. (If you cannot call the tool, return the same object as STRICT JSON only — no prose, no fences.)`;

const TOOL: AiJsonTool = {
  name: 'design_deck',
  description: 'The designed deck: every slide, its pictures, and the deck stylesheet.',
  schema: {
    type: 'object',
    properties: {
      rationale: { type: 'string', description: 'One short paragraph on the sequence and the forms you chose.' },
      deckCss: { type: 'string', description: 'The deck stylesheet, or an empty string when the brand\'s own classes carry the deck.' },
      slides: {
        type: 'array',
        description: 'One entry per slide, in the order given.',
        items: {
          type: 'object',
          properties: {
            html: { type: 'string', description: 'The inside of the slide, in brand and deck classes.' },
            photos: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  asset: { type: 'string', description: 'The library id, e.g. "p3".' },
                  placement: { type: 'string', enum: ['slot', 'background'] },
                  slot: { type: 'string', description: 'The data-cb-slot name this fills (placement "slot").' },
                  fit: { type: 'string', enum: ['cover', 'contain'] },
                  shape: { type: 'string', enum: ['standard', 'wide', 'square', 'tall'] },
                  size: { type: 'string', enum: ['sm', 'md', 'lg'] },
                  zoom: { type: 'number', minimum: 1, maximum: 2.4, description: 'Slot only: paint the picture at this multiple of the slot width, so one element fills about 80% of the slot — 0.8 ÷ the element’s share of the page width.' },
                  focal: {
                    type: 'object',
                    description: 'Which point of the picture stays in frame, as fractions: {x:0.5,y:0.2} is the top middle.',
                    properties: { x: { type: 'number', minimum: 0, maximum: 1 }, y: { type: 'number', minimum: 0, maximum: 1 } },
                    required: ['x', 'y'],
                  },
                },
                required: ['asset', 'placement'],
              },
            },
            surface: { type: 'string', enum: ['base', 'raised', 'deep'] },
            align: { type: 'string', enum: ['flush-left', 'center', 'flush-right'] },
            inverse: { type: 'boolean', description: 'This slide sits on the brand\'s inverse surface (at most one).' },
            note: { type: 'string', description: 'One line: why this slide is composed as it is.' },
          },
          required: ['html'],
        },
      },
    },
    required: ['slides'],
  },
};

const SYSTEM_CACHED = cachedSystem(SYSTEM);

// ── The brief, per call ──────────────────────────────────────────────────────

const MAX_STYLESHEET_CHARS = 12000;
/** Beyond this a zoomed screenshot paints its element wider than the slot and clips it. */
export const MAX_ZOOM = 2.4;
const MAX_FRAGMENTS_CHARS = 10000;

function brandBrief(recipe: BrandRecipe, format: string, opts: { brandName?: string; handle?: string; audience?: string }): string {
  const t = recipe.tokens;
  const dims = RECIPE_FORMAT_DIMS[format] ?? RECIPE_FORMAT_DIMS['1080x1350']!;
  const tokens = [
    `--cb-ground ${t.ground}`,
    t.groundAlt ? `--cb-ground-alt ${t.groundAlt}` : '',
    `--cb-ink ${t.ink}`,
    t.inkMuted ? `--cb-ink-muted ${t.inkMuted}` : '',
    `--cb-accent ${t.accent}`,
    t.accentAlt ? `--cb-accent-alt ${t.accentAlt}` : '',
    t.line ? `--cb-line ${t.line}` : '',
    `--cb-display-family ${t.displayFamily} · --cb-body-family ${t.bodyFamily}${t.accentFamily ? ` · --cb-accent-family ${t.accentFamily}` : ''}`,
    `radius ${t.radius}px`,
  ].filter(Boolean);
  const comps = recipe.components.map((c) => `  .${c.className} — ${c.use}`).join('\n');
  const sheet = (composeRecipeLayers(recipe.layers) || recipe.stylesheet).trim();
  const extra = recipe.formats?.[format]?.stylesheet?.trim();
  const css = [sheet, extra ? `/* ${format} */\n${extra}` : ''].filter(Boolean).join('\n').slice(0, MAX_STYLESHEET_CHARS);
  const examples: string[] = [];
  let used = 0;
  for (const role of Object.keys(recipe.fragments ?? {})) {
    for (const [i, frag] of fragmentVariantsFor(recipe, role).entries()) {
      const block = `— ${role}${i ? ` (arrangement ${i + 1})` : ''}:\n${frag.trim()}`;
      if (used + block.length > MAX_FRAGMENTS_CHARS) break;
      examples.push(block);
      used += block.length;
    }
  }
  const inverse = recipe.surfaces?.inverse
    ? `INVERSE SURFACE: defined (ground ${recipe.surfaces.inverse.ground}, ink ${recipe.surfaces.inverse.ink}) — one slide may sit on it.`
    : 'INVERSE SURFACE: none — do not set inverse on any slide.';
  return [
    `BRAND: ${opts.brandName ?? 'the brand'}${opts.handle ? ` · ${opts.handle}` : ''}`,
    recipe.voice?.description ? `VOICE: ${recipe.voice.description}` : '',
    opts.audience ? `READER: ${opts.audience}` : '',
    `SIGNATURE MOVE (${recipe.signature.name}): ${recipe.signature.description}`,
    `TYPOGRAPHY: display ${recipe.typography.displayCase} case, weight ${recipe.typography.displayWeight}, tracking ${recipe.typography.displayTracking}; density ${recipe.typography.density}; default alignment ${recipe.composition.align}.`,
    recipe.imagery?.treatment ? `IMAGERY: ${recipe.imagery.treatment}` : '',
    inverse,
    `CANVAS: ${dims.w}×${dims.h} (${dims.label}).${format === '1080x1920' ? ` Story: keep the top and bottom ${STORY_UI_RESERVE}px clear of anything that must be read.` : ''}`,
    ``,
    `TOKENS:`,
    ...tokens.map((x) => `  ${x}`),
    ``,
    `COMPONENT CLASSES (the brand's vocabulary; each is styled by the stylesheet below):`,
    comps,
    `  .fill — the app's spacer: leftover room lands here`,
    ``,
    `THE BRAND'S STYLESHEET (what those classes look like; scoped to .cb-slide):`,
    css,
    ``,
    `THE BRAND'S OWN EXAMPLE SLIDES ({{…}} are copy holes; these show how this brand arranges each role — follow the manner, not the skeleton):`,
    examples.join('\n\n') || '(none authored)',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/** A stable short handle per library picture, so the model never has to copy a 24-hex id. */
function poolBrief(pool: readonly PoolAsset[]): { text: string; byHandle: Map<string, PoolAsset> } {
  const byHandle = new Map<string, PoolAsset>();
  const lines = pool.map((m, i) => {
    const h = `p${i + 1}`;
    byHandle.set(h, m);
    const t = m.tags;
    const what = t?.caption ? `"${t.caption}"` : '(untagged)';
    const subjects = t?.subjects?.length ? ` · ${t.subjects.join(', ')}` : '';
    const dims = m.width && m.height ? ` · ${m.width}×${m.height}` : '';
    return `  ${h} [${t?.kind ?? 'unknown'}${t?.tone ? `, ${t.tone}` : ''}] ${what}${subjects}${dims}`;
  });
  return {
    text: lines.length
      ? `THE LIBRARY (the only pictures you may use; refer to them by id):\n${lines.join('\n')}`
      : 'THE LIBRARY: empty — every slide is type. Leave no slot anywhere.',
    byHandle,
  };
}

function deckBrief(inputs: readonly ComposeSlideInput[]): string {
  const slides = inputs.map((s, i) => ({
    slide: i + 1,
    role: s.role,
    wantsPicture: s.photo === true,
    ...(s.imageQuery ? { pictureOf: s.imageQuery } : {}),
    ...(s.rationale ? { copywriterNote: s.rationale } : {}),
    parts: s.parts,
  }));
  return `THE DECK'S COPY (verbatim; every part must appear on its slide):\n${JSON.stringify(slides, null, 1)}`;
}

function revisionBrief(r: DesignRevision): string {
  const scores = r.scores
    ? Object.entries(r.scores).map(([k, v]) => `${k} ${v}`).join(' · ')
    : 'not scored';
  const findings = r.findings.length
    ? r.findings.map((f) => `  - slide ${f.slide || 'deck'} [${f.severity}]: ${f.fault} → ${f.fix}`).join('\n')
    : '  (none)';
  const measured = r.measured.length ? r.measured.map((m) => `  - ${m}`).join('\n') : '  (nothing measured wrong)';
  const refused = r.previous.notes.length ? r.previous.notes.map((n) => `  - ${n}`).join('\n') : '  (nothing)';
  const previous = {
    deckCss: r.previous.deckCss,
    slides: r.previous.slides.map((s, i) => ({ slide: i + 1, html: s.html, photos: s.photos.map((p) => ({ placement: p.placement, slot: p.slot, fit: p.fit, shape: p.shape, size: p.size })), surface: s.surface, align: s.align, inverse: s.bg === 'inverse' })),
  };
  return [
    `REVISION. The contact sheet above is your previous deck, rendered at feed size and numbered.`,
    `The review scored it: ${scores}.${r.verdict ? ` Verdict: ${r.verdict}` : ''}`,
    `Findings, worst first:`,
    findings,
    `What the render probe measured:`,
    measured,
    `What the validators changed or refused in your previous deck (a refused slide was replaced by the plain composer — the rendered sheet shows the replacement, not your design):`,
    refused,
    ``,
    `Your previous output (revise this; keep what works):`,
    JSON.stringify(previous, null, 1),
  ].join('\n');
}

// ── Validation (pure, tested) ────────────────────────────────────────────────

/**
 * Normalise for comparison: tags out, entities decoded, quotes straightened,
 * case folded. INLINE tags vanish without a space — the brand mark is written
 * `<b>detail</b><i>masters</i>` and is one word — while block tags become one,
 * so two stacked lines never fuse into a word nobody wrote.
 */
export function plainText(s: string): string {
  return s
    .replace(/<\/?(?:span|em|b|i|strong|small|sup|sub|u)\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Words on the slide that came from nowhere. Every copy part (and row) is
 * removed from the slide's visible text; what remains must be numerals,
 * typographic marks and the brand's own name or handle. Anything else is a
 * word the designer wrote — the one thing it is forbidden to do.
 */
export function inventedWords(html: string, parts: ComposeParts, allowed: readonly string[] = []): string[] {
  let text = ` ${plainText(html)} `;
  const sources: string[] = [];
  for (const v of Object.values(parts)) if (typeof v === 'string') sources.push(v);
  for (const r of parts.rows ?? []) {
    sources.push(r.text);
    if (r.note) sources.push(r.note);
  }
  sources.push(...allowed);
  // Longest first, so a part that contains another is removed whole.
  for (const s of sources.map(plainText).filter(Boolean).sort((a, b) => b.length - a.length)) {
    text = text.split(s).join(' ');
  }
  const words = text.split(/[^\p{L}\p{N}'’-]+/u).filter(Boolean);
  // Three or more letters: "01", "→", "a", "of" are never inventions worth a fallback.
  return words.filter((w) => /\p{L}{3,}/u.test(w));
}

export interface PhotoCheck {
  photos: SlidePhoto[];
  faults: string[];
}

/**
 * The designer's picture calls, checked against the library and the markup:
 * a slot must exist on the slide, an asset must be in the library, only a
 * photograph may own the frame, and at most one may.
 */
export function validateDesignPhotos(
  raw: unknown,
  html: string,
  byHandle: ReadonlyMap<string, PoolAsset>,
  tagged: boolean,
): PhotoCheck {
  const faults: string[] = [];
  const photos: SlidePhoto[] = [];
  const slots = new Set(authoredSlots(html));
  const filled = new Set<string>();
  let background = false;
  for (const entry of Array.isArray(raw) ? raw : []) {
    const p = (entry ?? {}) as Record<string, unknown>;
    const asset = byHandle.get(String(p.asset ?? '').trim());
    if (!asset) {
      faults.push(`picture "${String(p.asset ?? '')}" is not in the library`);
      continue;
    }
    const placement = p.placement === 'background' ? 'background' : p.placement === 'slot' ? 'slot' : null;
    if (!placement) {
      faults.push(`picture ${String(p.asset)} has no placement`);
      continue;
    }
    const kind = asset.tags?.kind;
    if (placement === 'background') {
      if (background) {
        faults.push('a second background picture was ignored');
        continue;
      }
      if (tagged && kind && kind !== 'photo') {
        faults.push(`${String(p.asset)} is a ${kind}, which may not own the frame`);
        continue;
      }
      background = true;
      photos.push({
        id: randomUUID(),
        mediaAssetId: String(asset._id),
        placement: 'background',
        fit: 'cover',
      } as SlidePhoto);
      continue;
    }
    const slot = String(p.slot ?? '').trim().toLowerCase();
    if (!slot || !slots.has(slot)) {
      faults.push(`picture ${String(p.asset)} names slot "${slot}", which the slide does not carry`);
      continue;
    }
    if (filled.has(slot)) {
      faults.push(`slot "${slot}" was assigned twice`);
      continue;
    }
    filled.add(slot);
    const fit = p.fit === 'contain' || p.fit === 'cover' ? p.fit : kind === 'screenshot' ? 'contain' : 'cover';
    const shape = ['standard', 'wide', 'square', 'tall'].includes(String(p.shape)) ? (p.shape as SlidePhoto['shape']) : undefined;
    const size = ['sm', 'md', 'lg'].includes(String(p.size)) ? (p.size as SlidePhoto['size']) : undefined;
    // A zoom paints the picture at a multiple of the slot width and `focal`
    // says which part stays — the one way a full-page screenshot becomes a
    // legible element. Clamped; a zoom implies `cover` (contain cannot crop).
    const zoomRaw = Number(p.zoom);
    const zoom = Number.isFinite(zoomRaw) && zoomRaw > 1 ? Math.min(MAX_ZOOM, zoomRaw) : undefined;
    const f = (p.focal ?? null) as { x?: unknown; y?: unknown } | null;
    const fx = Number(f?.x);
    const fy = Number(f?.y);
    const focal = f && Number.isFinite(fx) && Number.isFinite(fy) ? { x: Math.min(1, Math.max(0, fx)), y: Math.min(1, Math.max(0, fy)) } : undefined;
    photos.push({
      id: randomUUID(),
      mediaAssetId: String(asset._id),
      placement: 'slot',
      slot,
      fit: zoom ? 'cover' : fit,
      ...(shape ? { shape } : {}),
      ...(size ? { size } : {}),
      ...(zoom ? { zoom } : {}),
      ...(focal ? { focal } : {}),
    } as SlidePhoto);
  }
  for (const s of slots) if (!filled.has(s)) faults.push(`slot "${s}" was left empty`);
  return { photos, faults };
}

/** The inside of a slide, as the renderer will mount it. */
export function cleanDesignedHtml(raw: string): string {
  const inner = unwrapCbSlide(stripFences(String(raw ?? '')).trim());
  // Pictures come from the library, never from markup.
  const noImg = inner.replace(/<img\b[^>]*>/gi, '');
  return sanitizeAuthoredHtml(noImg);
}

/** Does this slide's markup carry a class neither the brand nor the deck defines? */
export function unknownClasses(html: string, known: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  const re = /class="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    for (const c of m[1]!.split(/\s+/).filter(Boolean)) {
      if (known.has(c) || c.startsWith(DECK_CLASS_PREFIX) || c.startsWith('cb-')) continue;
      out.add(c);
    }
  }
  return [...out];
}

/** Every class the deck stylesheet defines. */
export function deckClasses(css: string): Set<string> {
  const out = new Set<string>();
  const re = /\.(dk-[\w-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) out.add(m[1]!);
  return out;
}

/**
 * Every class the brand's own stylesheet styles — the advertised components
 * AND their modifiers (`.headline.sm`, `.panel.numbered`, `.row`), which the
 * `components` list never names. The first live run stripped `.sm`, `.row`
 * and `.numbered` as "unknown" and the list slide shipped as body text in a
 * box: a class the stylesheet styles is known by definition.
 */
export function brandStyledClasses(recipe: BrandRecipe, format: string): Set<string> {
  const out = new Set<string>(recipe.components.map((c) => c.className));
  // The sheet as RENDERED: the brand's own CSS plus the app's layers (the
  // image layer's `.cb-shot.wide`, the list skeleton's `.numbered`, the
  // archetype and surface layers). A class any of them styles is known.
  const re = /\.([a-zA-Z_][\w-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(recipeStylesheetFor(recipe, format))) !== null) out.add(m[1]!);
  return out;
}

/** The words a brand's own name and address contribute, each allowed on a slide. */
export function brandWords(opts: { brandName?: string; handle?: string }): string[] {
  const out: string[] = [];
  for (const s of [opts.brandName, opts.handle]) {
    if (!s) continue;
    out.push(s);
    for (const w of s.split(/[^\p{L}\p{N}]+/u)) if (w) out.push(w);
    // "detailmasters.pro" → "detailmasters"; "@detailmasters" → "detailmasters".
    out.push(s.replace(/^@/, '').replace(/\.[a-z]{2,}$/i, ''));
  }
  return out;
}

interface RawSlide {
  html?: unknown;
  photos?: unknown;
  surface?: unknown;
  align?: unknown;
  inverse?: unknown;
  note?: unknown;
}

interface RawDeck {
  rationale?: unknown;
  deckCss?: unknown;
  slides?: unknown;
}

function extractJson(text: string): unknown {
  const t = stripFences(text).trim();
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(t.slice(a, b + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

// ── The call ─────────────────────────────────────────────────────────────────

/**
 * Design the deck. Returns null when the call is unaffordable, refused or
 * unusable — the caller then runs the classic path for the whole deck. A
 * partial failure (a slide that lost copy) is handled HERE: that slide goes to
 * `classic` and the deck still ships as designed everywhere else.
 */
export async function designDeck(ctx: DesignContext): Promise<DesignedDeck | null> {
  const revising = Boolean(ctx.revision);
  if (!affordsUsd(revising ? REVISION_ESTIMATE_USD : DESIGN_ESTIMATE_USD, revising ? 'design-revision' : 'design')) return null;
  const model = ctx.model ?? (await modelFor('design'));
  const { text: poolText, byHandle } = poolBrief(ctx.pool);
  const tagged = ctx.pool.length > 0 && ctx.pool.filter((m) => m.tags?.taggedAt).length >= Math.ceil(ctx.pool.length / 2);
  const brief = [
    brandBrief(ctx.recipe, ctx.format, { brandName: ctx.brandName, handle: ctx.handle, audience: ctx.audience }),
    ``,
    poolText,
    ``,
    deckBrief(ctx.inputs),
  ].join('\n');

  const content: Array<Record<string, unknown>> = [];
  for (const [i, r] of (ctx.references ?? []).entries()) {
    content.push({ type: 'text', text: `REFERENCE ${i + 1} of ${ctx.references!.length} — the bar, from ${r.label}. Judge the FORMS, not the colours or words:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: r.buffer.toString('base64') } });
  }
  content.push({ type: 'text', text: brief });
  if (ctx.revision) {
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: ctx.revision.sheet.toString('base64') } });
    content.push({ type: 'text', text: revisionBrief(ctx.revision) });
  } else {
    content.push({ type: 'text', text: `Design the ${ctx.inputs.length}-slide ${ctx.type}. Call design_deck.` });
  }

  let reply;
  try {
    reply = await aiJson(
      {
        model,
        max_tokens: 24000,
        system: SYSTEM_CACHED,
        messages: [{ role: 'user', content: content as never }],
      },
      TOOL,
      { large: true, feature: revising ? 'design-revision' : 'design' },
    );
  } catch (err) {
    console.warn(`[design] the design call failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  const raw = (reply.json ?? extractJson(reply.text)) as RawDeck | undefined;
  if (!raw || !Array.isArray(raw.slides)) {
    console.warn('[design] the reply carried no slides');
    return null;
  }
  return finishDesignedDeck(raw, ctx, { byHandle, tagged, model });
}

/**
 * The validators, in order, on a raw reply. Exported for the tests, which
 * drive it with scripted replies and no model.
 */
export async function finishDesignedDeck(
  raw: RawDeck,
  ctx: DesignContext,
  env: { byHandle: ReadonlyMap<string, PoolAsset>; tagged: boolean; model: string },
): Promise<DesignedDeck> {
  const notes: string[] = [];
  const brandClasses = brandStyledClasses(ctx.recipe, ctx.format);
  const { css: deckCss, dropped } = cleanDeckCss(sanitizeRecipeCss(String(raw.deckCss ?? '')), brandClasses);
  for (const d of dropped) notes.push(`deck stylesheet: dropped ${d}`);
  const known = new Set([...brandClasses, ...deckClasses(deckCss), 'fill', 'it', 'break']);
  const rawSlides = (raw.slides as RawSlide[]).slice(0, ctx.inputs.length);
  const allowed = brandWords({ brandName: ctx.brandName, handle: ctx.handle });

  const slides: DesignedSlide[] = [];
  const fallbacks: number[] = [];
  let inverted = false;
  for (const [i, input] of ctx.inputs.entries()) {
    const r = rawSlides[i] ?? {};
    let html = cleanDesignedHtml(String(r.html ?? ''));
    const faults: string[] = [];
    if (!html) faults.push('no markup');
    const gaps = html ? fragmentVerbatimGaps(html, input.parts) : [];
    if (gaps.length) faults.push(`copy not verbatim: ${gaps.join(', ')}`);
    const invented = html ? inventedWords(html, input.parts, allowed) : [];
    if (invented.length > 0) faults.push(`invented words: ${invented.slice(0, 6).join(', ')}`);
    const strange = html ? unknownClasses(html, known) : [];
    if (strange.length) {
      // Not a fault — the element renders unstyled — but the class is removed
      // so the markup says what it does.
      for (const c of strange) html = html.replace(new RegExp(`(class="[^"]*)\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b\\s*`, 'g'), '$1');
      notes.push(`slide ${i + 1}: removed unknown class(es) ${strange.map((c) => `.${c}`).join(', ')}`);
    }
    if (faults.length) {
      fallbacks.push(i + 1);
      notes.push(`slide ${i + 1}: the designer's slide was refused (${faults.join('; ')}) — composed by the classic path`);
      const classic = ctx.classic ? await ctx.classic(input).catch(() => null) : null;
      if (classic?.html) {
        slides.push({ role: input.role, html: classic.html, photos: [], source: classic.source });
      } else {
        slides.push({ role: input.role, html: '', photos: [], source: 'ai' });
      }
      continue;
    }
    const photosCheck = validateDesignPhotos(r.photos, html, env.byHandle, env.tagged);
    for (const f of photosCheck.faults) notes.push(`slide ${i + 1}: ${f}`);
    // An empty slot is a dead grey box: strip any figure no picture filled.
    const filled = new Set(photosCheck.photos.filter((p) => p.placement === 'slot').map((p) => p.slot));
    for (const slot of authoredSlots(html)) {
      if (!filled.has(slot)) {
        html = html.replace(new RegExp(`<figure[^>]*data-cb-slot="${slot}"[^>]*>\\s*</figure>\\s*`, 'gi'), '');
      }
    }
    const surface = isSlideSurface(r.surface) && r.surface !== 'base' ? (r.surface as DesignedSlide['surface']) : undefined;
    const align = isSlideAlign(r.align) && r.align !== ctx.recipe.composition.align ? (r.align as DesignedSlide['align']) : undefined;
    let bg: string | undefined;
    if (r.inverse === true && ctx.recipe.surfaces?.inverse && !inverted && i !== 0 && i !== ctx.inputs.length - 1) {
      bg = 'inverse';
      inverted = true;
    } else if (r.inverse === true) {
      notes.push(`slide ${i + 1}: inverse refused (${!ctx.recipe.surfaces?.inverse ? 'the brand has no inverse surface' : inverted ? 'one slide is already inverted' : 'never the cover or the close'})`);
    }
    slides.push({
      role: input.role,
      html,
      photos: photosCheck.photos,
      ...(surface ? { surface } : {}),
      ...(align ? { align } : {}),
      ...(bg ? { bg } : {}),
      ...(typeof r.note === 'string' && r.note.trim() ? { note: r.note.trim().slice(0, 300) } : {}),
      source: 'designer',
    });
  }

  // The brand mark and the brand's domain are enforced after the fact, as on
  // every other path.
  const marks = ensureBrandMark(slides.map((s) => s.html));
  if (marks.repaired) {
    slides.forEach((s, i) => {
      s.html = marks.htmls[i]!;
    });
    notes.push(`brand mark normalised on ${marks.repaired} slide(s)`);
  }
  if (ctx.handle) {
    for (const [i, s] of slides.entries()) {
      const swept = enforceBrandDomain(s.html, ctx.handle);
      if (swept !== s.html) {
        notes.push(`slide ${i + 1}: cited a wrong domain — corrected to ${ctx.handle}`);
        s.html = swept;
      }
    }
  }
  const archetypes = assignArchetypes(slides.map((s) => ({ role: s.role, hasPhoto: s.photos.length > 0 })));
  slides.forEach((s, i) => {
    if (archetypes[i]) s.archetype = archetypes[i];
  });
  const rationale = typeof raw.rationale === 'string' ? raw.rationale.trim().slice(0, 1200) : '';
  // Keep the deck stylesheet only while a slide still uses one of its classes.
  const used = [...deckClasses(deckCss)].some((c) => slides.some((s) => s.html.includes(c)));
  return { deckCss: used ? deckCss : '', slides, rationale, fallbacks, notes, model: env.model };
}

/** The fragment-shaped record the route stores per slide. */
export function toAuthored(s: DesignedSlide, pv: Record<string, number>): {
  html: string;
  bg?: string;
  role: string;
  pv: Record<string, number>;
  source: 'designer' | 'fragment' | 'ai';
  align?: string;
  surface?: string;
  archetype?: string;
} {
  return {
    html: s.html,
    ...(s.bg ? { bg: s.bg } : {}),
    role: s.role,
    pv,
    source: s.source,
    ...(s.align ? { align: s.align } : {}),
    ...(s.surface ? { surface: s.surface } : {}),
    ...(s.archetype ? { archetype: s.archetype } : {}),
  };
}

/**
 * THE ONE MECHANICAL REPAIR A DESIGNED SLIDE HAS: drop its deck devices.
 *
 * A headline that laddered six lines or a frame that overflowed did so
 * because a `dk-` device set the type larger than the brand would; without
 * the device the brand's own sizes — already held to the floor and measured
 * for years of decks — apply. Crude, safe, and only used when the probe says
 * the designed version does not fit; the review still sees the result.
 */
export function stripDeckClasses(html: string): string {
  // A text leaf whose only classes are the designer's (a fork's cells, an
  // equation's figures) has no brand typography beneath it: stripped, its
  // words would render as unclassed body text — which is how "Enzymes or
  // fragrance?" once shipped at body size. Such a device is left whole; the
  // review sees the ladder and the revision fixes it.
  if (DECK_ONLY_TEXT_LEAF.test(html)) return html;
  return html.replace(/class="([^"]*)"/g, (_m, classes: string) => {
    const kept = classes.split(/\s+/).filter((c) => c && !c.startsWith(DECK_CLASS_PREFIX));
    return `class="${kept.join(' ')}"`;
  });
}

/** An opening tag whose class list is deck classes only, followed by text rather than another tag. */
const DECK_ONLY_TEXT_LEAF = new RegExp(`<\\w+[^>]*\\sclass="\\s*(?:${DECK_CLASS_PREFIX}[^\\s"]+\\s*)+"[^>]*>\\s*[^<\\s]`);

/** The spoken form of a measured layout verdict, for the review and the revision. */
export function describeMeasured(
  verdicts: ReadonlyArray<{ state: string; collide?: boolean; slack?: number; headlineLines?: number } | null | undefined>,
  slackLimit: number,
  /** Per slide, the archetype's headline cap; absent = 4. */
  headlineCaps: ReadonlyArray<number | undefined> = [],
): string[] {
  const out: string[] = [];
  verdicts.forEach((v, i) => {
    if (!v) return;
    const cap = headlineCaps[i] ?? 4;
    if (v.state === 'overflows') out.push(`slide ${i + 1} overflows the canvas — something must go or get smaller`);
    if (v.collide) out.push(`slide ${i + 1}: two elements collide`);
    if (typeof v.slack === 'number' && v.slack > slackLimit) out.push(`slide ${i + 1}: ${Math.round(v.slack * 100)}% of the frame is empty`);
    if (typeof v.headlineLines === 'number' && v.headlineLines > cap) out.push(`slide ${i + 1}: the headline runs ${v.headlineLines} lines (${cap} is the most this composition carries)`);
  });
  return out;
}

/** Does a measured verdict call for the deck-device rung? Overflow, or a laddered headline. */
export function needsDeckStrip(v: { state: string; headlineLines?: number } | null | undefined, cap = 4): boolean {
  if (!v) return false;
  return v.state === 'overflows' || (typeof v.headlineLines === 'number' && v.headlineLines > cap);
}
