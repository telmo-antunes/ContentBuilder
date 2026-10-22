# The designer that sees

*Design note, 2026-10-22, at Telmo's ask: "a complete rework … I want that app
delivering high quality and professional assets." Decided with him the same
day: posts and stories only (reels stay hand-built for now), the app stays
generic, and the engine becomes a designer that looks at the whole deck.*

## Why the old engine's ceiling is where it is

The September audit fixed what was broken and left the architecture standing:
a copywriter writes the deck, a cheap model (or a fragment substitution) sets
each slide alone, and some forty deterministic repairs keep the result from
failing. That bought reliability when credits were scarce. It also fixed the
ceiling, for three reasons that no gate can move:

1. **Nothing in the loop sees the deck.** Every slide is composed blind, one at
   a time, in a skeleton chosen by role and position. The one vision pass fires
   on two slides and may only reorder blocks. Variety, hierarchy and the
   sequence — the three dimensions the rubric scores lowest — are deck-level
   qualities, and the only deck-level step (the critique) is advisory.
2. **The look is fixed per brand, not per deck.** A recipe is the right idea
   (one design system, authored once), but every deck inherits the same six
   skeletons; "variants" are re-skins of them. The reference accounts compose
   each slide for what it says.
3. **Compose cheap, gate hard.** A Haiku cannot be trusted with taste, so taste
   was moved into code. Code cannot have taste either; it can only stop the
   worst outcomes.

The October exports show it: slides 2–5 of both decks are the same stack
(eyebrow, serif line, two lines of body, a small mock card), on the same
ground.

## What changes

**One strong call designs the whole deck, then looks at it.**

```
brief ──copywriter (unchanged)──▶ deck copy, verbatim parts, roles
      ──DESIGN (design tier, sees the recipe + every slide + the photo pool)──▶
        every slide's markup, the pictures it chose, a small per-deck stylesheet
      ──render ──▶ contact sheet at feed scale
      ──REVIEW (vision, scores the rubric's eight dimensions, names the faults)──▶
      ──REVISE once, if the review says so and the budget allows ──▶ keep the better deck
```

- **The copywriter stays.** Its prompt is owner-calibrated and its output scores
  4s. Its checks stay too (cover gate, one ask, finished prose, budgets).
- **The designer replaces the per-slide composer, the art director, the design
  pass and the vision repair.** It reads the brand's stylesheet and worked
  fragments as *examples of the house style*, the full deck's copy, and the
  library's tagged pictures; it writes every slide, assigns the pictures, and
  may write a **deck stylesheet**: a few rules scoped to `.cb-slide`, using the
  brand's `--cb-*` tokens, for devices this deck needs that the recipe does
  not define (a two-column compare, a number exhibit, a verdict row). New
  classes are prefixed `dk-` so they can never shadow the brand's own.
- **The gates stay, as signals rather than silent rewrites.** The sanitisers
  (HTML, CSS) run on everything. The verbatim guard is mechanical: a slide
  that lost or invented copy is not shipped — it falls back to the classic
  composer for that slide and the fallback is noted. The type floor, contrast
  repair and story reserve still apply at render. The render probe measures
  overflow, collision and slack and hands the numbers to the review.
- **The review scores, and the second round is earned.** The contact sheet
  goes to a vision call with the owner's rubric; it returns the eight scores
  and ranked findings. A deck with a blocking finding, or a slide the probe
  says overflows or collides, gets one revision — the designer sees the
  sheet, the findings and its own previous output, and revises rather than
  restarts. A low score alone does not earn one: on the first live runs a
  revision triggered by a 2 on variety lost to round one as often as it won,
  at $0.20 a time, so the budget goes to decks with a named fault. The
  better of the two decks (by rubric total, verbatim-clean only) is what
  ships. Scores land on the project where the manual scorer already lives.

**Cost.** Design ≈ $0.30–0.40 (Opus 5, ~14k in / ~8k out), review ≈ $0.05,
revision ≈ $0.30 (cached prefix). Worst case under $0.90 a deck; the per-post
ceiling moves from $0.40 to $1.50. The classic engine remains selectable from
Settings (`composeEngine`) and is the automatic fallback when no design-tier
model is configured.

**Stories** go through the same path with `STORY_UI_RESERVE` in the brief to
the designer; the derived promo story is untouched except that its labels
follow the deck's language.

## What it is not

- Not a per-brand product. Nothing in the designer knows detailmasters; the
  real-UI kit idea (the CRM's screens as components) was explicitly deferred.
- Not a free canvas. The designer writes the brand's classes plus a small,
  sanitised, token-only stylesheet. It cannot load fonts, images or URLs, and
  it cannot write copy.
- Not a replacement for the human. The review page keeps every Studio tool;
  the app now arrives with a scored deck instead of a measured one.

## Files

| | |
|---|---|
| `lib/htmlDirector/designDeck.ts` | the designer: prompt, tool schema, validation, fallbacks |
| `lib/htmlDirector/reviewDeck.ts` | the review: rubric scoring, keep-best, the revision brief |
| `lib/htmlDirector/deckCss.ts` | the deck stylesheet contract and its checks |
| `routes/projects.ts` | `POST /:id/compose` runs the designer path by default |
| `models/Project.ts`, `shared/types.ts` | `deckCss`, `authored.source: 'designer'`, the new progress phases |
| `web/lib/render/AuthoredSlide.tsx` | injects the deck stylesheet after the brand's |
| `routes/settings.ts`, `web/app/settings` | `designModel`, `reviewModel`, `composeEngine` |
