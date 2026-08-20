# ContentBuilder — findings from real runs

A running log written by agent sessions that use ContentBuilder to build real
posts (see `~/.claude/skills/instagram/SKILL.md`, step 9). Every run appends at
least three findings.

**Why this file exists.** The session driving ContentBuilder sees the whole path
— the idea going in, the authored HTML coming back, the slot behaviour, the
export — and then ends. The user sees a zip of PNGs. Everything learned in
between is lost unless it lands here.

**The value is in recurrence.** One clipped CTA is a model hiccup. The same
clipped CTA in four runs is a length cap that needs raising. So:

- **Do not create a duplicate entry.** If a run hits something already logged,
  add a dated line under that entry's **Seen again** list.
- Entries stay until they're fixed, then move to [Resolved](#resolved).

---

## How to add an entry

Append under [Open findings](#open-findings), newest first. Keep the shape:

```markdown
### <short title>

- **Kind:** Defect | Friction | Gap
- **Severity:** blocked shipping | cost me a fix | minor
- **First seen:** YYYY-MM-DD — <post slug or project title>
- **What happened:** the concrete evidence. Slide number, the actual string,
  the byte size, the endpoint. Not a paraphrase.
- **Why it matters:** what it costs this post, or the next one.
- **Direction:** a suggestion, not a spec.
- **Seen again:**
  - YYYY-MM-DD — <slug> — <what was different, if anything>
```

Rules that keep this file worth reading:

- **Concrete over general.** "Slide 6's CTA rendered `Book your slot befo`"
  beats "text gets cut off".
- **Count your interventions.** Every `PATCH` or `tweak` you had to make is a
  place the tool didn't land it first time. Say how many.
- **Don't inflate severity.** An honest `minor` is more useful than a
  manufactured `blocked shipping`.
- **Prefer failures that will repeat** over one-off model noise.
- Judge the pixels, not the file sizes. Open the PNGs.

---

## Open findings

*Nothing open.* Every finding in this file has been resolved — see below, newest first.

Add the next one here, following the shape in [How to add an entry](#how-to-add-an-entry).

## Resolved

### The gap filler adds a hole without ever asking whether it still fits

- **Kind:** Defect
- **Severity:** cost me a fix
- **First seen:** 2026-08-20 — traced from the Dynatós overflows
- **What happened:** `fillRecipeFragmentGaps` adds a hole for every part a role
  allows and re-validates the STRUCTURE — sanitises, known classes, placeholder
  convention — and stops there. A fragment can validate perfectly and still
  overflow the moment a copywriter fills what it was handed. It gave Dynatós'
  `list` a tagline and a body on top of its panel, and gave `statement` a photo
  slot that overflows against that brand's own display headline. Both were the
  faults I could not fix by tightening the type scale.
- **Why it matters:** the same filler runs for every brand on every read, and a
  role's part list is a guess about density that nothing checked.
- **Fixed:** `fillRecipeFragmentGapsMeasured` — each candidate hole is added,
  filled with the longest copy its part is allowed, and rendered. One that
  overflows is reverted and recorded in `fragmentOmits`, because the sync filler
  is idempotent by design and would add it straight back on the next read. Run
  against Dynatós' fragments as its author wrote them, it declines exactly the
  holes that caused the bugs:

  ```
  KEPT     statement: body, handle
  DECLINED statement: photo slot   (measured at 0 rows)
  DECLINED list: body              (measured at 4 rows)
  DECLINED list: tagline           (measured at 4 rows)
  DECLINED list: handle            (measured at 4 rows)
  ```

- **The distinction it took a real brand to find:** measuring only at the
  maximum load conflates two different faults. Dynatós' `list` does not fit
  **five** rows even as its author wrote it — nothing added — so every candidate
  hole would have measured as "overflows" and been blamed for an overflow it had
  no part in. The filler now finds the largest row count the fragment carries
  EMPTY (5 → 2) and judges holes at that load; a fragment that fits at none is
  reported as over capacity and keeps its holes, because nothing there is
  attributable to a hole.
- **Two bugs found by disbelieving the output:** every rowless role first read
  as over capacity, because rows were being handed to fragments with no repeated
  unit and `substituteFragment` rightly refused to lose that copy. Then they
  read as over capacity again, because a rowless fragment legitimately measures
  at a load of **zero** rows and `if (!load)` treats that as "found nothing".
  The `bare <role> fits` line I had printed alongside is what made both visible.
- **Note for stored recipes:** the filler decides holes it would ADD, so a
  recipe already carrying them keeps them. Dynatós is covered by the tightening
  in #92; a future brand gets the measurement instead.

### The copy budgets lived where only one of their two users could reach them

- **Kind:** Friction
- **Severity:** minor
- **First seen:** 2026-08-20 — writing the measured filler's worst case
- **What happened:** `BASE_BUDGETS` and `EXPLAIN_ROLES` were defined in
  `compose.ts`, which imports `fragments.ts` — so the filler could not import
  them back without a cycle, and its worst-case copy was eyeballed instead. A
  worst case that had drifted from what compose actually permits would decline
  holes that fit and keep holes that do not.
- **Fixed:** both moved to `packages/shared/src/copyBudgets.ts`, one definition
  for both users. The worst-case strings sit at their budget limits (within a
  word) and the test asserts that against the budgets themselves rather than
  against numbers copied into the test.


### The Dynatós overflow was the legibility floor, not the display type

- **Kind:** Defect
- **Severity:** cost me a fix
- **First seen:** 2026-08-20 — after the Dynatós re-author
- **What happened:** a loaded `list` slide overflowed by 63px on 4:5 and 112px
  on 1:1, and all three stress fixtures overflowed. Measuring element by element
  said the display type was not the cause: the panel was **722px of a 1154px
  usable frame**, because the brand authored its rows at **32px/24px** and they
  render at **41px/34px** — `enforceTypeFloor` raises anything under 15pt. Same
  for the eyebrow (28→34), body (34→44) and handle (26→34). So the sizes that
  overflow are the ones held UP by the floor, and lowering the authored value
  changes nothing; the floor puts it back on the next paint.
- **Why it matters:** the obvious fix — shrink the type — is the one that cannot
  work, and it took a per-element measurement to see that.
- **Fixed:** `npm run recipe:tighten` — 19 documented edits against spacing
  calibrated for type that is now bigger than it was written for, plus the
  display sizes the floor does not govern (headline 114→108, headline.sm 82→78,
  stat 204→196). The 1:1 override needed its own pass: it is the shortest canvas
  (928px usable vs 1154) and authors rows smaller still, so the same floored
  rows have 226px less to sit in.

  | | before | after |
  |---|---|---|
  | stress fixture, all three formats | overflows | **clean** |
  | `list` loaded, 4:5 and 1:1 | OVERFLOW | **clean** |
  | `feature` loaded + photo, 1:1 | OVERFLOW | **clean** |
  | `statement` + photo, all three | OVERFLOW | OVERFLOW *(unchanged)* |
  | `cover` + photo, 9:16 | COLLIDE | COLLIDE *(unchanged)* |
  | `stat` slack, 4:5 | 51% | 53% *(worse)* |
  | `feature` slack, 4:5, no photo | 52% | 55% *(worse)* |

- **The honest cost:** tightening a slide that already fitted only opens a hole,
  so slack got ~2.5pp worse on the two roles that were already over the 50%
  limit before any of this. Worth it — an overflow clips content, slack is a gap
  the ladder's grow rung can close — but it is a trade, not a free win. A first
  pass cut the display type twice as hard (114→104, 204→178) and made slack
  worse still for no extra overflow benefit, which is why the final numbers are
  gentle.
- **Still open, and not a type-scale problem:** `statement` overflows on every
  format once it carries a picture, and 9:16 `cover` collides. Both predate the
  tightening. `statement`'s cause is the photo slot `fillRecipeFragmentGaps`
  ADDED to it competing with a 3-line 108px headline — the gap filler adds a
  hole whenever the role allows one and never measures whether the result still
  fits. Compose's ladder repairs both at deck time; the recipe should not need
  it to.

### `ROLE_PARTS` can over-stuff a fragment, and nothing measures the result

- **Kind:** Gap
- **Severity:** minor
- **First seen:** 2026-08-20 — Dynatós `list`
- **What happened:** `fillRecipeFragmentGaps` gave `list` holes for `tagline`,
  `body` and `handle` on top of the eyebrow, headline and 4-row panel the author
  wrote. Each hole is conditional, so a rows-only list slide is fine — but a
  copywriter who fills all of them gets a slide no canvas can hold at floored
  type. The filler re-validates STRUCTURE through `checkFragment` and never
  measures the result.
- **Why it matters:** the same filler runs for every brand, and a role's part
  list is a guess about density that nothing checks.
- **Direction:** either drop `tagline` from `list`'s parts (a list's rows ARE
  its content, so a tagline competing with them is redundant), or have the
  filler measure the fully-loaded fragment and stop adding holes once it stops
  fitting. The second is the real fix and needs a renderer where there is not
  one today.


### `authorRecipe`'s regression check was unreachable code

- **Kind:** Defect
- **Severity:** cost me a fix
- **First seen:** 2026-08-20 — before re-authoring the Dynatós recipe
- **What happened:** `authorRecipe` takes a `previous` — the recipe this one is
  replacing — so it can notice a re-author that returns fewer role fragments
  than what it replaces. **No caller ever passed one.** Both places that
  re-author a kit (`POST /brandkits/:id/recipe` and the candidates flow) called
  it without. So the REGRESSION warning could not fire even in the case it was
  written for, which is exactly how detailmasters lost `statement` in silence —
  and the carry-forward added in #90 had the same dependency, so it would have
  been dead on arrival too.
- **Why it matters:** two guards against the same class of loss, both
  unreachable, and the loss they guard against had already happened once.
- **Fixed:** both call sites pass the kit's current recipe; for candidates,
  every candidate replaces the same standing recipe so each is held to it. The
  regression test asserts the wiring rather than the logic — it fails on the
  previous commit and passes on this one.

### Dynatós had no fragments at all, and its type scale overflows a loaded slide

- **Kind:** Gap
- **Severity:** minor
- **First seen:** 2026-08-20 — Dynatós Program re-author
- **What happened:** Dynatós' live recipe (2026-07-01) predated fragments
  entirely — 0 of 7 roles — so every slide it composed cost a model call, and
  there was nothing to carry forward. Re-authored on the production path with
  `previous` wired: **7/7 fragments**, 13 components. Every fragment renders
  clean with typical copy (slack 14.1%–52.4%). Loaded with every part its role
  allows, `list` **overflows** — and `checkRecipeLayout`'s all-nine-elements
  stress fixture overflows too. **The recipe it replaced overflows the same
  fixture**, so the type scale is a pre-existing property of this brand, not
  something the re-author introduced. The render-verify pass looked at real
  samples and returned `good`; its fixtures are lighter than the stress one.
- **Why it matters:** a deck built on it still ships — compose's ladder repairs
  an overflow — but it starts from a failing layout, so every such deck spends
  repair rungs it should not need.
- **Direction:** the type scale wants tightening for this brand specifically;
  no floor caps a MAXIMUM size, only minimums. Worth doing when Dynatós is next
  posted rather than speculatively.
- **Verified:** the corpus gate is clean against the new recipe — 86 slides, 0
  overflowing or colliding, 0 over the slack limit — so no existing Dynatós
  slide was broken by the swap.


### Every corpus-gate run since the first one was still resident, holding a Chrome

- **Kind:** Defect
- **Severity:** cost me a fix
- **First seen:** 2026-08-20 — waiting on `layout:corpus --gate` and finding it
  had "already been running" for a day
- **What happened:** the gate printed its report and then never exited. Fifteen
  runs were still resident across old sessions — the oldest at **1 day 6 hours**
  — and between them they held **504 Puppeteer Chrome processes**. The probe's
  `close()` releases its page pool, but `getBrowser()` is memoised process-wide,
  so the launched browser keeps node's event loop alive forever. Four scripts
  open a probe (`slackDistribution`, `verifyDeck`, `measureBodyCeiling`,
  `measurePartCeilings`) and none of them called `closeBrowser()`.
- **Why it matters:** every `pgrep` for the script matched runs that finished
  long ago, so "is the gate still going?" could not be answered — and 504 idle
  Chromes is most of a laptop.
- **Fixed:** all four scripts close the browser on both the success and the
  failure path. The gate now exits on its own: **86 slides, 0 overflowing or
  colliding, 0 over the slack limit, clean against 0 known faults** — and zero
  Chromes left behind.


### The commonest role lost its fragment on a re-author, and only a warning noticed

- **Kind:** Defect
- **Severity:** cost me a fix
- **First seen:** 2026-08-20 — measuring the AI/code split across the corpus
- **What happened:** detailmasters' live recipe (kit `6a7b7882`, authored
  2026-08-11) has fragments for `cover, quote, feature, stat, list, cta` — and
  none for `statement`. The kit it replaced had all seven. `statement` is the
  commonest role in the corpus (n=18 all-time, n=10 in the recent cohort), so
  every one of those slides has paid a per-slide model call since, for an
  arrangement the brand had already written down. `authorRecipe` DID notice —
  it logs `REGRESSION: the recipe being replaced had a "statement" fragment and
  this one does not` — and stored the degraded recipe anyway. Checked against
  the live recipe's own component classes, the old fragment is **accepted**
  unchanged; nothing about it had gone stale.
