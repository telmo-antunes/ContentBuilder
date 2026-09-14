# ContentBuilder quality audit — the report

*2026-09-13 → 2026-09-14. Branch `claude/platform-audit-optimization-a8673d`.
API spend: ≈ $4.20 of the $10 cap. Everything else was done with Claude as
the model under test and the real pipeline around the answers.*

## The one-paragraph version

The output was "shitty" for three structural reasons, none of them the
model: every deck was stamped from one skeleton per role; the copywriter ran
on a weaker tier than the mechanical arrange step and was told what not to
do with no example of what good looks like; and the brand's own photographs
never reached a full-bleed slide because the pool was spent in upload order
and the first six were pale screenshots. Against the owner's own rubric the
two shipped decks scored 2 · 1 · 2 · 2 · 1 · 2 · 1 · 1 and
3 · 3 · 2 · 2 · 1 · 3 · 2 · 2. After the audit, seven briefs the copywriter
had never seen as examples score a mean of 4 · 4 · 3 · 3 · 3.4 · 4 · 3 · 3.7
at $0.19–0.23 a deck, with 85% of slides composed for free.

## Before and after

| | shipped aftercare (owner's score) | the same brief, after ([sheet](sheets/p2--aftercare--run3.jpg)) |
|---|---|---|
| fidelity · hook · specificity · variety | 2 · 1 · 2 · 2 | 4 · 4 · 3 · 4 |
| hierarchy · brand · legibility · cta | 1 · 2 · 1 · 1 | 4 · 4 · 3 · 4 |
| cost | $0.21 | $0.22 |

Sheets for every run are in [sheets/](sheets/), scores in [scores/](scores/).

## What changed, by layer

**Recipes (the biggest lever).** Both reference recipes were rewritten to the
owner's bar — the seven slide forms the reference accounts share (one-liner,
number, exhibit, numbered poster, product proof, picture-owns-the-frame,
the close as an arrival), phone-sized type, two or three arrangements per
role — and attached to the live kits at $0.

**Prompts.** Copywriter v10→v11: job → what good looks like → a worked deck →
the contract; objects are short, prose briefs still change pace, lines
close. Recipe author v7 teaches the seven forms. Art direction and the
critique judge against the one-second bar.

**Pipeline (all deterministic).** Full-bleed slides get a picture that suits
the ground; slots take a screenshot or a photograph by the slide's own
words; slot photos zoom; lists centre; centred slides centre their button;
a headline is never clamped; rows are verbatim-guarded on the AI path; a
verdict list is never numbered; the exhibit takes only numbers; substitution
tries every arrangement before paying; a second cover is a statement; a
paragraph is never an object; the probe measures width; statements are
display roles for slack; art-direction pins are honoured only when the
fragment can carry the slide.

**Models.** Tested on four briefs: Opus 5 as copywriter gained nothing at
1–3× the parse cost; Sonnet 5 wrote more generically; Haiku 4.5 arranges the
few slides fragments cannot carry for a cent. Verdict applied: Sonnet 4.6
writes, Haiku arranges. The Settings page now shows the copywriter's tier.

**UI.** Twelve findings, five fixed in place ([03-ux.md](03-ux.md)).

## Instruments that stay in the repo

