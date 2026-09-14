# Deck scorecard — the rubric

Every deck in the audit is scored on eight dimensions, 1–5 each, from its
**contact sheet at feed scale** (never from its JSON) and, where copy fidelity
is judged, against the brief it was written from. Whole numbers only. A deck's
score is the eight numbers, not their sum — a 5 on hierarchy does not buy back
a 1 on message fidelity.

Calibration: done 2026-09-13 (see scores/calibration.md). The owner scored
four decks; the anchors for fidelity, hierarchy, legibility and CTA were
rewritten where the two disagreed by 2 or more. Standing rule for Claude:
score with the phone in one hand and one second per slide.

| # | Dimension | 1 — fails | 3 — acceptable | 5 — reference grade |
|---|---|---|---|---|
| 1 | **Message fidelity** — does the deck TEACH what the post teaches? | Generic abstractions about the topic; claims the source never makes; the point of the post is missing; or bare list items with none of the reasoning behind them. | The main point survives; some slides paraphrase loosely or drop the why. | A reader of the deck could reconstruct the post's argument, reasons included; every concrete fact, number and list item is the source's own. |
| 2 | **Hook** — does slide 1 alone earn a swipe? | A title. Restates the topic. | A real line, but one you have read before. | Stops the thumb: a specific tension, number, or contradiction in the reader's own world, in under ten words. |
| 3 | **Specificity** — concrete nouns, numbers, situations vs filler | "Quality matters", "the right way", "what to avoid". | Mostly concrete, a few filler lines. | Every slide names a thing a practitioner would recognise; nothing could be pasted into another brand's post. |
| 4 | **Variety** — do consecutive slides differ in composition? | Seven re-skins of one skeleton; same ground, same list panel, same inset card. | Two or three arrangements alternate; one photo placement. | Each slide is composed for what it says; ground, arrangement and picture placement change with the content, and the deck still reads as one system. |
| 5 | **Hierarchy** — does the eye know where to go first, second, third? | Equal-weight blocks; the headline competes with the body or the panel; the same stack on every slide is no hierarchy at all. | At least one element per slide clearly dominates the frame; one or two flat slides. | One subject per slide at display size, one anchor, supporting elements grouped tight; nothing floats in leftover space. |
| 6 | **Brand loyalty** — is this unmistakably THIS brand? | Could be any dark-and-gold account; the logo is the only signal. | Type and colour are right; the signature move appears sometimes. | Signature move, type personality, imagery treatment and voice all present; the owner would post it without touching it. |
| 7 | **Feed legibility** — at 393px, held at arm's length | You would have to stop and read it: body copy small against the headline, a screenshot you cannot make out, a dense panel. | The headline reads instantly; the body reads with effort on one or two slides. | Every line reads in a second at phone size, the body included; any picture is legible at feed scale; safe areas respected on stories. |
| 8 | **CTA clarity** — does the close say what to do, once, deliberately? | No button, or the offer appears twice, or a generic keyword, or a button buried under an eyebrow, a headline, a tagline and a handle. | A button with the right keyword; the close still reads as a form, not an arrival. | One sentence and one button, the post's own keyword, styled as the brand's button, nothing else on the frame. |

## How to score

1. Open the contact sheet. Do not read the JSON first.
2. Score 2, 4, 5, 6, 7, 8 from the sheet alone.
3. Read the brief/source, then score 1 and 3.
4. Write one sentence of evidence per dimension that scored 1, 2 or 5. A score
   without a named slide is not a score.

## Record shape

Scores live next to the deck they judge, in `docs/audit/scores/<deck-id>.md`:

```
deck: <project or lab id>   brand: <name>   scorer: owner|claude   date: YYYY-MM-DD
fidelity 3 · hook 2 · specificity 2 · variety 1 · hierarchy 3 · brand 4 · legibility 4 · cta 3
evidence:
- hook 2: slide 1 "The message to send after a ceramic coating" is the post title, not a hook.
- variety 1: slides 2, 3, 5, 6 share the panel skeleton on the same ground.
```
