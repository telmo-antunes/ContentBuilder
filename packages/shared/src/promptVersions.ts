/**
 * PROMPT VERSIONING — what the AI knew when it made this.
 *
 * Every generated artifact in this app is the output of a prompt, and those
 * prompts improve. A recipe authored in July was designed by a prompt that had
 * never heard of the legibility floor; a post composed last week was arranged
 * by a composer that could not produce a list. Both are still sitting in the
 * database looking finished, and nothing says otherwise.
 *
 * So each touchpoint carries a VERSION, artifacts are stamped with the version
 * that made them, and being behind can be detected.
 *
 * THE RULE THAT KEEPS THIS USEFUL: a version number alone is not a reason to
 * flag anything. "You are on v2, v4 exists" is true of everything forever, and
 * a badge that is always lit is wallpaper. A release therefore ships with a
 * DETECTOR — a pure check that finds the thing in YOUR artifact the new version
 * would fix. An artifact is flagged only when it is behind AND a detector
 * actually fires, which turns "you're on v2" into "your call to action is 32px;
 * v3 raises it to 47px". Releases without a detector still appear in the
 * changelog; they simply never raise a flag on their own.
 *
 * Nothing here upgrades anything. Re-authoring a recipe costs money and changes
 * a design; re-composing a slide rewrites copy. This module reports, and the
 * person decides.
 */

/** The AI touchpoints whose prompts are versioned independently. */
export const TOUCHPOINTS = ['recipeAuthor', 'recipeCritique', 'parse', 'compose', 'caption', 'vision'] as const;
export type TouchpointId = (typeof TOUCHPOINTS)[number];

/** What a detector inspects. */
export type DetectorId =
  | 'typeFloor'
  | 'listSkeleton'
  | 'secretList'
  | 'noImageSlots'
  | 'noAmbientMotion'
  | 'noListVocabulary'
  | 'brandMarkDrift'
  | 'emptyList'
  | 'strandedSpacer';

/**
 * A short phrase naming what a detector found, for chips on individual slides
 * where the full sentence does not fit. The long form lives in the finding.
 */
export const DETECTOR_LABEL: Record<DetectorId, string> = {
  typeFloor: 'type below phone-legible size',
  listSkeleton: 'list rows that collapse',
  secretList: 'an enumeration written as a paragraph',
  noImageSlots: 'nowhere to put a photograph',
  noAmbientMotion: 'photographs that sit still in video',
  noListVocabulary: 'no list vocabulary to write rows with',
  brandMarkDrift: 'a brand mark built differently here',
  emptyList: 'a list slide with nothing in it',
  strandedSpacer: 'content stranded under the top edge',
};

export interface PromptRelease {
  version: number;
  /** When it shipped, ISO date — shown in the changelog. */
  date: string;
  /** One line, in the language of the result rather than the prompt. */
  summary: string;
  /** What actually got better. This IS the diff worth reading. */
  improves: string[];
  /**
   * Proves the release matters for a given artifact. A release with no
   * detector is informational: it appears in the changelog and never flags.
   */
  detector?: DetectorId;
}

export interface Touchpoint {
  id: TouchpointId;
  /** Human name, e.g. "Brand recipe author". */
  label: string;
  /** One line on what this touchpoint does. */
  role: string;
  /** Does its version live on the BRAND's recipe or on a POST's slides? */
  affects: 'brand' | 'post';
  /** Ascending. The last entry is the current version. */
  releases: PromptRelease[];
}

/**
 * The registry.
 *
 * Bumping is not optional bookkeeping: `promptHashes.test.ts` fails when a
 * prompt's text changes and its version does not, so a change forces an entry
 * here. That is the whole reason the numbers stay honest.
 */