`scripts/autopsy.ts` (a deck's decisions next to its pixels), `scripts/exportCorpus.ts`
+ `eval/corpus/` (every brief ever composed, frozen), `eval/dump.ts` (the
exact prompts, no call), `scripts/composeFromParse.ts` (the lab bench: a
hand-written, replayed or live parse through the production path to a saved,
photographed deck), `scripts/attachReferenceRecipe.ts` (the $0 re-author),
`docs/audit/rubric.md` (the owner-calibrated scorecard).

## What remains, in priority order

1. **Upstream wording.** The CRM's facts list arrives in developer language
   ("Stripe PaymentIntent"); the no-rewording rule carries it onto slides.
   Hand over facts in the reader's words.
2. **The media library.** The pool has no foam, seat or headliner
   photograph; those slides get the bench still life. Upload the pictures;
   the pipeline now asks for the right kind.
3. **Composer title** derived from the brief; **critique chips** shortened
   to a gist; a **lab stage** for bench decks; the phone chrome.
4. **Open UI items** 8–12 in 03-ux.md, none user-blocking.
5. A **paid re-validation of the whole corpus** once the media library has
   the missing photographs — ≈ $1.60 — to put a number on legibility's move
   past 3.

## The documents

- [00-baseline.md](00-baseline.md) — how bad, and why
- [01-references.md](01-references.md) — the bar, from the owner's twenty accounts
- [01-prompt-lab.md](01-prompt-lab.md) — the ceiling, the diagnosis, the rewrites
- [02-engine.md](02-engine.md) — the live runs, the tiering, the backlog
- [03-ux.md](03-ux.md) — the walkthrough
- [rubric.md](rubric.md), [scores/calibration.md](scores/calibration.md)

## Follow-ups shipped after the audit (2026-09-15)

Sixteen of the twenty suggestions that followed the report, on branch
`claude/audit-followups`. What each is and where it lives:

| # | what | where |
|---|---|---|
| 1 | Four constructed exhibits — step chevron, two-column compare, number ledger, checklist — as list variants on both recipes, chosen only when the rows suit | `recipes.ts`, `variantSuitsRows` in `compose.ts` |
| 2 | No photo → type: a slide whose picture the tagged library lacks is composed as a one-liner or exhibit, and the owner is told which picture was missing | `photoFor` in `compose.ts`, `poolPhotoFinder` in `photoPool.ts` |
| 3 | The media pool is tagged once by vision (kind, subjects, tone, caption); attachment is by meaning when tagged | `lib/mediaTags.ts`, `npm run media:tag` |
| 4 | The critique is shown one or two reference strips from `inspo/` that share the deck's forms | `lib/inspo.ts`, `deckCritique.ts`, `scripts/critiqueLive.ts` |
| 5 | A second worked example in the Dynatós register in the copywriter prompt (parse v12) | `PARSE_SYSTEM` |
| 6 | The cover gate: a title on the cover, or a cover past ten words, goes back to the copywriter; survivors are copy faults | `coverHookFaults` in `compose.ts` |
| 7 | Glossary: system word → the reader's word, edited on the business page, fed to the copywriter | `GlossaryCard.tsx`, `glossaryBlock` |
| 8 | Corpus gate in CI: the frozen briefs replayed at $0 against a baseline | `scripts/corpusGate.ts`, `.github/workflows/ci.yml` |
| 9 | Deck scores in the Studio, stored with the prompt versions (`GET /projects/scores/all`) | review page, `Project.scores` |
| 11 | "Why this slide looks like this" — the decision trace per slide | `lib/autopsy.ts`, `GET /projects/:id/autopsy` |
| 12 | The compose wait reads the server's phase back | `WorkingPanel` `live`, `projects/new` |
| 13 | Series: a saved brief template + slide plan a post starts from | `Business.series`, `SeriesCard.tsx`, composer picker |
| 14 | Stories are derived on first export, not composed | `derivePromoStory` in `routes/projects.ts` |
| 15 | Caption checks (keyword, close, limits) and the first comment beside the deck | review page |
| 16 | Instagram insights: link a post, read reach/saves/shares/likes/comments | `lib/instagram.ts`, Settings, the Studio's performance tile |
| 18 | The form kit: any list/statement/feature form the author leaves out is added in the brand's own classes | `htmlDirector/formKit.ts` |

Also fixed on the way: the web app's own `.panel`/`.card`/`.badge`/`.row`/
`.chip` rules leaked into rendered slides (a light box under light text on
every Dynatós list), the fragment-variant cap of 4 silently dropped a whole
fragments block, and a note under a figure was flagged as unfinished prose.
Not done, by decision: 10 (monthly spend ceiling), 17 (publish from the
Studio), 19 (agent-first API), 20 (multi-tenant).