- **Why it matters:** a warning that does not change the outcome is a warning
  nobody reads three weeks later. The regression was real, detected, logged,
  and shipped.
- **Fixed:** `carryForwardFragments` carries any fragment the replaced recipe
  had into the new one when `checkFragment` still accepts it, before the gap
  fill so a carried fragment is held to the same standard as an authored one.
  `npm run fragments:carry --workspace=apps/api -- --write` applies the same
  rule to kits already stored; it restored `statement` (which then gained a
  photo slot) and all four of its shapes render clean — slack 6.8%–31.9%
  against a 50% limit, no overflow, no collision.

### `list` read as 0% fragment when its fragment was working perfectly

- **Kind:** Defect
- **Severity:** minor
- **First seen:** 2026-08-20 — the first AI/code split measurement
- **What happened:** the split was inferred by matching each stored slide's
  tag/class skeleton against its role's fragment. That cannot work: repeated
  `{{#rows}}` make the slide LONGER than the fragment, absent parts make it
  SHORTER, `balanceVertical` moves the spacers of both, and a model compose that
  follows the recipe's order is byte-comparable to a fill. `list` reported 0%
  while `substituteFragment` in fact fills it cleanly in all four shapes a list
  slide comes in (full house, no body, rows without notes, no eyebrow).
- **Why it matters:** the measurement was about to be used to decide where to
  spend effort, and it pointed at a role that had no problem.
- **Fixed:** the compose path is now STORED on the slide (`authored.source`:
  `fragment` | `ai`) rather than reconstructed from markup. `npm run ai:share`
  prefers it and prints how many slides in each cohort state their path versus
  are inferred, so the number is read with the right confidence.


### Two headlines a deck out still stop mid-sentence — the rule was right

