# 01 — Prompt lab

*Phase 1. Claude is the model; the pipeline is real. Every deck here went
through `scripts/composeFromParse.ts` with `--no-model`, so what the pixels
show is the recipe, the fragments and the gates — not a model's variance.*

## Findings the bench raised before a pixel rendered

1. **`.tagline` is styled but never advertised.** The detailmasters stylesheet
   defines `.tagline` (46px italic gold), the copywriter writes a tagline on
   nearly every cover and close, and the recipe's `components` list omits it —
   so a fragment carrying `{{tagline}}` is rejected as "undefined class" and
   cover + cta go to the model on every deck. `validateRecipeConsistency`
   drops components the CSS never defines; nothing catches the reverse. A
   migration that advertises every styled class the author forgot would fix
   every stored brand at once. (Baseline cause 2, now with its mechanism.)
2. **The dangling-word rule fires on source-verbatim rows.** "The date they
   cannot wash it until", "What not to do until then", "How to wash it from
   that date on", "One date — the rest follows from it" are the brief's own
   items, and `unfinishedProse` reports each as stopping mid-thought. Rows are
   scanned, not read, and a row that names a rule legitimately ends on a
   preposition. In production these become `copyFaults`, which BLOCK the ship
   bar — for copy the user supplied word for word. Rows should be exempt from
   the dangling-word rule (keep the sentence-break rule).
3. **Notes without terminal punctuation are faults.** Exhibit-style notes
   ("what the client paid") are labels; the terminal-punctuation rule for
   `note` should apply only when the note contains a verb or exceeds ~30
   characters. Minor.
4. **The eyebrow clamp cuts mid-phrase and says nothing.** "Discounts without
   losing margin" (31 chars) became "Discounts without losing". The same clamp
   class that cut both shipped covers. A clamp that cannot end on a phrase
   boundary should report a fault, not ship the cut.
5. **`.panel .row` is 32px.** The recipe sets list rows at 32px (26px notes)
   on a 1080px canvas — under the owner's legibility bar by a wide margin,
   and the numbered index is 30px. No fragment can fix this; it is a recipe
   (re-author) fix, and a candidate render-time floor: no list row under 40px.

## Ceiling decks — what the best hand-made deck looks like on the current recipe

Two briefs (aftercare, getting-paid), parse written by hand using the seven
forms from 01-references.md, fragments hand-composed in the brand's own
classes, photos chosen by hand, two iterations, **$0**. Sheets:
[ceiling2--aftercare](sheets/ceiling2--aftercare.jpg),
[ceiling2--gettingpaid](sheets/ceiling2--gettingpaid.jpg). Scores in
[scores/](scores/) (owner-calibrated).

| dimension | shipped aftercare (owner) | ceiling aftercare (claude, calibrated) |
|---|---|---|
| fidelity | 2 | 4 |
| hook | 1 | 4 |
| specificity | 2 | 3 |
| variety | 2 | 3 |
| hierarchy | 1 | 3 |
| brand | 2 | 4 |
| legibility | 1 | **2** |
| cta | 1 | 4 |

**What moved, and what did not.** Hook, CTA, brand and fidelity are copy
and arrangement problems and moved by two or three points with no model in
the loop — those are prompt and fragment fixes. Legibility and variety barely
moved, and the reasons are all in the recipe or the app layer, none in a
prompt:

6. **List slides are top-packed by policy.** The `list` archetype's slack
   policy is `bottom` and the archetype layer neutralises the fragment's own
   spacers, so four short rows always leave the lower half of the frame
   empty — the exact look the owner scored hierarchy 1. Centring a short
   list (or letting rows grow to fill) belongs in the archetype layer.
7. **Horizontal overflow is unmeasured.** A `.split` with three cards clipped
   "Your net" off the right edge and every gate reported clean; the probe
   measures vertical overflow, collisions and slack only.
8. **There is no exhibit or number form.** `.split` is built for two cards;
   `.stat` is one figure beside a headline. A 2×2 of figures with labels, and
   a single figure at poster size with a one-sentence reading, do not exist
   in the vocabulary.
