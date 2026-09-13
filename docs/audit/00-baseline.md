# 00 — Baseline: how bad, and why

*Phase 0 of the quality audit. Written 2026-09-13 from the seven decks stored
in the database, their autopsies, and one $0.05 lab replay.*

## What was looked at

| deck | brand | what it is | sheet |
|---|---|---|---|
| Getting paid before you touch the car | detailmasters CRM | shipped carousel, 8 slides, $0.22, composed 2026-09-13 | [shipped--getting-paid](sheets/shipped--getting-paid.jpg) |
| The message to send after a ceramic coating | detailmasters CRM | shipped carousel, 8 slides, $0.21, composed 2026-08-27 | [shipped--aftercare](sheets/shipped--aftercare.jpg) |
| (the same brief, replayed) | detailmasters CRM | the stored parse re-run through the production path with **no hand edits** | [lab--aftercare-replay](sheets/lab--aftercare-replay-no-hand-edits.jpg) |
| Discipline when motivation runs out | Dynatós Program | seeded demo carousel, 6 slides, hand-authored | [seeded--dynatos](sheets/seeded--dynatos-discipline.jpg) |
| Recovery beats grit · Discipline is a daily vote · two promo stories | both | seeded / derived; no compose record | `audit-out/` only |

Autopsies (per-slide path, archetype, surface, guards, faults, critique) are in
`audit-out/<projectId>.md`; regenerate with `npx tsx apps/api/src/scripts/autopsy.ts <id>`.
Rubric scores for the two shipped decks are in [scores/](scores/).

## Scores (Claude, pending the owner's calibration pass)

| dimension | getting-paid | aftercare |
|---|---|---|
| message fidelity | 3 | 4 |
| hook | 2 | 2 |
| specificity | 3 | 4 |
| **variety** | **2** | **2** |
| hierarchy | 3 | 3 |
| brand loyalty | 3 | 3 |
| feed legibility | 4 | 4 |
| CTA clarity | 3 | 4 |

The copy is competent and mostly faithful. What makes the decks read as
"shitty" is not the words: it is that every frame is the same frame. Variety
and hook are the two lowest scores on both decks, and the Opus critique stored
on each project says the same thing independently ("eight slides, one layout").

## The important correction: the shipped decks are not what the pipeline made

Every photograph on both shipped decks was attached **by hand** by the agent
that drove the compose (the autopsy marks 15 of 16 slides "hand-edited since").
The lab replay of the aftercare brief — same stored parse, same recipe, same
photo pool, production path, nothing touched afterwards — came out with
**zero pictures on eight slides**. That sheet is the true baseline of the
product's own output.

## Causes, in the pixels, ranked

1. **Every full-bleed photo is dropped for tone, so covers never get their picture.**
   The `showcase` cover and the `cta` close are `bleed` archetypes: the pool hands
   them a background photo and `suitsBleedOver` rejects it when its mean luminance
   sits more than 0.42 above the brand ground. The detailmasters ground is
   near-black, and the pool is spent **in upload order** (`fillSlotsFromPool`
   takes `pool[next++]`), so the first candidates are light UI screenshots and
   both are rejected — on both shipped decks and on the replay, the same note on
   slides 1 and 8. Nothing then looks further down the pool for a photograph that
   would pass. Measured on the live pool (ground `#0D0D0F`, luminance 0.05, so a
   photo must average ≤ 0.47): **12 of 24 photos pass**, but the first six in
   pool order average 0.79–0.98, so the deck never reaches the dark car
   photography that would carry a cover. (`apps/api/src/lib/photoPool.ts`,
   `apps/api/src/lib/bleedAnchor.ts`)

2. **Six of eight slides are stamped from one skeleton per role.** The stored
   detailmasters recipe carries one fragment per role, so `statement`,
   `feature` and `list` slides are layout-identical across the deck and across
   decks. The variant rotation exists but has nothing to rotate. The two slides
   that DO reach the model (cover, cta) do so only because the fragments lack a
   `{{tagline}}` hole — a gap, not a design decision.

3. **The two slides the model composes are the two that matter, and they get
   the arrange-only prompt with no example of a good cover.** The cover on both
   decks is the post title set as a headline, with the real hook demoted to a
   tagline in body type.

4. **The 60-character headline clamp cuts real headlines mid-phrase.** Both
   shipped covers left the parse as "Getting paid before you touch" and "A quiet
   week is not a marketing"; the critique flagged both as blocking, and a human
   fixed them. The clamp reports nothing when it cuts on a word boundary.

5. **Lists have one treatment.** Three of eight aftercare slides are the same
   bordered panel; the recipe has no numbered, big-index or split vocabulary,
   and the deck critique names slides 3 and 5 as "the same slide twice".

6. **The surface rhythm is invisible at feed scale.** `planSurfaces` alternates
   base / raised / deep, but the detailmasters `groundAlt` sits so close to
   `ground` that the sheet shows no change. The one lever that was built to
   fix "seven identical black frames" cannot move on this brand's tokens.

7. **The watermark is in the same corner on every frame**, which the critique
   reads as a rendering artefact rather than a signature.

## Engine state, as found (so nobody rediscovers it)

- **Model tiers.** Settings pin `composeModel` → `claude-sonnet-5`,
  `recipeModel` → `claude-opus-5`, `visionModel`/`captionModel` → `claude-sonnet-5`.
  `parse` has **no** override and falls to env `ANTHROPIC_MODEL_FREE = claude-sonnet-4-6`.
  So the copywriter — the call the README calls the most quality-determining
  in the product — runs one tier below the mechanical arrange step.
- **Cost.** $0.21–0.22 per shipped deck against a $0.40 ceiling, 20+ calls;
  the design pass on `list` is refused by the ceiling on most decks.
- **Usage dashboard double-counts** vision and caption calls: both go through
  `aiMessage` (which meters) and then call `recordUsage` again. The per-post
  ledger is unaffected.
- **Two prompt-version registries disagree** (`apps/api/src/lib/promptVersion.ts`
  is stale and only feeds eval reports).
- **Media hygiene.** 57 of 93 detailmasters media records have no file on disk
  (`npm run media:orphans` exists and has not been run).

## Instruments built in this phase

| tool | what it does | cost |
|---|---|---|
| `apps/api/src/scripts/autopsy.ts <projectId>` | per-slide decision trace + contact sheet of a stored deck | $0 |
| `apps/api/src/scripts/exportCorpus.ts` | freezes every distinct brief the app was ever asked to compose into `apps/api/src/eval/corpus/` (10 briefs from 25 generations) | $0 |
| `apps/api/src/eval/dump.ts` | writes the exact copywriter and composer requests for every corpus brief and golden fixture (30 units) | $0 |
| `apps/api/src/scripts/composeFromParse.ts` | the lab bench: a hand-written or replayed parse → the production path → saved project → contact sheet; `--no-model`, `--no-fragments`, `--fragments`, `--compose-model`, `--ceiling` | $0 with fragments; cents otherwise |
| `composeFromInputs`, `buildParseRequest`, `finishParsedDeck`, `useFragments` | the compose module split so the above run the real code, not a copy | — |
| `apps/api/src/lib/photoPool.ts` | pool + attachment logic lifted out of the route, shared with the lab | — |

## What Phase 1 starts from

The ceiling test comes first: write the ideal parse for the aftercare and
getting-paid briefs by hand, stamp them through the same fragments, and see
whether the result clears a 4 on variety and hook. If it does not — and cause
2 says it will not — the recipe, not the prompt, is the first thing to change.
