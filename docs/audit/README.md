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