9. **Product proof needs a crop, not a card.** Slot photos support `focal`
   but not a zoom, so a dashboard screenshot arrives whole and shrinks to a
   card. The Notion move (one element at real scale) needs either a zoom on
   the slot or the upstream image already cropped.
10. **The quote face is the right size for an object.** Setting the template
    (and the "part that matters" sentence) in `.quote` inside a card was the
    single biggest legibility gain available today; `.body` at 34px muted is
    for support text only. The author prompt should ask for a "display body"
    size for the one sentence a slide is about.

**Decision.** The recipe and its contract cap the output before the prompts
do. Phase 2.3 (re-author both recipes against a contract that carries the
seven forms, larger rows, an exhibit and a number form) moves ahead of the
tiering test. The copywriter rewrite (below) still matters — it is what puts
an opinion on the cover and a reason under each row — and costs nothing.

## The copywriter, diagnosed against the ceiling

Same brief, same facts. What the stored parse (Sonnet 4.6, `PARSE_SYSTEM`
v9) wrote versus what the ceiling wrote, by slide:

| slide | stored parse | ceiling | the rule the prompt lacks |
|---|---|---|---|
| cover | headline = the post's title ("The message to send after coating"); the hook demoted to a tagline | the reader's failure as the headline; the title nowhere | *The cover is never the title. It is the reader's problem, an opinion or a number.* The prompt says "a hook" and gives no example of one. |
| 2 | statement with a 3-sentence body | one line + a 5-word tagline | *A statement slide may be one line.* The prompt's "one supporting element at most" reads as "one is expected". |
| lists | bare rows, no notes | bare rows, no notes (the brief has no reasons) | the prompt is right here; the BRIEF is the limiter — the CRM payload should carry a reason per item where the post has one |
| product | "In the dashboard, open the booking menu and choose Send update" as a body sentence | "Booking menu, then Send update." as the headline, the fact about the record as the body | *When the material names a control, the control is the headline.* |
| template | body text | the template as the slide's object (quote face) | *A template, a quote, a message to copy is an OBJECT — mark it so the composer can set it as one.* Needs a part for it (`quote` already exists; the parse never uses it for non-testimonials). |
| cta | eyebrow + headline + tagline + cta + handle | headline + tagline + cta | *The close is one line and one button.* The prompt lists cta parts without saying which to leave out. |

Everything in the right-hand column is a sentence with an example, not a
rule. That is the shape of the rewrite.

## Copywriter v10 — the rewrite

