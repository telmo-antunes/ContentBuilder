/**
 * DOES THE PICTURE AGREE WITH THE WORDS?
 *
 * The cheapest catch for the most common failure in this pipeline, and the one
 * a careful operator still misses. In a real build two of three images
 * illustrated the OPPOSITE of their slide:
 *
 *   · a slide reading "when water sheets off cleanly, your coating is working"
 *     sat above a photo of flat droplets clinging — the failure pattern the
 *     article describes;
 *   · a slide reading "judge it after a proper decontamination wash" sat above
 *     an automatic wash bay, one slide before the deck names automatic washes
 *     as the number-one thing that destroys a coating.
 *
 * Both were chosen deliberately. Neither is wrong as a photograph. They are
 * wrong *against the sentence above them*, and nothing in the tool was looking
 * at the pairing — the composer never sees a picture, and the picker never
 * reads the copy.
 *
 * This is the same class of check as the faithfulness rule in the copywriter
 * prompt, applied to pixels instead of prose. It ASKS rather than blocks: an
 * ironic or deliberately contrasting pairing is legitimate, and a check that
 * refuses one is a check people learn to switch off.
 */
import sharp from 'sharp';
import { aiMessage, modelFor, textOf } from './ai';
import { recordUsage } from './usage';

/** One slide's pairing, ready for the vision call. */
export interface SlidePairing {
  /** 1-based, as the reviewer counts them. */
  index: number;
  /** The slide's visible copy, tags stripped. */
  copy: string;
  /** The image as stored — PNG or JPEG bytes. */
  image: Buffer;
}

export interface Contradiction {
  slide: number;
  /** What the copy asserts, in the checker's words. */
  says: string;
  /** What the picture shows. */
  shows: string;
  /** The question to put to the reviewer. */
  question: string;
}

/**
 * A photograph that is not ABOUT its slide — a different question from whether
 * it contradicts it, and a much easier one.
 *
 * A real deck shipped a CRM screenshot of a customer list under "Ozone — read
 * the manual", and a photo of a seat being extracted under "The headliner". The
 * contradiction check passed both, correctly: neither asserts the opposite of
 * its slide, and the prompt below has always excluded photos that are "merely
 * generic, decorative, or loosely related" because a false alarm there teaches
 * people to ignore the check.
 *
 * But irrelevance is exactly what `fillSlotsFromPool` produces. It fills a slot
 * from the brand's whole library whether or not that library holds a picture of
 * what this slide is about, and nobody chose the result. Kept as its own list
 * rather than folded into `contradictions` for the same reason the distinction
 * matters: a contradiction says the deck is WRONG, and this says nobody looked.
 */
export interface Unrelated {
  slide: number;
  /** What this slide is about, in the checker's words. */
  about: string;
  /** What the picture shows instead. */
  shows: string;
  /** The question to put to the reviewer. */
  question: string;
}

const SYSTEM = `You check whether a social slide's PHOTOGRAPH agrees with its COPY.

You are shown one image per slide, each followed by that slide's text. Report ONLY direct contradictions — cases where a reader who looked at the picture would take away the opposite of what the words say. Two kinds:

1. STATE MISMATCH — the copy asserts a condition (healthy, clean, worn, damaged) and the photo shows the other one.
   WORK THIS ONE THROUGH THE WORD, not by impression. The state case is the harder judgement and the more common one, and asking it loosely gets it right only about half the time. So do it in three steps, for each slide that asserts a state:
     a. QUOTE the word the copy uses for the state — "tight", "flat", "clinging", "sheeting", "beading", "matte", "swirled", "even".
     b. Name its OPPOSITE — the thing the photo would have to show for the copy to be wrong ("tight beads" ↔ "flat, clinging film"; "sheets off" ↔ "sits in droplets").
     c. Ask only that narrow question of the photo: which of the two does this picture show? Report a contradiction only when the photo clearly shows the opposite, not when it is ambiguous or shows neither.
   If the copy asserts no state in words, there is no state mismatch to find on that slide. Do not infer one.
2. PRACTICE MISMATCH — the deck warns against a practice, or recommends one, and a photo depicts the opposite practice approvingly. THE WHOLE DECK COUNTS, not just the slide the photo sits on: a photo of a practice that a LATER slide names as harmful is a contradiction, because the reader meets both. You are given every slide's copy for exactly this reason.

NOT a contradiction, and never report it:
- A photo that is merely generic, decorative, or loosely related.
- A photo that illustrates the topic without illustrating the specific claim.
- Aesthetic problems: crop, colour, composition, quality. Not your job.
- A pairing that is obviously deliberate irony ("this is what NOT to do").

Judge the picture on what it actually depicts, not on what it could symbolise. If you are unsure, say nothing — a false alarm here trains people to ignore the check.

THEN, SEPARATELY, A SECOND AND MUCH EASIER QUESTION: is each photograph ABOUT its slide at all?

Some pictures are attached automatically from the brand's library, which may hold nothing relevant to this slide. A real deck shipped a screenshot of a software customer list under a slide about ozone machines, and a photo of a car SEAT being cleaned under a slide about the roof lining. Neither contradicts its slide. Both are simply not pictures of what the slide is about, and nobody chose them.

Report one as "unrelated" when a reader would not connect the picture to the words at all — a different subject, a different object, a screenshot where the slide discusses a physical thing.

NOT unrelated, and never report it:
- A picture of the right subject that is merely atmospheric, wide, or abstract.
- A picture that shows the topic without showing the exact object named.
- A picture whose connection needs a sentence to explain but is real once explained.
- Anything you already reported as a contradiction.

The bar is deliberately low: report it only when you cannot say what the picture has to do with the slide.

Return STRICT JSON only, no prose, no fences:
{"contradictions":[{"slide":<number>,"says":"<what the copy asserts, <=90 chars>","shows":"<what the photo depicts, <=90 chars>","question":"<one sentence ending in a question mark>"}],"unrelated":[{"slide":<number>,"about":"<what the slide is about, <=90 chars>","shows":"<what the photo depicts, <=90 chars>","question":"<one sentence ending in a question mark>"}]}

Two empty arrays are the expected answer for most decks.`;