export const TOUCHPOINT_REGISTRY: Record<TouchpointId, Touchpoint> = {
  recipeAuthor: {
    id: 'recipeAuthor',
    label: 'Brand recipe author',
    role: 'Designs the brand’s whole system — palette, type, signature move, imagery, motion — once per brand.',
    affects: 'brand',
    releases: [
      {
        version: 1,
        date: '2026-07-01',
        summary: 'The original design-system author.',
        improves: ['Authored tokens, a stylesheet, a signature move and a component vocabulary.'],
      },
      {
        version: 2,
        date: '2026-07-28',
        summary: 'Type is sized for a phone instead of for the canvas.',
        improves: [
          'The scale is stated in what a phone actually shows, not in canvas pixels.',
          'Body copy, the call to action and supporting marks can no longer land below the size at which people read.',
          'Names the specific trap: body at 30px looks generous beside a 100px headline and arrives at 11pt.',
        ],
        detector: 'typeFloor',
      },
      {
        version: 3,
        date: '2026-07-29',
        summary: 'The brand art-directs photography, and stops owning list structure.',
        improves: [
          'Every brand authors its own photo treatment, so one brand’s pictures no longer look like another’s.',
          'Requires a real list vocabulary rather than maybe-a-panel.',
          'Stops brands laying a list row out as one line with the detail pushed right — which collapses at legible type sizes.',
          'The brand picks the bullet glyph; the app owns the row skeleton.',
        ],
        detector: 'listSkeleton',
      },
      {
        version: 4,
        date: '2026-07-30',
        summary: 'Brands choose how their posts MOVE in video.',
        improves: [
          'An ambient character (parallax / push / drift) is authored alongside the reveal signature.',
          'A premium brand breathes slowly; an energetic one pushes harder.',
        ],
        detector: 'noAmbientMotion',
      },
      {
        version: 5,
        date: '2026-07-30',
        summary: 'Motion is an opening move that lands, not a drift that never stops.',
        improves: [
          'The camera move happens in the first three seconds and then holds, instead of creeping for the whole slide.',
          'Every layer arrives at the framing you chose, so a zoom can no longer crop your photograph and leave it cropped.',
          'Intensity now means how far from rest the move STARTS — the destination is always your composition.',
        ],
        detector: 'noAmbientMotion',
      },
    ],
  },

  recipeCritique: {
    id: 'recipeCritique',
    label: 'Recipe critic',
    role: 'Reviews a freshly authored recipe against a reference bar and patches what falls short.',
    affects: 'brand',
    releases: [
      {
        version: 1,
        date: '2026-07-01',
        summary: 'The original design critic.',
        improves: ['Judged background, signature, type scale, vocabulary, formats and motion.'],
      },
    ],
  },

  parse: {
    id: 'parse',
    label: 'Copywriter',
    role: 'Turns your idea into slides — the words, the roles, and which slides want a photograph.',
    affects: 'post',
    releases: [
      {
        version: 1,
        date: '2026-07-01',
        summary: 'The original carousel copywriter.',
        improves: ['Split an idea into roles and verbatim copy parts.'],
      },
      {
        version: 2,
        date: '2026-07-28',
        summary: 'Decides per slide whether a photograph earns its place.',
        improves: [
          'Any slide can ask for a picture, judged on its own merit.',
          'Previously only covers could, and only for brands whose recipe said photography was the hero — so whole brands could never show an image anywhere.',
        ],
        detector: 'noImageSlots',
      },
      {
        version: 3,
        date: '2026-07-29',
        summary: 'Enumerations come out as lists instead of run-on paragraphs.',
        improves: [
          'A slide headlined “four things” now produces four rows, not one wall of prose.',
          'Hard character budgets, so copy cannot silently overflow the canvas.',
          'A slide with a photograph gets an eyebrow and a headline only — a picture and a paragraph cannot share one poster.',
        ],
        detector: 'secretList',
      },
      {
        version: 4,
        date: '2026-08-10',
        summary: 'Writes from the article you linked, follows your slide plan, and keeps your exact words.',
        improves: [
          'A brief that cites a page is written FROM that page — its real headline, its real structure, its actual lines — instead of from the URL.',
          'A per-slide plan is an order: one slide per entry, in that order, each doing what its entry says.',
          'Anything you put in "quotes" is used word for word, and is never shortened by a copy budget.',
          'A list slide can no longer lose its list to a photograph — the rows win, because they are the content.',
          'The deck is as long as the material earns; the manual slide-count dial is gone.',
          'Nothing is truncated with an ellipsis any more — over-long copy ends on a finished clause.',
        ],
        detector: 'emptyList',
      },
    ],
  },

  compose: {
    id: 'compose',
    label: 'Slide composer',
    role: 'Arranges the written copy into the brand’s own markup, without changing a word.',
    affects: 'post',
    releases: [
      {
        version: 1,
        date: '2026-07-01',
        summary: 'The original typesetter.',
        improves: ['Arranged copy using only the brand’s component classes.'],
      },
      {
        version: 2,
        date: '2026-07-28',
        summary: 'Leaves a real hole for your photograph.',
        improves: [
          'A slide that wants a picture is composed with a visible, correctly proportioned placeholder you fill yourself.',
          'Stock photos are no longer silently attached on your behalf.',
        ],
        detector: 'noImageSlots',
      },
      {
        version: 3,
        date: '2026-07-30',
        summary: 'A picture replaces content instead of being added to it.',
        improves: [
          'Slots are told what each shape costs, so a photo slide no longer overflows.',
          'Rows are laid out as a real enumeration with the brand’s list vocabulary.',
          'No empty marker elements, which rendered as a gap where a bullet belonged.',
        ],
        detector: 'noListVocabulary',
      },
      {
        version: 4,
        date: '2026-07-31',
        summary: 'The brand mark is the same mark on every slide.',
        improves: [
          'The logo is treated as an identity to reproduce, not a composition to re-derive slide by slide.',
          'No loose text in the logo wrapper — it inherited the body face instead of the brand’s.',
          'Nothing is placed inside the element that carries the logo image, where words landed on top of the picture.',
        ],
        detector: 'brandMarkDrift',
      },
      {
        version: 5,
        date: '2026-08-10',
        summary: 'A slide fills its canvas instead of piling up under the top edge.',
        improves: [
          'A spacer left dangling by an absent handle or an unused photo slot no longer grows into empty canvas.',
          'The kicker stays pinned to the top edge and the statement settles on the baseline — the brand’s own arrangement, restored.',
          'A slide asks for a photograph only where the brand’s composition can actually hold one.',
        ],
        detector: 'strandedSpacer',
      },
    ],
  },

  caption: {
    id: 'caption',
    label: 'Caption writer',
    role: 'Writes the post’s caption and hashtags in the brand’s voice.',
    affects: 'post',
    releases: [
      {
        version: 1,
        date: '2026-07-01',
        summary: 'The original caption writer.',
        improves: ['Wrote a caption grounded in the brand voice and profile.'],
      },
    ],
  },

  vision: {
    id: 'vision',
    label: 'Brand reader',
    role: 'Looks at your website and reads its colours, type and voice.',
    affects: 'brand',
    releases: [
      {
        version: 1,
        date: '2026-07-01',
        summary: 'The original brand reader.',
        improves: ['Read palette roles, type personality and a one-line style descriptor.'],
      },
      {
        version: 2,
        date: '2026-07-30',
        summary: 'Asks for a voice worth writing in, and stops cutting it in half.',
        improves: [
          'Register, person, energy, the words the brand reaches for and what it avoids — with a characteristic phrase quoted from the copy.',
          'The answer is no longer truncated mid-word at 240 characters before being handed to the caption writer and the recipe author.',
        ],
      },
    ],
  },
};

