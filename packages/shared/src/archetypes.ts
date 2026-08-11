/**
 * ARCHETYPES — how a slide is composed, as distinct from what it says.
 *
 * A `role` (cover, statement, stat, list, cta…) describes CONTENT. An archetype
 * describes SPACE: where the leftover vertical room goes, whether a photograph
 * belongs, and how much type the frame will carry. They are orthogonal — a
 * statement can be a full-bleed photo or a quiet text frame, and picking one per
 * slide is what stops a deck reading as the same slide seven times.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Brands author `.cb-slide` as a flex column and bottom-anchor it with a
 * `.fill` spacer, exactly as the recipe author prompt asks. That works for one
 * slide and fails across a deck, because the COMPOSER decides where the spacers
 * go, per slide, with no view of the whole. Leftover space therefore lands
 * wherever a model happened to emit a `<div class="fill">`: a real deck shipped
 * ~430px of dead ground between a headline and a list, and two slides that
 * ended with 230–280px of nothing.
 *
 * So the archetype takes that decision. Its CSS is app-owned, sits after the
 * brand sheet, and neutralises stray `.fill` spacers — slack becomes a property
 * of the chosen composition instead of an accident of markup.
 */

/** Where the leftover vertical space goes. */
export type SlackPolicy =
  /** Content sits at the bottom; slack above. The brands' own default. */
  | 'top'
  /** Content sits at the top; slack below. */
  | 'bottom'
  /** Content sits at the optical centre — slightly above true centre. */
  | 'center'
  /** Slack divided between the content groups. */
  | 'between';

export type PhotoAppetite = 'required' | 'optional' | 'never';

/**
 * HOW an archetype's photograph meets the frame.
 *
 * `slot` is the inset card the composer leaves a hole for — bounded, sitting on
 * the brand's ground. `bleed` is the full-frame background layer, with the
 * scrim that already exists to keep type legible over it.
 *
 * The distinction is the difference between a deck that looks assembled and one
 * that looks designed. Every photo being an inset rounded rectangle floating on
 * black is the single strongest "template" signal a deck can carry, and it is
 * what a review named as the thing to fix after the space and the typography.
 */
export type PhotoPlacement = 'slot' | 'bleed';

export interface Archetype {
  key: string;
  /** One line, for the review page and for anyone reading a deck plan. */
  intent: string;
  slack: SlackPolicy;
  photo: PhotoAppetite;
  /** Only meaningful when `photo` is not 'never'. */
  placement?: PhotoPlacement;
  /** Beyond this a headline is not emphasis, it is unedited copy. */
  maxHeadlineLines: number;
}

/**
 * The set. Deliberately small: six compositions is enough for a seven-slide
 * deck to have rhythm, and every one added is another thing a recipe has to
 * look right in.
 */
export const ARCHETYPES = {
  /** A picture carrying the frame, type laid into its quiet region. */
  showcase: {
    key: 'showcase',
    intent: 'Photograph carries the frame, full-bleed; type sits over its quiet end.',
    slack: 'top',
    photo: 'required',
    // The whole point of this archetype. A picture that "carries the frame"
    // cannot do so from inside a card with margins around it.
    placement: 'bleed',
    maxHeadlineLines: 3,
  },
  /** Picture and type each own a band of the frame. */
  split: {
    key: 'split',
    intent: 'Picture and type each own a band of the frame.',
    slack: 'between',
    photo: 'required',
    // Genuinely wants the bounded card: the band IS the composition.
    placement: 'slot',
    maxHeadlineLines: 3,
  },
  /** Type alone, centred. The deck's quiet beats. */
  statement: {
    key: 'statement',
    intent: 'Type alone, optically centred — the deck breathes here.',
    slack: 'center',
    photo: 'never',
    maxHeadlineLines: 3,
  },
  /**
   * Type alone, anchored low — the brands' own native look.
   *
   * Exists so a deck with NO photographs still has two text compositions to
   * alternate between. Without it every text role collapsed to `statement`, the
   * run rule had nothing to choose, and seven slides came out identical — which
   * is the exact deck that prompted this work. A second slack policy is the
   * cheapest possible rhythm.
   */
  banner: {
    key: 'banner',
    intent: 'Type anchored low, in the brand’s own bottom-weighted rhythm.',
    slack: 'top',
    photo: 'never',
    maxHeadlineLines: 3,
  },
  /** A heading and its enumerated rows, packed to the top. */
  list: {
    key: 'list',
    intent: 'Heading and rows, packed from the top so the list reads as one block.',
    slack: 'bottom',
    photo: 'never',
    maxHeadlineLines: 2,
  },
  /** One line, given the whole frame. */
  pull: {
    key: 'pull',
    intent: 'One line given the whole frame — the most quotable slide.',
    slack: 'center',
    photo: 'never',
    maxHeadlineLines: 4,
  },
  /** The closing ask. Bottom-anchored so the action sits where a thumb is. */
  cta: {
    key: 'cta',
    intent: 'The closing ask, anchored low where a thumb already is.',
    slack: 'top',
    photo: 'optional',
    placement: 'bleed',
    maxHeadlineLines: 3,
  },
} as const satisfies Record<string, Archetype>;

export type ArchetypeKey = keyof typeof ARCHETYPES;

export const ARCHETYPE_KEYS = Object.keys(ARCHETYPES) as ArchetypeKey[];

export const isArchetype = (v: unknown): v is ArchetypeKey =>
  typeof v === 'string' && (ARCHETYPE_KEYS as string[]).includes(v);

export const archetypeFor = (key: string | undefined): Archetype | undefined =>
  key && isArchetype(key) ? ARCHETYPES[key] : undefined;