/**
 * Downscaled hard: this asks "what is in this picture", which survives 640px
 * fine, and a deck of full 1080px frames is an expensive way to ask it.
 */
async function shrink(image: Buffer): Promise<string | null> {
  try {
    const out = await sharp(image).resize(640, 640, { fit: 'inside' }).jpeg({ quality: 72 }).toBuffer();
    return out.toString('base64');
  } catch {
    return null;
  }
}

/**
 * Never throws and never blocks. A check that can fail a build is a check that
 * gets removed the first time it is wrong at an inconvenient moment.
 */
export async function findImageCopyContradictions(
  pairings: SlidePairing[],
  opts?: {
    model?: string;
    /**
     * Every slide's copy in order, including slides with no picture.
     *
     * Without it the checker judges each pairing alone and misses the failure
     * that prompted this: a photo of an automatic wash bay under "judge it
     * after a decontamination wash" reads fine in isolation, and is a flat
     * contradiction one slide before the deck names automatic washes as the
     * number-one thing that destroys a coating.
     */
    deckCopy?: string[];
  },
): Promise<{ contradictions: Contradiction[]; unrelated: Unrelated[]; checked: number; skipped?: string }> {
  const usable = pairings.filter((p) => p.copy.trim() && p.image?.length);
  if (!usable.length) {
    return { contradictions: [], unrelated: [], checked: 0, skipped: 'no slide has both a picture and copy' };
  }

  try {
    const content: Array<Record<string, unknown>> = [];
    let checked = 0;
    for (const p of usable) {
      const data = await shrink(p.image);
      if (!data) continue;
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } });
      content.push({ type: 'text', text: `Slide ${p.index} copy:\n${p.copy.slice(0, 600)}` });
      checked += 1;
    }
    if (!checked) return { contradictions: [], unrelated: [], checked: 0, skipped: 'no image could be read' };

    if (opts?.deckCopy?.length) {
      content.push({
        type: 'text',
        text:
          'FULL DECK, in order — use it to judge whether a photo contradicts something said ELSEWHERE in the deck:\n'
          + opts.deckCopy.map((c, i) => `Slide ${i + 1}: ${c.slice(0, 300)}`).join('\n'),
      });
    }

    const model = opts?.model ?? (await modelFor('vision'));
    const resp = await aiMessage({
      model,
      max_tokens: 1200,
      system: SYSTEM,
      messages: [{ role: 'user', content: content as never }],
    });
    await recordUsage({
      feature: 'post:imageCopyCheck',
      model,
      inputTokens: resp.usage?.input_tokens,
      outputTokens: resp.usage?.output_tokens,
    }).catch(() => {});

    const text = textOf(resp);
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1) return { contradictions: [], unrelated: [], checked, skipped: 'no JSON verdict' };

    const parsed = JSON.parse(text.slice(start, end + 1)) as { contradictions?: unknown; unrelated?: unknown };
    const known = new Set(usable.map((p) => p.index));
    // A verdict about a slide that was not sent is a hallucinated slide number,
    // and pointing the reviewer at the wrong card is worse than saying nothing.
    const sent = (c: { slide?: unknown; question?: unknown }) =>
      typeof c.slide === 'number' && known.has(c.slide) && Boolean(c.question);

    const contradictions = (Array.isArray(parsed.contradictions) ? parsed.contradictions : [])
      .map((c) => c as Partial<Contradiction>)
      .filter(sent)
      .slice(0, 12)
      .map((c) => ({
        slide: c.slide as number,
        says: String(c.says ?? '').slice(0, 90),
        shows: String(c.shows ?? '').slice(0, 90),
        question: String(c.question).slice(0, 220),
      }));

    // A slide already named as a contradiction is not also reported as
    // unrelated: the reviewer gets one question per picture, and the sharper
    // one wins.
    const flagged = new Set(contradictions.map((c) => c.slide));
    const unrelated = (Array.isArray(parsed.unrelated) ? parsed.unrelated : [])
      .map((c) => c as Partial<Unrelated>)
      .filter((c) => sent(c) && !flagged.has(c.slide as number))
      .slice(0, 12)
      .map((c) => ({
        slide: c.slide as number,
        about: String(c.about ?? '').slice(0, 90),
        shows: String(c.shows ?? '').slice(0, 90),
        question: String(c.question).slice(0, 220),
      }));

    return { contradictions, unrelated, checked };
  } catch (err) {
    console.warn('[imageCopyCheck]', err instanceof Error ? err.message : err);
    return { contradictions: [], unrelated: [], checked: 0, skipped: 'the check could not run' };
  }
}