/** The version a touchpoint is on today. */
export function currentVersion(id: TouchpointId): number {
  const rs = TOUCHPOINT_REGISTRY[id].releases;
  return rs[rs.length - 1]?.version ?? 1;
}

/** Every touchpoint at its current version — what a fresh artifact is stamped with. */
export function currentVersions(affects?: 'brand' | 'post'): Partial<Record<TouchpointId, number>> {
  const out: Partial<Record<TouchpointId, number>> = {};
  for (const id of TOUCHPOINTS) {
    if (affects && TOUCHPOINT_REGISTRY[id].affects !== affects) continue;
    out[id] = currentVersion(id);
  }
  return out;
}

/** The releases an artifact on `from` has not yet had. */
export function releasesSince(id: TouchpointId, from: number): PromptRelease[] {
  return TOUCHPOINT_REGISTRY[id].releases.filter((r) => r.version > from);
}

/** One concrete thing a newer prompt would improve about a specific artifact. */
export interface VersionFinding {
  touchpoint: TouchpointId;
  detector: DetectorId;
  /** Written for the person, naming the actual value where possible. */
  message: string;
}

export interface UpdateStatus {
  /** Per touchpoint: where this artifact sits, and where the app is. */
  behind: Array<{ touchpoint: TouchpointId; from: number; to: number; releases: PromptRelease[] }>;
  /** Detector hits — the evidence. Empty means being behind changed nothing here. */
  findings: VersionFinding[];
  /**
   * Show a badge? Only when something is BOTH out of date and demonstrably
   * improvable. Behind-with-no-findings is reported, never flagged.
   */
  flagged: boolean;
}

/**
 * Compare an artifact's stamps against the registry.
 *
 * `runDetector` is injected rather than imported so this module stays free of
 * the recipe/HTML machinery and remains trivially testable; the API passes the
 * real detectors in.
 */
export function updateStatus(
  stamped: Partial<Record<TouchpointId, number>> | undefined,
  affects: 'brand' | 'post',
  runDetector: (d: DetectorId) => VersionFinding['message'][] ,
): UpdateStatus {
  const behind: UpdateStatus['behind'] = [];
  const findings: VersionFinding[] = [];
  const seen = new Set<DetectorId>();

  for (const id of TOUCHPOINTS) {
    if (TOUCHPOINT_REGISTRY[id].affects !== affects) continue;
    // No stamp at all means the artifact predates versioning entirely.
    const from = stamped?.[id] ?? 0;
    const to = currentVersion(id);
    if (from >= to) continue;
    const releases = releasesSince(id, from);
    behind.push({ touchpoint: id, from, to, releases });
    for (const r of releases) {
      if (!r.detector || seen.has(r.detector)) continue;
      seen.add(r.detector);
      for (const message of runDetector(r.detector)) {
        findings.push({ touchpoint: id, detector: r.detector, message });
      }
    }
  }

  return { behind, findings, flagged: behind.length > 0 && findings.length > 0 };
}