// ── Selection ────────────────────────────────────────────────────────────────

/**
 * Which archetypes a role can honestly wear.
 *
 * Ordered by preference, so a deck with no constraints still gets a sensible
 * default. A role never appears against an archetype that would misrepresent it
 * — a `list` is not a `pull`, however good that would look.
 */
const ROLE_OPTIONS: Record<string, ArchetypeKey[]> = {
  cover: ['showcase', 'split', 'banner'],
  statement: ['statement', 'banner', 'split', 'showcase'],
  feature: ['split', 'showcase', 'statement', 'banner'],
  quote: ['pull', 'statement'],
  stat: ['pull', 'banner'],
  list: ['list'],
  cta: ['cta'],
};

/** No archetype may appear this many times in a row. */
export const MAX_RUN = 2;

export interface SlideForSelection {
  role: string;
  /** Whether a picture is actually available for this slide. */
  hasPhoto?: boolean;
}

/**
 * Assign an archetype to every slide in a deck.
 *
 * Deterministic and cheap — no model call. Two rules do the work:
 *
 *   1. An archetype that wants a photograph is only chosen when there IS one.
 *      An empty `cb-shot` renders as a dead grey rectangle, which is worse than
 *      the text-only composition it replaced.
 *   2. The same archetype may not run more than `MAX_RUN` slides. That is the
 *      rule that turns a stack of identical frames into a deck with rhythm, and
 *      it is why this takes the whole deck rather than one slide at a time.
 *
 * Falls back to the role's first option when nothing else fits: a repeated
 * archetype is a worse deck, but a slide with no composition at all is a bug.
 */
export function assignArchetypes(slides: readonly SlideForSelection[]): ArchetypeKey[] {
  const out: ArchetypeKey[] = [];

  for (const slide of slides) {
    const options = ROLE_OPTIONS[slide.role] ?? ['statement'];

    const usable = options.filter((key) => {
      const appetite = ARCHETYPES[key].photo;
      if (appetite === 'required') return slide.hasPhoto === true;
      // `never` on a slide that HAS a picture is allowed — the picture simply
      // goes unused rather than forcing a composition the role cannot wear.
      return true;
    });

    const runOf = (key: ArchetypeKey) => {
      let n = 0;
      for (let i = out.length - 1; i >= 0 && out[i] === key; i -= 1) n += 1;
      return n;
    };

    const pick =
      usable.find((key) => runOf(key) < MAX_RUN) ??
      usable[0] ??
      options[0] ??
      'statement';

    out.push(pick);
  }

  return out;
}

// ── The CSS ──────────────────────────────────────────────────────────────────

/**
 * Slack, expressed as flexbox on the slide root.
 *
 * `center` is nudged off true centre: optically centred content sits slightly
 * high, and a frame centred by arithmetic reads as if it has sagged.
 */
const JUSTIFY: Record<SlackPolicy, string> = {
  top: 'flex-end',
  bottom: 'flex-start',
  center: 'center',
  between: 'space-between',
};

/**
 * App-owned, emitted after the brand sheet so it wins.
 *
 * The `> .fill` reset is the load-bearing line. Brands bottom-anchor with a
 * flex-grow spacer and the composer scatters more of them per slide; leaving
 * them live would mean the archetype and the markup fight over the same space,
 * and the markup would usually win. Where the archetype owns the slack, the
 * spacers stop growing — except under `between`, which is the one policy that
 * genuinely wants an interior gap and so keeps them.
 */
/**
 * The full-bleed anchor, when a picture's own luminance overrode the
 * archetype's default.
 *
 * Two things move together, and they have to: the type goes to the dark end of
 * the photograph, and the scrim follows it. Moving the type without the scrim
 * puts cream on a bright sky; moving the scrim without the type darkens the end
 * nobody is reading.
 *
 * Higher specificity than the archetype's own `justify-content` because it is
 * deciding the same property with better information.
 */
export function bleedAnchorCss(scope: string, anchor: 'top' | 'bottom'): string {
  const justify = anchor === 'top' ? 'flex-start' : 'flex-end';
  // The scrim is painted by the background layer; re-point its gradient so the
  // heavy end is the end carrying type.
  const dir = anchor === 'top' ? '0deg' : '180deg';
  return [
    `.${scope} .cb-slide[data-archetype]{justify-content:${justify}}`,
    `.${scope} .cb-bg-layer::after{background:linear-gradient(${dir}, ` +
      `color-mix(in srgb, var(--cb-ground) 25%, transparent) 0%, ` +
      `color-mix(in srgb, var(--cb-ground) 30%, transparent) 45%, ` +
      `color-mix(in srgb, var(--cb-ground) 88%, transparent) 100%)}`,
  ].join('\n');
}

export function slideArchetypeCss(): string {
  const rules: string[] = [
    // Every archetype composes in a column. Brands already do this; stating it
    // here means a recipe that forgot cannot break the slack policy.
    `.cb-slide[data-archetype]{display:flex;flex-direction:column}`,
  ];

  for (const a of Object.values(ARCHETYPES) as Archetype[]) {
    const sel = `.cb-slide[data-archetype="${a.key}"]`;
    rules.push(`${sel}{justify-content:${JUSTIFY[a.slack]}}`);

    if (a.slack !== 'between') {
      rules.push(`${sel} > .fill{flex:0 0 0;min-height:0}`);
    }
    if (a.slack === 'center') {
      // Optical centre: a little more room below than above.
      rules.push(`${sel}{padding-bottom:calc(var(--cb-pad-bottom, 0px) + 2%)}`);
    }
  }

  return rules.join('\n');
}