`PARSE_SYSTEM` (`apps/api/src/lib/htmlDirector/compose.ts`) is rewritten in
three movements: the job, what a good deck looks like (seven sentences, each
with an example), a worked brief-and-deck, then the contract — every rule the
machine checks, unchanged in substance. The tool schema's field descriptions
now carry the same distinctions (a headline is never the title; "quote" is
the slide's object; a cta is under 24 characters with the keyword).

What it asks for that v9 did not: a cover that is the reader's problem, an
opinion or a number; one-line slides; the named control as the headline;
templates and rules as objects in "quote"; a three-part close. What it stops
asking for: nothing — v9's rules are all present, reorganised under "the
contract" and framed as physics, the way the compose prompt already does.

Registry: parse v10 (`packages/shared/src/promptVersions.ts`); hash pinned in
`promptHashes.ts`. Cost: the system prompt grew from ~2,000 to ~2,900 tokens
and is cached, so a deck pays for it once.

Validation plan (Phase 2, real API): the 8-brief corpus on v9 versus v10,
same model, scored on the calibrated rubric. The lab's prediction is that
hook and CTA move by two points and legibility does not move at all, because
legibility is the recipe's to fix.

## The recipe lift — the exemplar re-authored by hand, $0

Rather than spend Opus on a re-author, the code's own reference recipe
(`recipes.ts`, the exemplar the author prompt teaches from and the seed of
the live kit) was rewritten to the bar: type sized for the phone (body 44,
rows 46, tagline 48, eyebrow 34), `tagline` and `quote` advertised, an
exhibit (`figures`/`figure`), and fragment variants covering the seven forms.
Composed with `--reference`, same parses, no hand fragments, rendered
through the worktree's own web server so the shared-CSS fixes below are in the
pixels: [recipe5--aftercare](sheets/recipe5--aftercare.jpg),
[recipe5--gettingpaid](sheets/recipe5--gettingpaid.jpg).

| dimension | shipped aftercare (owner) | ceiling, old recipe | ceiling, upgraded recipe |
|---|---|---|---|
| fidelity | 2 | 4 | 4 |
| hook | 1 | 4 | 4 |
| specificity | 2 | 3 | 3 |
| variety | 2 | 3 | **4** |
| hierarchy | 1 | 3 | **4** |
| brand | 2 | 4 | 4 |
| legibility | 1 | 2 | **3** |
| cta | 1 | 4 | 4 |

Legibility stops at 3 for one reason: the product screenshot is still the
whole dashboard in a card (finding 9, a crop/zoom on slot photos). Specificity
stops at 3 because the brief carries no reasons under its rows — an upstream
(CRM payload) limit, not the app's.

**Dev-server note.** The dev servers on :3000/:4000 run from the PRIMARY
checkout, not this worktree; a shared-CSS fix is invisible in a render until
the worktree's web server is used (`preview_start web` → port 58757,
`WEB_URL=http://localhost:58757` for the lab). Two runs were photographed in
the wrong CSS before this was noticed.

Findings the run raised, all in the app rather than the recipe:

11. **The pattern cap silently discards everything.** `composition.patterns`
    was capped at 12 with `.catch([])`: the 14-pattern exemplar parsed with
    ZERO patterns, every role fell back to "all patterns", art direction
    thought there was nothing to choose, and the drop ladder lost its map.
    Fixed: cap 24 (`MAX_PATTERNS`). An author writing a 13th pattern used to
    lose all of them without a word.
12. **`stat` claimed the `statement:` patterns.** Role matching was a bare
    string prefix. Fixed with a word boundary.
13. **A lab deck rendered in the wrong CSS.** The render route draws a project
    against the kit's LIVE recipe unless the project carries `recipeSnapshot`;
    the lab now pins the recipe it composed with, exactly as a shipped deck does.
14. **The surface layer painted over the inverse ground.** `[data-surface]`
    and `.inverse` have equal specificity, so a raised+inverse slide rendered
    as a half-lit gradient. Fixed: the surface rules yield to `.inverse`.
15. **The synchronous gap filler adds holes to every VARIANT.** A one-liner
    variant that deliberately omits body and tagline is given both, so it can
    never be one line once the copy has a body. The measured filler already
    skips arrays for this reason; the sync one did not.
16. **Removing a hole leaves its wrapper.** `{{body}}` inside a `.card` is
    removed with its `.body`, and an empty `<div class="card"></div>` ships —
    the bordered box under the headline on both one-liner slides. Wrappers
    emptied by a hole removal are now pruned.
17. **The exhibit is for figures.** With word labels ("Commission") the
    112px cells break; the copywriter must only reach for it with numbers, and
    the art director should never pin it otherwise.

## Attached to the live kits (owner-approved, 2026-09-13)

Both upgraded reference recipes were attached to the live kits with
`scripts/attachReferenceRecipe.ts --write`; the recipes they replaced are in
`storage/recipe-backups/*-before-reference.json`. Decks already exported keep
their pinned `recipeSnapshot`. Rendered against the live kits, no hand
fragments, no model: [live--aftercare](sheets/live--aftercare.jpg),
[live--dynatos](sheets/live--dynatos.jpg) — every slide substituted from a
fragment; Dynatós gains the list, stat, card and exhibit vocabulary it never
had. One thing to check on Dynatós: the `.logo` wordmark renders blank on the
cover and the close, so the seeded kit's logo asset needs confirming.