*Resolved 2026-08-19 (PR #89).* The question was whether `"Spotless car. Same smell"` is the deck's punchy style or a truncation, because the two want opposite fixes. Measured across every stored headline rather than argued:

| | |
|---|---|
| headlines | 95 |
| written as two or more sentences | 20 |
| **that close with punctuation** | **18** |
| that do not | 2 — the two flagged |

The two-fragment headline IS the house style, and its convention is to punctuate: *"Tiny habits. Unshakable discipline."*, *"Left spotless. Smelled the same by Friday."*, *"Holds the most. Ruins the fastest."* The two the check flags break a convention the corpus follows 18 times out of 20, and one of them is the same slide that read *"Holds the most. Ruins the fastest."* on an earlier compose. The rule is not over-firing; one corrective re-parse is simply not always enough, and the check reports what survives — which is the design.

**The comparison also found a false NEGATIVE the rule had been shipping.** `TERMINAL_PUNCTUATION` accepted a colon, so `"Tight beads: healthy. Flat, clinging beads:"` counted as finished — a comparison cut off before its second half. A colon promises something after it, so treating it as an ending is precisely backwards. Exactly one string in 284 ends with a colon and it is that truncation, so there was no legitimate use to protect. Removed, and the corpus now reports 5 rather than 4.

### Moving the whole check into the composition pool costs more than it buys

- **Kind:** Gap
- **Severity:** minor
- **First seen:** 2026-08-19 — attempted, measured, reverted (PR #87)
- **What was tried:** opening one probe before the composition pool and having
  each slide measure and repair itself as it was written, replacing the pass at
  the end. The intent was right — fix a fault while the copy that caused it is
  still the subject — and the enabling half of it shipped (see below).
- **What it cost, found by the tests rather than by argument:**
  - Every slide rendered **twice**, once in the pool and once in the deck pass,
    until the deck pass was made conditional — the suite caught it immediately
    as a doubled render count.
  - Overflow had to be carved out. `repairLayout` handles holes, collisions and
    over-tall headlines; a slide that does not FIT climbs `repairOverflow`,
    whose ladder can drop a block and re-compose. Handling a slide half-way in
    the pool and then skipping the deck pass loses exactly the rungs that fix
    it.
  - The bookkeeping — measured, unmeasured, overflowed, repaired, unresolved,
    notes — had to be duplicated inline, because `renderCheckDeck` owns it.
  - `checking-layout` stopped appearing as a phase, which a caller polling
    `composeProgress` can see.
- **What it bought:** no correctness gain. The same rungs run under the same
  keep-only-if-better rule; only the moment changes. Some latency, unmeasured.
- **Direction, if it is picked up again:** the honest version is not "run the
  check earlier" but "give the composer the arrangement up front so the fault
  is never written". The archetype is now decided before composition and is
  still not in the composer's prompt — telling it which composition it is
  writing into is the cheap half of this idea, and prevention beats a rung.
- **Direction taken instead (PR #88, compose v7):** the composer is now TOLD the
  arrangement — which composition, where the leftover space belongs, and how many
  lines its headline may run to — so the fault is prevented rather than repaired.
  Written onto the input rather than passed at one call site, so the overflow
  ladder's re-compose and the rewrite rung carry it too; a test caught that a
  repaired slide would otherwise come back violating the arrangement it was about
  to be laid out under.

### A vision repair can rearrange a slide but never fill one

*Resolved 2026-08-19 (PR #86).* Logged an hour earlier while building the rung that looks at a slide: it declined the first real fault it met, correctly, because two lines of type cannot be made to fill a frame by rearrangement and it is forbidden from touching the copy. The loop had been closed at the wrong end — sight was given to the step that ARRANGES while the step that WRITES stayed blind.

The verdict now goes back to the copywriter. A `tooLittle` fault the deterministic ladder cannot fix becomes a direction — *"this slide rendered with 69% of the frame empty; give it the substance it is missing, ONLY from the material this post was briefed with"* — through `parseSlideDirection`, the same helper the Studio's per-slide rewrite uses, so it inherits the budgets and the no-invention rule. The result is typeset through the ordinary composer with the render check off, so a repair cannot recurse.

Demonstrated end to end on the slide the rearrangement rung had declined: `said-more`, one repaired, the fault cleared, one extra call.

**It also produced the failure it needed a guard for.** On the first live run the copywriter returned the deck's COVER — lockup, cover headline and all — for the empty headliner slide. It measured beautifully and was the wrong slide entirely, because the harness passed no parts and "fill this slide" reads as "write a slide" when there is nothing to anchor to. So `keepsThePoint` requires the slide's headline to survive the rewrite, the rung does not run at all on a slide with no headline to anchor to, and both are tested with that exact cover-shaped output.

Ordering matters and is tested: this rung runs BEFORE the rearrangement one, because it addresses the cause rather than the symptom. Neither runs on an overflow or a collision — a slide with too much on it does not want another line.

### `POST /compose` hung three times and persisted nothing — CAUSE FOUND

*Resolved 2026-08-19 (PR #84).* Two unbounded waits, and between them they account for every detail that was recorded.

**The AI client had no timeout and no retry policy.** `new Anthropic({ apiKey })` inherits the SDK's own defaults — a **ten minute** request timeout and two retries — so one stuck call costs up to thirty minutes before anything is reported. Compose makes a parse call plus one per slide through a concurrency pool. Hangs of 16 and 45 minutes are the shape of a ten-minute timeout being retried, not of a deadlock, which is why nothing ever looked stuck when it was examined. Now 120s with 2 retries — a parse or a slide compose is a seconds-long call — while the streamed authoring path keeps a 600s allowance, because a 20–30K-token payload legitimately runs for minutes.

**A hung browser launch was cached forever.** `browserPromise` is memoised so one browser is shared, which is right — but a promise that never settles is then handed to every later caller, and the whole render path waits on it with no way back short of a restart. That is why it hung *three times* rather than once. `getBrowser` now has a 60s ceiling and clears the slot on failure, so the next caller launches again instead of queueing behind a corpse. A test covers exactly that.

**And that explains the leaked scaffolds.** `openRenderProbe` wrote the throwaway business, kit and project and only then asked for a browser, disposing them if that *threw*. A wedged launch does not throw — it never returns — so the dispose never ran. Every hung compose left exactly one `__render-check-*` business behind, which is how the trail was picked up. The browser is now acquired *first*, so there is nothing to leak while the risky wait happens.

The earlier correction still stands: the web server being down was never the cause — with :3000 stopped the probe degrades in 86ms. What was true is that everything downstream of an AI call or a browser launch had a ceiling, and those two did not.

Verified after the fix: a real compose of the seven-slide deck in 33s, `layout` fully measured, `copy` clean, and zero leaked scaffolds.

### One integration test fails only inside a full-suite run — CAUSE FOUND

*Resolved 2026-08-19 (PR #83).* `request(app)` makes supertest call `app.listen(0)` and close it again for **every request**. This file makes sixty-odd, and vitest runs it beside forty-four other files — so the suite was opening and tearing down thousands of ephemeral ports. Handing supertest a server that is already listening, and that it therefore does not own, removes the churn entirely.

Measured, six runs of the file each way, then twenty more to confirm:

| | runs that failed |
|---|---|
| an Express app per request | 5 of 6 |
| one app, still one server per request | 1 of 6 |
| **one app and one server for the file** | **0 of 6, then 0 of 10, then 0 of 4 full-suite runs** |

That is 20 consecutive clean runs including the parallel full-suite condition it only ever failed in.

**Why it looked so strange.** Every symptom was a request receiving a response that was not its own: a 404 whose content-type was `text/html` — Express's finalhandler, so no route matched — on routes that demonstrably exist, and creates returning a body with no `_id`. That is what socket churn on that scale produces, and it is why no amount of reading the routes explained it.

**What did NOT explain it, each ruled out with a reason rather than left hanging:** shared state between files (the suite has its own `MongoMemoryServer` and clears every collection per test); machine load (reproduced deliberately under a full Puppeteer corpus render, 3/3 clean); the rate limiter (its `hits` map is created inside `createApp`, so it cannot accumulate across instances).

Seven firings, seven different tests, one file, and none of them was about the test that failed.

### The review page renders a different slide from the one that exports

*Resolved 2026-08-19 (PR #80).* Phone view now renders with `editing` off, exactly as the export does, so an unfilled photo slot is hidden rather than drawn as an "Add photo" placeholder. That view exists to show the deck as a reader meets it, and it was showing a slide the reader never sees in the one respect that decides whether it looks empty.

Measured on the same slide, same moment:

| | slot | slack |
|---|---|---|
| strip view | placeholder drawn | 9.7% |
| phone view | `display: none` | **43.7%** |
| the export path (`verifyDeck`) | hidden | **44%** |

Phone view and the export now agree to within rounding, so the slack badge tells the truth there.

The strip keeps the affordance, deliberately — it is where photos are attached, and the toggle is one click away. `editing` controls exactly one thing in `AuthoredSlide` (the empty-slot CSS), so the change is that narrow.

### Removing a photo leaves a hole nothing re-checks

*Resolved 2026-08-19 (PR #79) — and the investigation corrected the finding.* The review page now shows two more badges from the measurement it was already taking: **Touching** when two elements collide, and **Looks empty** when a slide's largest empty band passes the limit for its role. Verified in the browser on a `feature` slide stripped to one line: *"A 76% band of this slide is empty — past the 50% a feature slide is allowed."* Silent on all six other slides.

The limits moved to `packages/shared/src/slackLimits.ts` so the badge and the API's gate read one definition. Two copies of a threshold is two thresholds, and the one nobody updates is the one that starts lying.

**The finding's own premise was wrong, though, and the badge does NOT catch the case that prompted it.** Removing a photo does not leave a hole on this page: the review render passes `editing`, so an unfilled slot draws the dashed "Add photo" placeholder and fills the space — measured at 9.7% slack on exactly the slide that reads 65% through the export path, where the slot is hidden. The 65% came from `verifyDeck`, which renders `/render` without `editing`.

So the two render paths genuinely differ, and the unfilled-slot case was already covered by the existing **Needs photo** badge, whose warning is the accurate one: *"it exports as a blank panel"*. The new badges cover the general case — a slide thin on content, slot or no slot — which nothing was reporting.

### The image checker cannot see an irrelevant picture, only a contradictory one

*Resolved 2026-08-19 (PR #77).* The checker now asks a second and much easier question after the first: is this photograph ABOUT its slide at all? Reported as its own `unrelated` list rather than folded into `contradictions`, because the two say different things — a contradiction says the deck is WRONG, an unrelated picture says nobody chose it. A slide already named as a contradiction is never also reported as unrelated: one question per picture, and the sharper one wins.

Verified end to end on the photo that slipped through, by putting it back:

*with the CRM screenshot on the cover*
```
"unrelated": [{ "slide": 1,
  "about": "Detailing service marketing about odour removal and spotless cars",
  "shows": "A software dashboard listing client session packages",
  "question": "Does a screenshot of a client package tracker relate to a spotless car and lingering smell?" }]
```

*with the correct interior photo restored* — `{"contradictions":[],"unrelated":[],"checked":1}`

Catches the real failure, silent on the right picture, and `contradictions` stayed empty in both runs — the precise signal is undiluted.

The bar is deliberately low, and the prompt says so: report it only when you cannot say what the picture has to do with the slide. An atmospheric or wide shot of the right subject, or one whose connection needs a sentence to explain, is explicitly not reported — the same reasoning that keeps the contradiction check narrow.

### Nothing catches copy that stops mid-sentence

*Resolved 2026-08-19 (PR #74, Copywriter v9).* A deck shipped `"Enzymes break the source. Fragrance covers"` — 41 characters against a 150 budget, so no clamp touched it and no gate looked at it. The recorded parse output confirmed the copywriter wrote it that way rather than the code cutting it.

`unfinishedProse` now joins the budget, verbatim and repeated-slide complaints in the one corrective re-parse, and it says so plainly: *finish the sentence — do not simply add a full stop to what is there*. Nothing is repaired deterministically, because the missing words are the point.

Two rules, both measured against every string in every stored deck before being trusted:

| part | rule | evidence |
|---|---|---|
| body, row note | must end with terminal punctuation | 50 of 51 bodies, 13 of 13 notes already do |
| headline, tagline, quote, row text | may be a fragment, but must not end on a dangling word | 34 of 93 headlines carry no full stop by design |
| any of them | if it contains a sentence break, it must close the last sentence | added 2026-08-19; fires once in 282 stored strings |
| eyebrow, cta, handle | never checked | they are labels — checking them produced only false alarms |

The terminal-punctuation guard on the dangling-word rule is what makes it usable: English ends sentences on particles constantly ("paid for.", "what you put in.", "it does not have to be."), and without the guard the rule fired on 12 good lines out of 13. With it, `validateProseCheck.ts` finds **2 hits in 174 shipped strings** — one real truncation and one borderline noun-phrase list.

The dangling-word list is now shared with `dropDanglers`, which asks the same question of copy the CLAMP cut. One list, one meaning.

*Extended the same day, after a recompose shipped `"Miss the ducts. The smell finds"` straight past it.* A headline may be a fragment and `finds` is a verb, so neither of the first two rules applied — but the line contains a sentence break, which makes it prose whatever part it is written into, and prose that opens a second sentence has to close it. Measured across 282 stored strings the new rule fires exactly once: on that line. It also gives the original failure a better name — `"Enzymes break the source. Fragrance covers"` does not merely lack a full stop, it abandons a sentence.

And the check was reporting nothing when it should have been shouting: it triggered a corrective re-parse and then never looked again, so a deck shipped with a body the check had already flagged. `unfinishedProse` now runs a second time after the correction, warns per line, and reaches the caller as `copy` on the compose response — the same treatment `layout` gets, and for the same reason.

### The descender floor was sized against a neighbour that had its own margin

- **Kind:** Defect
- **Severity:** cost me a fix
- **First seen:** 2026-08-19 — rebuilding the smoke-odour deck
- **What happened:** the cover collided at **3px**, headline to photo slot, with
  the floor applied and matching. 0.16em covered the ink hanging below the
  content box (~0.135em on the display serif at 104px) and left almost nothing
  over — under the gate's own 6px.
- **Why #62 missed it:** it was verified against a `.cta`, which carries
  `margin-top` in every recipe, so the floor only had to make up a difference. A
  `.cb-shot` has no margin at all, so the floor IS the whole clearance. The
  measurement was right and the case was too easy.
- **Fixed 2026-08-19 (PR #72):** 0.22em, sized for the neighbour with nothing to
  fall back on. Corpus clean at 86 slides.
- **Worth remembering:** the compose-time check passed this deck (7 measured, 0
  overflowed, no notes) because the slot was still EMPTY and reserved at default.
  The collision only appeared once a real photograph was attached — which is the
  same shape as the finding #58 closed, one level further on.

### The corpus check reserves photo slots at DEFAULT size

*Resolved 2026-08-19 (PR #71).* `resolveSlidePhotos` used to drop a photo whose asset it could not resolve, taking the slot's geometry with it — so a scaffold, which carries no media, reserved every slot at the default size and over-reported any slide whose photograph had been deliberately shrunk. It now keeps the geometry and skips only the image, which is exactly what a reserve needs: the space a picture will take, without a picture.

The scaffold writes photo records with a dangling `mediaAssetId`. That is honest rather than a trick — a scaffold really does have no media, the schema requires the field, and the resulting state is the same one a slide reaches when an asset is deleted from the library while the slide still points at it. That case now holds its space instead of collapsing, which is a small fix in its own right.

**Corpus: 0 faults of 79.** The baseline is empty.

The default is still what a reserve falls back to when a slide records no geometry, and that remains right at compose time: no photograph has been chosen yet, so assuming the full-size slot is the conservative call. The two cases genuinely differ, which is why this needed the geometry carried rather than the default changed.

### One shipped slide has 33px more content than its canvas

*Resolved 2026-08-19 — smoke-odour-removal slide 4.* Both panel notes rendered at exactly two lines (123px each), so dropping either to one freed 62px against the 33px needed. Trimmed the second note from *"Pulls back out what you put in. That decides it."* to *"Pulls back out what you put in."* — the first sentence carries the claim, the second was a flourish. The first row's note was left alone: it holds the actual insight, that a surface clean hands back clean fabric on foam that still smells.

Verified on the real render, with the real photograph: `overflow: false`, and the eyebrow now sits at **119px** against a 92px padding — inside the safe area instead of 33px above it. It was 59px before.

### Eight shipped slides sat 5px from a collision, on one missing margin

*Resolved 2026-08-19 (PR #68).* The corpus baseline's nine faults were not nine problems. Eight were the same pair — `logo-row → eyebrow` — on the same brands, and the survey of every slide's tightest ink-to-ink gap made it unmistakable: a median of **32px**, never below **14px**, except those eight at **5px**. Neither `.logo-row` nor `.eyebrow` declares any vertical margin, so they sit flush and only the eyebrow's leading separates them; every other block in those recipes carries one, and the eyebrow was simply missed. `enforceLockupGap` puts 24px under a lockup, at render like the other floors, and only on classes the recipe gave no margin of their own.

The gate's own measure was also inconsistent, and this is what exposed it: it compared the previous block's INK to the next block's BOX — lenient at one end, strict at the other. A line box sits above its glyphs by the half-leading, which is why those eight read 0px while the glyphs were 5px apart. It now measures ink to ink at both ends.

**Corpus: 9 faults → 1.**

### The corpus check only ran because someone thought to run it

- **Kind:** Gap
- **Severity:** cost me a fix
- **First seen:** 2026-08-19 — after #58 shipped a regression nothing caught
- **What happened:** four render-time floors rewrite CSS for EVERY brand, and
  reserving a photo slot changed what the gate even sees. #58 broke 9 of 79
  shipped slides — a zero-gap invisible box reported as a collision — and it
  reached `main`. It was found days later only because a corpus measurement
  happened to be run for an unrelated reason.
- **Why it matters:** the tests cover the units; nothing covered "does this
  still render the brands we already have". That is the one question a
  render-time CSS floor is most likely to get wrong.
- **Fixed 2026-08-19 (PR #67):** `npm run layout:corpus -- --gate`, with a
  checked-in baseline of the 9 already-failing slides so it fails only on NEW
  faults. Proved by reintroducing the #58 bug: the gate named the 4 new faults
  and exited 1; with the fix restored it reports clean against the baseline.

### The prompt-hash guard covers the system prompt only

*Resolved 2026-08-19 (PR #66).* `PROMPT_TEXT.parse` is now the system prompt PLUS the rule-bearing parts of the user message. Those are assembled per call and cannot be hashed as one string, so their TEMPLATES are rendered for a fixed, boring set of inputs — three formats and three slide-count shapes — which pins the wording and the numbers the builders produce without pinning the brief text that legitimately differs every call.

Found by causing it: rewriting the story budgets in #65 changed every number a story deck is held to and moved no hash at all. Two tests now assert the coverage itself, so a refactor cannot quietly narrow it back — one checks the rendered rules are present, the other that a change to them moves the digest.

Note for whoever next reads a diff here: the BASE format contributes nothing to the user message by design, so only 9:16 and 1:1 appear. Its numbers live in the static system prompt, which is what keeps the cache warm across posts.

### The story budget shrinks ~20% across the board — every part, not just body

*Resolved 2026-08-19 (PR #65, Copywriter v8).* #58 corrected `body` to post parity and left the other parts on the unmeasured 0.8, saying so at the time. Now measured, one part at a time on a slide carrying the full furniture, across every stored recipe (`src/scripts/measurePartCeilings.ts`):

| part | story budget | fits up to | post parity |
|---|---|---|---|
| eyebrow | 21 | 63 (3×) | 26 ✓ |
| headline | 48 | 72, overflows at 96 | 60 ✓ |
| cta | 19 | 57 (3×) | 24 ✓ |
| rowText | 34 | 102 (3×) | 42 ✓ |

Every part clears post parity with room over it, so the cut is **removed** rather than re-tuned. Parity and no further: the post's numbers are the measured ones, and where a budget is EDITORIAL rather than a fit limit — an eyebrow is "a label, not a summary", a row is "scanned, not read" — the same rule should hold on both canvases. Those two fit at 3× their budget on a POST as well and are still not raised, for that reason.

The square keeps its 0.9: it is genuinely a shorter canvas than the 4:5, so that reasoning survived where the story's did not.

Method note: on the post, every part overflowed at 1.25× — the full-furniture fixture is saturated there, so those numbers measure the slide's total capacity rather than each part's own ceiling. The story half is the informative one.

### The collision gate reads the one number the problem cannot move

*Resolved 2026-08-19 (PR #64).* See the correction above: box-to-box is invariant under padding, so the gate was blind to descender collisions by construction. It now measures ink-to-box.

### Reserving a photo slot reported a collision on slides where nothing overlaps

*Resolved 2026-08-19 (PR #64) — a regression from #58, caught by the corpus check.* Reserving an empty slot (`visibility:hidden`) put a zero-gap box between the logo row and the eyebrow on every slide with an unfilled slot: **9 of 79 shipped slides** reported a collision with nothing overlapping, because an invisible box was being counted as painted. A reserved slot still counts for overflow — reserving it is the whole point — and for slack, since a picture will fill it. It cannot collide: there is no ink in it.

### Leaked `__render-check-*` scaffolds accumulate in the database

*Resolved 2026-08-19 (PR #63).* The sweep existed and nothing ran it. Its logic moved to `lib/sweepScaffolds.ts` and the API sweeps on start, beside the existing `failInterruptedVideoJobs()` — same reasoning, one line down: a scaffold is disposed in a `finally` the process never reaches if a compose wedges, so anything still there at start-up is orphaned by definition. The script stays as the way to look without restarting anything.

### Neither precondition for composing is visible on `GET /businesses/:id`

*Resolved 2026-08-19 (PR #63).* Half of it was already fixed — `hasRecipe` has been on the response for a while. The photo precondition was not, so the response now carries `photoCount`. Reading it the obvious way came within one step of escalating "this brand has no photos" about a brand with 76.

### The CRM payload's `caption` is a string; the API wants `{text, hashtags}`

*Resolved 2026-08-19 — CarDetailScheduler PR #298, the caller's side as the correction said.* `content-instagram.mts` now emits `caption: {text, hashtags}`, keeping `hashtags` at the top level too because that is where the house rule lives. The same change refuses a brief with no beats and no verified claims: a payload carrying only a headline, a reader and a CTA composes into a deck of hooks with nothing under them, which happened twice and both times read as a compose problem rather than an empty brief.

### An image can still contradict its slide, and the checker only catches some of it

*Resolved 2026-08-19 (PR #63).* The state case is now worked through the WORD rather than by impression, as the direction suggested: quote the state adjective the copy uses ("tight", "flat", "clinging", "sheeting"), name its opposite, then ask the photo only that narrow question — and report nothing when the picture is ambiguous or shows neither. A slide whose copy asserts no state in words has no state mismatch to find, and the checker is told not to infer one.

### Descenders collide with the block below

*Resolved 2026-08-19 (PR #62).* Detection already existed — `MIN_CLEARANCE` measures the gap between painted boxes precisely because a descender paints outside its own — but catching it only ever produced a hand-fix. `enforceDescenderClearance` is the floor that stops it happening, applied at RENDER beside the type, measure and story-reserve floors, so every brand already in the database is corrected on the next paint.

Measured in **em**, not px, so the clearance scales with the type that draws it: the failures were all the display serif at its largest. Scoped to the adjacency the failures had — a headline immediately followed by a CTA, a photo slot or a panel — because a headline followed by prose is already cleared by normal leading, and widening every headline's bottom would change the vertical rhythm of every brand. A brand that already reserves more is never shrunk.

Verified by render on the exact shape that shipped broken (`Quer um guia para começar?` over the gold chip): `padding-bottom: 16.64px` on a 104px headline, gap 24px. Without it the gap is ~7px — above `MIN_CLEARANCE` of 6, so the gate passed the slide while the ink overlapped, which is the finding exactly.

My first verification fixture was wrong and said so loudly: I put the `.fill` spacer BETWEEN the headline and the CTA, so they were never adjacent, the rule correctly did not match, and the measured gap was 668px. The arrangement that collides is bottom-anchored — spacer above, headline and chip adjacent.

Still open in a different form: the second sighting (a cover's image box clipping descenders) is a bleed/scrim case, not a sibling one, and this floor does not address it.

### No per-slide view of the source sentence a slide came from

*Resolved 2026-08-19 (PR #61).* No threading was needed in the end — the project already stores `plan`, one direction per slide, and a plan FIXES the deck at one slide per entry in order, so `plan[i]` IS this slide's brief. The review page shows it under each card. Shown only when the post was composed against a plan: a free-form idea has no beat to quote, and inventing one would be worse than saying nothing.

### No phone-size scroll view on the review page

*Resolved 2026-08-19 (PR #61).* A "Phone view" toggle stacks the deck as a vertical column at 393px — the CSS width of a typical handset — using the `ScaledSlide` component that already renders at arbitrary width. The strip's arrows and edge fades go with the strip; a stacked deck scrolls with the page, the way a reader moves through a post. Verified in the browser by measurement rather than by eye: column direction, slides at exactly 393×491, all eight beats present.

### The review page names half the typography

*Resolved — filed late, 2026-08-19.* Already fixed, in both places: the recipe panel renders `displayFamily · bodyFamily` and the token strip lists Display and Body as separate rows, with a comment quoting this finding. The entry stayed open only because nobody closed it — the fourth stale entry found in this sweep.

### Two stored recipes overflow and collide at every copy length

*Resolved 2026-08-19 (PR #60).* Two corrections to the finding first. The sample was **contaminated**: two of the six "recipes" were leaked `__render-check-*` scaffolds, which COPY the recipe they measure — so they read as extra brands with identical geometry, and every run of the measuring script created more. Both scripts now exclude them. And the collision half was already fixed by the story reserve in #58; only the post overflow remained.

Re-measured clean, the two failures are both **Dynatós Program** (two versions of one brand), whose 112px headline is the largest of the six and cannot carry the full element stack on a 4:5 canvas. Worth stating plainly: the fixture is a deliberate worst case — every element the brand advertises at once — and a real slide following the "one supporting element per slide" rule would not reach it.

The durable fix is the direction's own: the gate now runs in the AUTHORING path. `checkRecipeLayout` measures a stress slide through the same deterministic gate compose uses — no vision call, no cost — and a recipe that fails its own layout is reported at the moment it is authored rather than on the first deck built from it. It is gated on the same switch compose uses and carries a ceiling, because the failure it guards against is a probe that never answers, and a `try/catch` does nothing about a hang.

### Recipe-author v6's elevation rule did not bite

*Resolved 2026-08-19 (PR #60, recipe-author v6).* Rewritten to name a mechanism instead of a principle, exactly as the glow rule does: the brand declares `--cb-elev` once and `.cb-shot`, `.panel` and `.cta` each reference it. `elevationReport` reads the result, so the authoring path now says "elevation stated 3 times, not once" and names the surfaces that raise themselves their own way. A rule that cannot be checked reads as fixed in the version registry while the output is unchanged.

### A re-authored recipe silently lost a fragment

*Resolved 2026-08-19 (PR #60).* Authoring reports coverage role by role — `5/7 reference fragment(s): cover, feature, … — no fragment for statement, cta, those roles cost a model call per slide` — and `authorRecipe` takes the recipe it is replacing, so a re-author that drops a role it used to have logs a REGRESSION line naming it.

### With :3000 down, every layout gate silently returns `unknown`

*Resolved 2026-08-19 (PR #59).* `renderCheckDeck` now reports `unmeasured`, compose hands the whole summary to its caller through `onLayoutCheck`, and `POST /compose` returns it as `layout` on the response. A deck that shipped with every gate silent is now visibly different from one that passed them, to the caller rather than to whoever is reading the server's terminal.

### Compose reports no progress, so slow is indistinguishable from stuck

*Resolved 2026-08-19 (PR #59).* Compose emits a phase as it enters each one — `parsing`, `composing` (with a per-slide `done`/`total`), `checking-layout`, `done` — and the route persists it to `project.composeProgress`, so any caller polling `GET /projects/:id` can tell 1-of-9 from 8-of-9. Written with `updateOne` rather than `save()`, because it writes while the document is being built around it. Deliberately NOT converted to a job-and-poll endpoint like the video exporter: that would change every existing caller, and the crumb trail solves the stated problem without touching the Studio. The trail is left behind on a throw — the phase a compose died in is the most useful thing about a compose that did not finish.

### A bottom-anchored photo slot runs off the frame when the copy grows

*Resolved 2026-08-19 (PR #58).* An empty slot took `hiddenSlotCss` (`display:none`), and a layout measurement has no photos attached — so every deck was gated as if its pictures did not exist. Proved on the shape that shipped broken: the same feature slide measures `overflow: false` with the slot removed and `overflow: true` with it reserved, its 459px shot landing at 1305px against a 1254px content bottom. The probe now renders with `reserveSlots=1`, and `reservedSlotCss` uses `visibility:hidden` so the box keeps its geometry and paints nothing.

### Authored story slides ignore STORY_UI_RESERVE

*Resolved 2026-08-19 (PR #58).* `safeAreaFor('story')` reserved 250px top and bottom, but only for render chrome — an authored slide's safe area was whatever `.cb-slide` padding the recipe's own story stylesheet set, and nothing stopped a brand from setting 88px and putting its headline under Instagram's header. `enforceStoryReserve` now raises a story's top/bottom padding to the reserve at RENDER, beside the type and measure floors, so every brand already in the database is corrected on the next paint with no re-authoring. A recipe that reserves more is left alone, its horizontal padding is never touched, and a value it cannot parse is left exactly as authored rather than guessed at. The exemplar's own 210/240 was under-reserved and is now 250/250.

### The story budget shrinks ~20% across the board, but a story fits MORE copy

*Resolved 2026-08-19 (PR #58).* Re-measured after the reserve above (which tightens the story canvas, so the earlier reading was stale): a story still holds more prose than a post — the tightest sound recipe carrying the full furniture overflows at 175 characters on a story against 146 on a post. The `body` and `explainBody` budgets are now held at post parity on a story instead of taking the 0.8 cut; they are not raised past it, because the post's numbers are the measured ones. The eyebrow, headline, CTA and row text keep the 0.8 — they compete for the same vertical band the reserve takes and none of them has been measured yet.

Side effect worth recording: raising the story padding also fixed the story-format collisions on the two broken recipes, which now measure clean on 9:16 at every copy length. They still fail on a post — see the open finding.

### The slack gate never fires, so nothing catches a slide that reads empty

*Resolved 2026-08-18 (PR #57).* Two bugs, one in the measurement and one in the threshold.

**The measurement.** `AuthoredSlide` excluded spacers from the painted-box list with an `offsetHeight > 0` test, on the reasoning that a spacer has no box. But `.fill` is `flex: 1 1 auto` — a spacer doing its job is exactly the one with a *large* height. The void was counted as content. Probed directly: a slide holding two lines of type over **897px of nothing** (66% of the frame) published `slack: 0.0459`, because the only gaps left to find were the 62px between its eyebrow and its headline. The zero-height test excluded a spacer only when it had grown to nothing — the one case with no slack in it. Spacers are now excluded by CLASS.

**The threshold.** `MAX_SLACK` was 0.15, calibrated against the broken reading. With the measurement fixed, 68 of 79 shipped slides exceeded it. `src/scripts/slackDistribution.ts` renders every stored slide and reports the spread, which separates cleanly by role:

| role | n | min | median | max |
|---|---|---|---|---|
| cover | 7 | 51.3% | 52.7% | 59.6% |
| cta | 7 | 13.8% | 30.2% | 50.4% |
| feature | 12 | 8.7% | 39.2% | **65.5%** |
| statement | 15 | 9.0% | 23.3% | 44.9% |
| list | 5 | 13.3% | 20.5% | 35.5% |
| stat | 3 | 13.5% | 36.9% | 44.0% |

A cover is a headline over space — that IS the form, and not one cover sits below 51%. So display roles (cover, cta, quote) are allowed 0.65 and content roles (feature, statement, list, stat) 0.50; an unknown role gets the permissive limit, because a gate that cries wolf gets ignored. On the shipped sample the gate now fires on **exactly 2 of 79** slides — the two `feature` slides that had to be hand-authored into panels because they carried nothing.

### The 90-character body budget makes an explanatory deck impossible

*Resolved 2026-08-18 (PR #56, Copywriter v7).* `body` is now per-role as well as per-format: a `statement` or `feature` slide — the roles where a deck makes its argument — gets **150** characters (120 on a story), every other role keeps 90, and the allowance is withdrawn when a tagline shares the slide.

The number is measured, not chosen. `src/scripts/measureBodyCeiling.ts` renders one slide per body length through the production probe across every stored recipe: on a post, eyebrow + headline + body fits **278** characters on every sound recipe, while the shape that breaks is the one also carrying a tagline, CTA and handle, where the tightest recipe fits 118 and overflows at 146. A `shorter body` lesson pulls the allowance down proportionally.

Raising the budget also exposed a second bug in `clampSentences`: its "don't leave a stub" floor was `max * 0.35`, which scales the wrong way. At a 90-char budget a 35-character first sentence cleared the floor and was kept; at 150 the same sentence failed it, so the clamp threw a finished sentence away and cut mid-clause instead. The floor is now the LOWER of 32 characters and `max * 0.35`.

### A slide's headline is emitted twice, once as a stray leading node

*Resolved 2026-08-18 (PR #55).* `dedupeBlocks` refused to drop any headline — correctly, since a headline must never lose to a body and no copy may be lost. It now makes one narrow exception: two blocks carrying the SAME voice class with character-identical text, where whichever goes the line still appears exactly once. Different text is still never touched.

### The `stat` role filled its stat and its headline with the same sentence

*Resolved 2026-08-18 (PR #55).* Parse ranks the holes (headline > stat > body > tagline > quote) and drops the lower one when two resolve to the same string.

### The composer echoed the headline in the eyebrow

*Resolved 2026-08-18 (PR #55).* An eyebrow that is a substring of its own headline, either direction, is dropped at parse.

### Slide roles are assigned without checking the copy can fill them

*Resolved 2026-08-18 (PR #55).* A `stat` slide whose stat hole never filled composes as `feature` or `statement`. The matching `list`-with-no-rows fallback already existed.

### The layout engine stacks; it does not compose

*Resolved — filed late, 2026-08-18.* The archetype work shipped in #40 and is wired into compose (`assignArchetypes`), so slack is placed by the chosen composition rather than wherever a spacer landed. The entry stayed open only because nobody closed it.


### Compose returned 8 slides for `slideCount: 6`

*Resolved 2026-08-18 (PR #52).* `countGuidance` read the PLAN length even when `fixed` came from an explicit `slideCount`, so a caller with no plan was told "SLIDES: exactly 0". The guidance now names the requested count, and a hard count is trimmed to after parsing.

### Compose put a light photo behind the dark CTA slide, splitting it in half

*Resolved 2026-08-18 (PR #52).* A bleed photo is now measured against the recipe's own `ground` token and dropped when its tone cannot be rescued by the scrim — judged per brand, so a light brand rejects the dark photo.


### Seven near-identical dark frames, with no beat

*Resolved 2026-08-11.* `surfaces.inverse` already existed as a per-slide opt-in
the composer almost never took — and a composer looking at one slide has no way
to judge a deck's rhythm anyway. `planInversion` chooses it where the whole
sequence is visible.

One per deck, deliberately: two inversions in seven frames stop reading as a
beat and start reading as an alternating pattern.

Three exclusions, each concrete. Never the cover — it earns the swipe and is the
frame most likely to carry a recognisable photograph. Never the closing slide —
the CTA lands harder returning TO the brand's own ground than sitting on the
exception. Never a full-bleed slide — an inverted surface under a photograph
that covers the frame changes nothing except the type it has to fight.

Never overrides a surface the composer chose itself, and no-ops entirely when
the brand authored no inverse.

### Every photo was an inset postcard

*Resolved 2026-08-11.* Two halves, #17 and #18.

**Full-bleed.** An archetype now declares how its photograph meets the frame:
`slot` (the bounded card the composer leaves a hole for) or `bleed` (the
full-frame background layer). `showcase` and `cta` bleed; `split` keeps the
card, because there the band IS the composition. Barely any new rendering — the
background layer and its scrim already existed, so this is a placement decision
rather than a new way to draw.

**The type goes on the dark end.** A full-bleed slide lays cream type over a
picture the app did not choose. A scrim heavy enough to rescue type over a
bright sky ruins the photograph; one gentle enough to respect the photograph
loses the type. So `bleedAnchor` picks the quiet end instead of darkening the
loud one — mean sRGB luminance of the top third against the bottom third, on a
160px thumbnail, and the type and the scrim move together to whichever end is
already dark.

Luminance rather than a vision call: free, deterministic, single-digit
milliseconds, and it answers the only question being asked. A model would cost a
call per photo to be less predictable about "which end is darker".

Two deliberate refusals. It declines when the ends are within 8% — flipping a
composition on a 2% difference would make the layout jitter between renders of
near-identical photographs. And it never throws: a picture that will not decode
falls back to the archetype's default rather than failing a compose.

Worth recording: writing the test taught me the weighting matters. Pure blue and
pure green are identical to a flat channel average and 0.07 against 0.72 to the
eye, which is exactly why a naive mean would call a blue sky the quiet end.

### An unfilled photo slot painted a box into the export

*Resolved 2026-08-11.* The "Add photo" label was already suppressed outside the
editor, so this looked handled. It was not: a slot paints its own BOX
independently of its label — the base tint from `slideMediaCss` plus whatever
`.cb-shot::after` treatment the brand authored — and both render whether or not
a photograph filled it.

A cover whose picture was placed as a `background` rather than into its `hero`
slot therefore exported as a translucent rectangle sitting across the middle of
the photograph behind it. Visible in the PNG zip and in the video, since both
drive the same `/render` route.

`hiddenSlotCss` removes an unfilled slot outright outside the editor.
`display:none` rather than transparency, because the slot also reserves vertical
space it has no business reserving once nothing is going into it — a picture
that was never supplied should cost the layout nothing.

**Made much more likely by the archetype work.** Adding photo holes to `cover`,
`statement` and `feature` multiplied the number of slots a deck carries, and so
the number that can end up unfilled. The guard existed; the surface it had to
cover grew.

### A third of every slide's width went unused

*Resolved 2026-08-11.* The recipe capped `.body` at `max-width: 26ch`. On a
1080px canvas with 88px gutters that is 593px of a 904px measure — copy wrapped
at about 31 characters and the right third of every slide sat empty. Typographic
guidance puts a comfortable measure at 45–75 characters; the review that raised
it asked for 45–60.

Fixed with `enforceMeasureFloor`, a sibling of `enforceTypeFloor` and for the
same reason: applied at render, it repairs every brand already in the database
on the next paint, with no re-authoring and no AI spend, and it keeps holding if
a future recipe drifts narrow again.

A FLOOR, not a value — a brand that authored a generous measure keeps it. And
display copy is excluded: a `.tagline` or `.headline` held to a narrow column is
a legitimate choice, and widening it would be overruling the brand on something
it got right. Only continuous prose is floored.

Verified: slide 3's body went from five lines to four and now reaches within
~70px of the right margin instead of stopping 310px short.

### The copywriter's internal reasoning rendered onto a slide

*Resolved 2026-08-11.* Two guards at `cleanFragment`, the one chokepoint every
model reply passes through.

`readsAsReasoning` rejects a reply whose visible text is first-person
meta-commentary about the task. The signal is narrow on purpose — slide copy is
written to a reader about their world; it never refers to "the copy parts",
never says "I need to". A false positive throws away a legitimate compose, so
the markers are phrases that would be wrong even if a human wrote them. Tested
against the exact text that shipped, and against seven real slide lines that
must survive.

`firstSlideBody` cuts a reply that emitted the slide twice down to its first
frame, before the wrapper is stripped — after that the two bodies are
indistinguishable from one long one.

A rejected reply returns `''`, which is the existing signal for "unusable": the
caller retries, and failing that the deck ships that slide empty. Better a
missing slide someone notices than a shipped one nobody reads.

### Widows and bad line breaks

*Resolved 2026-08-11, on the second attempt. The first made it worse.*

**What was tried first, and why it was wrong.** Glue the words that must not
separate with non-breaking spaces, let the browser choose from what is left. It
shipped, and the next review caught it immediately: gluing chains into long
unbreakable runs means a run that does not fit jumps WHOLE to the next line and
leaves the previous one short. *"Tight beads: healthy."* became **"Tight"
alone on its own line**, because `beads:_healthy.` was a 15-character atom that
would not sit beside it. Slides that had used the full measure started wrapping
at ~75%.

The reason is structural rather than a tuning problem: the binder runs with no
knowledge of the rendered line width, so every glue is a guess that can cost
more width than the bad break it prevents. No threshold fixes that.

**What is right.** `text-wrap: pretty` — the browser does it at layout, knowing
the measure. It fills each line to the available width and only reflows the last
few to avoid orphans, which is exactly the trade the hand-rolled version got
backwards. Emitted in the app-owned layer after the brand sheet, so it reaches
every stored slide with no migration.

Not `balance`: it equalises line lengths, which deliberately does not use the
full measure — the wrong instrument for copy already complained about for
wrapping short.

Verified: slide 5's line 1 went from "Tight" to "Tight beads:", slide 7 from
four lines to three, and slide 4's orphaned "paint" is gone.

### Three elevation treatments on one deck, and a glow in the same corner every time

*Addressed 2026-08-11, in the recipe author rather than the app.*

A real deck carried a photo frame with a drop shadow, a list panel with a 1px
hairline and a flat, hard-cornered button — three answers to "what does a raised
surface look like?" on the same seven slides. Its background glow sat at exactly
`72% 0%` on every frame, clipped at the same corner, which reads as a rendering
artifact rather than as art.

Both are brand-authored CSS, so both are fixed where brands are authored:
recipe-author **v6** now requires one radius scale and one elevation model
across `.cb-shot`, `.panel` and `.cta`, and asks for the glow's position to be
authored through custom properties with defaults so it can vary down a deck.

**This does not retouch existing recipes**, deliberately. Rewriting a stored
brand's stylesheet by regex to unify its corners would be a worse failure than
the inconsistency it fixed. detailmasters' recipe still has all three
treatments; re-authoring it is a brand decision with a cost, and the version
registry now says exactly what a re-author would buy.

### Nothing responded to a layout gate

*Resolved 2026-08-11.* `repairLayout`, a bidirectional ladder.

The overflow ladder only ever SHRANK, because overflow only ever means too much
content. Two of the gates do not fit that shape. A collision is too much content
that happens not to have left the frame — a headline resting on the CTA chip
passes the overflow check because nothing overflowed — so it climbs the same
rungs. Excess slack is the opposite, and shrinking makes it worse, so that
direction grows: `removeHeadlineVariant`, the inverse of rung one.

Growing is the risky direction and is therefore the conservative one: exactly
one step, kept only if the result neither overflows nor collides AND actually
reduces the slack. A slide that cannot be grown safely keeps its hole and says
so. Climbing until something breaks would trade a visible fault for an invisible
one, which is a worse deck and a harder bug.

A shrink is kept only when it reduces the fault COUNT — a smaller headline that
closes a collision but opens a hole has traded one gate failure for another, so
it is discarded.

The renderer also reports `headlineLines` now, derived from the rendered box
against its own line-height rather than by counting words, so the per-archetype
cap is measured on the type that actually shipped. Costs nothing: the probe was
already rendering the slide.

Free throughout — no rung spends a model call.

### Leftover space was orphaned wherever it fell

*Partly resolved 2026-08-11.* Archetypes. A slide now carries an `archetype`
alongside its `role` — role is what it SAYS, archetype is how it is COMPOSED —
and the archetype owns where the slack lands: `top` (bottom-anchored, the
brands' own default), `bottom`, `center`, or `between`.

The mechanism is app-owned CSS emitted after the brand sheet, keyed off
`data-archetype` on the slide root. The load-bearing line is the `> .fill`
reset: brands bottom-anchor with a flex-grow spacer and the composer scatters
more per slide, so leaving them live means the archetype and the markup fight
over the same space and the markup wins.

`assignArchetypes` picks across the WHOLE deck, deterministically and with no
model call. Two rules: a photo archetype is only reachable when a picture
actually exists, and no composition may run more than twice.

Building it surfaced a hole worth recording. The first set had only one
text-only composition, so a deck with no photographs collapsed every role onto
it and the run rule had nothing to alternate with — which is precisely the deck
that prompted the review. `banner` (text, bottom-anchored) exists so there are
always two text compositions to alternate between.

Verified on the real deck: six distinct compositions across seven slides, and
the ~430px hole between a headline and its list is gone — that slide's slack
now sits deliberately at the bottom.

**Since resolved:** `repairLayout` responds to the gates — see below.

### Layout faults were invisible at review scale

*Resolved 2026-08-11.* Two additions, both cheap.

**Measurement.** `AuthoredSlide` now reports two verdicts beside `overflow`,
from the same layout-space pass: `collide` (any two painted boxes closer than
6px — measured as a gap rather than as ink, because a descender paints outside
its line box and that is exactly how a headline ended up on a CTA chip with the
overflow guard reporting "fits"), and `slack` (the largest contiguous empty
band as a fraction of frame height, counting the runs above the first box and
below the last). `renderCheck` reads both; `MAX_SLACK` is 0.15.

**A contact sheet in every export.** `buildContactSheet` composes the deck three
to a row at 350px — roughly feed scale — and the export zip carries it as
`contact-sheet.png`. Every fault in the review that was not a collision was
invisible in the studio's thumbnail strip and obvious in the sheet, including
the ~430px hole and the deck's monotony. Never fatal: a montage that fails to
compose must not cost someone their export.

What remains is the response to those verdicts — the engine still ships a
flagged slide rather than repairing it — and the engine change itself.

### The `.cb-shot` gradient made a dark carousel cover unreadable in a promo story

*Resolved 2026-08-11.* Added an app-owned `cb-plate` class: `slideMediaCss`
emits `.cb-slide .cb-shot.cb-plate.cb-plate::after{display:none}` — doubled to
(0,4,1) so it outranks anything a brand writes — plus a hairline and a drop
shadow so the picture reads as a card. `promo-story` marks its slot with it.
Verified: the cover is fully legible in the export.

### Only one role in a recipe could hold a photograph

*Resolved 2026-08-11.* `ensurePhotoHole` in `fragments.ts`, run from
`fillRecipeFragmentGaps` (which already executes on read inside
`composeProject`). It gives `cover`, `statement` and `feature` a
`<figure class="cb-shot" data-cb-slot="hero">` when they lack one — placed
before the brand's sign-off line, which is where this brand's own `feature`
fragment puts it. Not `quote`, `stat`, `list` or `cta`: rows and a picture
never share a slide, and the others are the line or the number alone. The
repair re-validates through `checkFragment` and is discarded whole if it fails.
Verified: the next composed cover came back with a real slot, auto-filled from
the pool.

### `promo-story`'s rendered cover entered the brand photo pool

*Resolved 2026-08-11.* `brandPhotoPool` now excludes `label: PROMO_COVER_LABEL`.
The asset is still in the library and still swappable by hand — it just is not
offered as brand imagery, because a picture of one post is not illustration for
another.

### `promo-story` repeated the carousel's headline under the cover

*Resolved 2026-08-11.* The endpoint defaulted `headline` to the carousel title,
printing the same sentence twice — once inside the cover it is showing, once
underneath in the largest type on the frame. It now omits the headline unless a
caller passes one as a hook.

### The copywriter embellished a brief instead of compressing it

*Resolved 2026-08-11, at both ends.* The CRM payload now sends each section's
actual sentences in the beats (a composer given sentences compresses; one given
titles invents — the three drifted slides all came from bare headings), and the
copywriter prompt (v5) makes the no-invented-claims rule unconditional: it
applied only to SOURCE docs before, and this flow passes an idea, so it never
fired. Ordered lists now keep their order.

### Composing an imageless deck required no decision

*Resolved 2026-08-11.* Compose 400s on an empty brand pool unless
`textOnly: true` acknowledges the choice, and the pool drops images under
800px (the "2 photos from your website" were 640px site chrome). The gate runs
before the recipe check, so its error is the one a user can act on in place.

### The keyword and the caption lived in different places

*Resolved 2026-08-11.* `settings.dmKeyword` is the one source; the caption
endpoint appends the DM line deterministically when the draft lacks it.
`settings.audience` picks the voice register, threads a hard reader instruction
into compose, and shows on the review page. `createProject` accepts the
payload's caption + hashtags so they arrive as editable drafts.

### Composed body copy was clipped mid-sentence, with no terminator

*Improved 2026-08-11, watching.* The clipped CTA came from the same root as the
drift: a bare heading and a hard cap. With substance-bearing beats and the v5
prompt the copy arrives shorter by construction; the cap still exists, so this
stays here until a few more runs show clean endings.

Original finding:

- **Kind:** Defect
- **Severity:** cost me a fix
- **First seen:** 2026-08-11 — `raise-average-ticket-add-ons`, slide 8 (`cta`)
- **What happened:** the final slide's body came back as
  `Envie-nos uma mensagem com a palavra EXTRAS e recebe tudo o que precisa para
  testar esta` — 89 chars, ending on "esta" with no noun and no full stop. The
  cap truncated rather than asking for shorter copy. Same slide also mixed
  registers (formal `Envie-nos` then informal `recebe`), which suggests the
  sentence was assembled rather than written whole.
- **Why it matters:** it is the CTA — the one slide with a job. A truncated
  sentence there reads as a broken post, and it is the slide a reader is
  looking at when deciding whether to DM.
- **Direction:** if a part exceeds the cap, re-ask for that part at a stated
  length rather than truncating; failing that, truncate to the last sentence
  boundary so the output is always grammatical.
- **Seen again:**
  - *(add dated lines here)*

### Row notes, taglines and bodies were not bound by the faithfulness rule

*Resolved 2026-08-11.* Copywriter v6. The v5 rule held for headlines but not the
small print: a correct, correctly-ordered list carried three plausible-but-
unsourced explanations under it, one asserting a ranking ("fastest") the source
does not make. Plausible domain knowledge is the invention hardest to spot,
because it does not read as invented. An unexplained item now renders bare, and
ranking words the brief does not use are never asserted.

### The caption and the final slide disagreed about the primary action

*Resolved 2026-08-11.* The slide made "find a detailer — link in bio" primary
with the DM secondary; the caption mentioned only the DM, because the two were
generated independently. The caption's closing is now built from the final
slide's cta chip, inserted above the DM line so the primary action stays
primary.

### The review page showed the base voice while an audience override was in force

*Resolved 2026-08-11.* With an audience set, the Voice row now reads
"Addressing a car owner — overrides the recipe's base register (…)" instead of
displaying the studio-owner paragraph as though it were current. The page no
longer contradicts its own audience chip.

### Nothing compared a slide's picture against its copy

*Resolved 2026-08-11.* `POST /projects/:id/image-copy-check` renders each
illustrated slide's photo and copy to a vision call, together with the whole
deck's text so a cross-slide conflict is visible, and returns questions for the
review page. Advisory, never blocking — deliberate irony is legitimate and a
check that refuses it gets switched off. Partial: see the open finding on state
mismatches.

### The promo story called a model for a frame with no creative decision in it

*Resolved 2026-08-11.* The frame is an eyebrow, a button label and a picture of
the cover — nothing to decide. It is now authored directly from the brand's own
classes, in the order its `cta` fragment uses them, with no model call: faster,
free, and incapable of the reasoning leak that made the previous build
unshippable. `composedBy` reports `authored`.

