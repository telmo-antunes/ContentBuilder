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

### The slack gate never fires, so nothing catches a slide that reads empty

- **Kind:** Gap
- **Severity:** cost me a fix
- **First seen:** 2026-08-18 — measured while sizing the body budget above
- **What happened:** `measureBodyCeiling` rendered the same slide with bodies from
  58 to 278 characters across six recipes and two formats — 96 renders. `slack`
  exceeded `MAX_SLACK` (0.15) **not once**, at any length, in any recipe. A slide
  whose entire body is 58 characters measures as having no hole in it.
- **Why it matters:** "some of the slides are still looking a bit empty" is the
  single most repeated piece of feedback on this tool, and the gate that exists
  to catch exactly that is silent. Raising the body budget gives the composer
  room to say more; it does not make it notice when it hasn't.
- **Direction:** find out what `slack` actually measures before changing the
  threshold — a largest-contiguous-empty-band that never exceeds 15% on a slide
  with three elements on it suggests the band is being computed over the wrong
  box (a full-bleed ground, or a flex container that stretched to fit), not that
  0.15 is too high. Worth measuring an obviously-empty slide by hand first.

### The story budget shrinks ~20% across the board, but a story fits MORE copy

- **Kind:** Defect
- **Severity:** minor
- **First seen:** 2026-08-18 — measured while sizing the body budget above
- **What happened:** `composeBudgetsFor` scales every budget by 0.8 for
  1080×1920, on the stated reasoning that Instagram overlays its UI so "the safe
  area is tighter than a post". Measured, the opposite holds for body copy: with
  the full furniture, the tightest recipe overflows at 146 on a **post** and only
  at 175 on a **story**, and three recipes that overflow at 278 on a post fit it
  on a story.
- **Why it matters:** stories are getting ~20% less copy than a post on a canvas
  that holds more of it, which is the same thinness complaint in a second place.
- **Direction:** the UI reserve is a band at the top and bottom, not a global
  squeeze — the story's own `STORY_UI_RESERVE` already models it that way. A
  vertical reserve costs a fixed number of pixels, so it should shorten the
  headline (which competes for the same vertical band) far more than the body.
  Measure per part before touching the scale; only `body` has numbers so far.

### Two stored recipes overflow and collide at every copy length

- **Kind:** Defect
- **Severity:** minor
- **First seen:** 2026-08-18 — measured while sizing the body budget above
- **What happened:** of six stored recipes, two report `collide` at **every** body
  length from 58 to 278 characters in both formats, and overflow at 58 characters
  on a post with the full furniture — i.e. they fail on copy far shorter than any
  budget allows. The other four behave sensibly.
- **Why it matters:** any deck built on those two brands starts from a failing
  layout, so the repair ladder runs on every slide and the gate's verdict carries
  no information about the copy.
- **Direction:** identify which two (the script prints them in order; give it a
  `--names` flag) and check whether `verifyRecipe` ever passed them. If a
  re-authored recipe can ship in a state that fails its own layout gate at any
  copy length, the gate belongs in the authoring path, not only at compose time.

### A bottom-anchored photo slot runs off the frame when the copy grows

- **Kind:** Defect
- **Severity:** cost me a fix
- **First seen:** 2026-08-12 — prepaid-packages-cash-flow v2
- **What happened:** slides 5 and 7 place `.cb-shot` after the copy, so the
  picture is pushed down by whatever precedes it. With a full eyebrow +
  two-line headline + body + rule above it, the screenshot was **cut off by the
  bottom edge** at `size: lg`, `md` and `sm` alike — shrinking it did not help,
  because the overflow is in the stack above, not the image. I moved the shot to
  slide 3, the slide with the least copy, and dropped it from both.
- **Why it matters:** a half-visible screenshot is worse than none, and it is
  the one thing on a product-demo slide the reader is meant to look at. The
  overflow gate measures the composition, so it should be seeing this.
- **Direction:** worth checking whether an unfilled-then-filled slot is measured
  at its real height — an empty `.cb-shot` is `display:none`, so a slide that
  measured clean while the slot was empty can overflow once a photo lands in it,
  and nothing re-measures after the photo is attached.
- **Seen again:**
  - 2026-08-18 — smoke-odour-removal — slide 4 overflowed with headline + panel + body + photo; dropping the trailing body line was what made the picture fit.

### `POST /compose` hung three times and persisted nothing — cause still unknown

- **Kind:** Defect
- **Severity:** blocked shipping
- **First seen:** 2026-08-12 — prepaid-packages-cash-flow (project `6a7ca0a0ce67414a73772ca4`)
- **What happened:** three compose runs against a 6-slide carousel produced
  **zero** slides. Run 1 died at undici's 300s header timeout; runs 2 and 3 held
  the connection open for **45** and **16** minutes with no response body, and
  `GET /projects/:id` reported `slides: 0, stage: idea` throughout. Restarting
  the API changed nothing. A fourth run, started immediately after bringing
  `apps/web` up on :3000, completed in **under 30 seconds**.
- **Correction — the obvious explanation is wrong.** I first logged this as "the
  render check hangs when the web server is down", because run 4 followed
  starting it. Driving `openRenderProbe` directly with :3000 stopped disproves
  that: it **degrades in 86ms**, returning `unknown` verdicts and logging
  `[render-check] could not measure a slide — is the web server running?
  net::ERR_CONNECTION_REFUSED`. Probe open took 773ms. So an unreachable web
  server cannot account for a 45-minute stall, and anyone fixing `page.goto`
  timeouts would be fixing the wrong thing. **The real cause is not yet known.**
- **What is solid:** each wedged run leaked a `__render-check-*` business —
  there are now four in `GET /businesses` (`72d2211c`, `b58a75e7`, `dd957152`,
  `37a3c7ae`). `createRenderScaffold` creates business + kit + project up front
  and only `dispose()` removes them, so a run that never reaches `close()`
  leaves all three behind permanently. That is real litter and a reliable
  fingerprint of a wedged compose.
- **Why it matters:** the tool's single entry point can stall indefinitely with
  no error, no partial save and nothing in the response. It cost roughly 80
  minutes and three runs' worth of API spend.
- **Direction:** make the failure legible before chasing the cause — persist
  each slide as it is authored instead of saving once at the end, put a
  wall-clock ceiling on the whole compose that surfaces as an error, and dispose
  the scaffold in a `finally` so a wedged run stops leaving litter. The leaked
  businesses then become the diagnostic: whichever stage the deck stops at is
  where it hung.

### With :3000 down, every layout gate silently returns `unknown`

- **Kind:** Gap
- **Severity:** cost me a fix
- **First seen:** 2026-08-12 — measured while investigating the hang above
- **What happened:** with the web server stopped, `probe.measure()` returns
  `{state: 'unknown', collide: false, slack: 0, headlineLines: 0}` for **every**
  slide in 86ms. Compose still succeeds and still writes a deck. So the overflow
  gate, the collision gate, the slack gate and the whole repair ladder quietly
  do nothing, and the only trace is one `console.warn` on the API's stdout —
  which under `npm run dev` goes to the operator's terminal and is invisible to
  an agent driving the HTTP API.
- **Why it matters:** the deck that comes out is indistinguishable from a
  measured one, but nothing checked it. Every layout finding in this file was
  found by those gates; with :3000 down they are all off, and the caller is
  never told.
- **Direction:** carry the unknown-verdict count into the compose response (or
  the project's `pv`), so "this deck was never measured" is visible to the
  caller rather than to whoever happens to be reading a terminal.

### Compose reports no progress, so slow is indistinguishable from stuck

- **Kind:** Gap
- **Severity:** minor
- **First seen:** 2026-08-12 — prepaid-packages-cash-flow
- **What happened:** `POST /projects/:id/compose` is synchronous and emits
  nothing until it returns. A healthy 8-slide compose took **~25 seconds**, so
  a default Node `fetch` is normally fine — but during the stalls above there
  was no way to tell a slow run from a wedged one, and Node's built-in `fetch`
  gives up at undici's 300s `HeadersTimeoutError`, which is itself
  indistinguishable from the server dying.
- **Correction:** I first wrote that the endpoint "cannot be driven from a plain
  Node client". That is wrong in the normal case — it only bit because those
  particular runs never finished.
- **Why it matters:** the only long operation in the tool is also the one with
  no observability, so every stall costs a full timeout to diagnose.
- **Direction:** the video exporter already has the right shape — `POST` returns
  a `jobId`, `GET .../:jobId` returns `{state, percent}`. Worth reusing here.

### The CRM payload's `caption` is a string; the API wants `{text, hashtags}`

- **Kind:** Friction
- **Severity:** minor
- **First seen:** 2026-08-12 — prepaid-packages-cash-flow
- **What happened:** `builds/<slug>.instagram.json` carries `caption` as a bare
  **string** and the hashtags separately as `hashtags: string[]`.
  `createProjectSchema` expects `caption: {text, hashtags}`. Reading
  `payload.caption.text` yields `undefined`, zod's `.default('')` accepts it
  silently, and the project is created with an empty caption while the hashtags
  — read from the sibling `payload.hashtags` — arrive intact. The result looks
  exactly like a partial write on ContentBuilder's side.
- **Correction:** I first logged this as `createProject` dropping
  `caption.text`, and called it a regression against *The keyword and the
  caption lived in different places*. **That was wrong** — a direct
  `POST /projects` with `caption: {text: 'HELLO CAPTION TEXT', hashtags: [...]}`
  round-trips perfectly. ContentBuilder is not at fault; the caller is, and the
  shape mismatch is what makes the mistake easy.
- **Why it matters:** the failure is silent on both sides, and the thing lost is
  the caption the CRM spent real effort drafting in the house voice.
- **Direction:** belongs on the CRM side or in the skill rather than here —
  either emit `caption: {text, hashtags}` from `content:instagram`, or have the
  skill map it explicitly. Making `captionSchema.text` required for create
  would also turn the silent loss into a 400.

### Neither precondition for composing is visible on `GET /businesses/:id`

- **Kind:** Friction
- **Severity:** minor
- **First seen:** 2026-08-12 — prepaid-packages-cash-flow
- **What happened:** compose requires a design recipe and refuses an imageless
  deck, but `GET /businesses/:id` carries **neither** — `mediaAssets` is absent
  from the response and the kit it returns has no `recipe` key. The real answers
  live at `/businesses/:id/media` (**76** assets) and `/businesses/:id/brandkit`
  (recipe v2, under `.approved`). Reading the business response first, I
  concluded the brand had no photos and no recipe, and came close to escalating
  "this brand has no design recipe yet" — which the skill says to stop on.
- **Correction:** I first logged this as the endpoint *reporting* `mediaAssets:
  0`. It reports nothing; my own `(b.mediaAssets || []).length` turned an absent
  field into a zero. The API is not lying — it is just not the place to look.
- **Why it matters:** an agent checking readiness on the obvious endpoint gets a
  false negative on both preconditions, and the mistake is silent.
- **Direction:** cheapest fix is documentation — the skill should say to check
  `/media` and `/brandkit` (`.approved.recipe`) rather than the business
  response. Including counts on the business summary would also work.

### Recipe-author v6's elevation rule did not bite

- **Kind:** Gap
- **Severity:** cost me a fix
- **First seen:** 2026-08-11 — re-authoring detailmasters against v6
- **What happened:** v6 asks for "one radius scale and one elevation model
  across `.cb-shot`, `.panel` and `.cta`". The re-authored draft came back with
  **three treatments again** — `cb-shot` a drop shadow, `panel` a hairline,
  `cta` flat. The glow instruction from the same release DID take (the draft
  authors `--cb-glow-*` custom properties), so the release reached the model;
  this specific rule simply did not change its behaviour.
- **Why it matters:** a prompt rule that does not bite is worse than no rule —
  it reads as fixed in the version registry while the output is unchanged, so
  the next person to look believes it is handled.
- **Direction:** the glow rule worked because it names a mechanism (custom
  properties with defaults) rather than a principle. The elevation rule states a
  principle and leaves the mechanism open. Give it the same treatment: name a
  single token (e.g. `--cb-elev`) the brand must define once and every raised
  surface must reference, so compliance is checkable rather than aspirational.
  `validateRecipeConsistency` could then enforce it.

### A re-authored recipe silently lost a fragment

- **Kind:** Defect
- **Severity:** cost me a fix
- **First seen:** 2026-08-11 — the same v6 draft
- **What happened:** the current recipe carries all seven role fragments. The
  re-authored draft came back with six — `statement` is absent. Nothing in the
  response said so; it was found by diffing the two.
- **Why it matters:** `statement` is one of the most-used roles, and a role with
  no fragment falls back to a per-slide model call — slower, less predictable,
  and the exact path that once rendered the model's own reasoning onto a slide.
  A re-author that quietly trades free deterministic composition for a model
  call on the commonest role is a downgrade wearing an upgrade's version number.
- **Direction:** report fragment coverage on the authoring response, and warn
  when a re-author returns fewer roles than the recipe it replaces.

### The review page names half the typography

- **Kind:** Defect
- **Severity:** cost me a fix
- **First seen:** 2026-08-11 — `how-often-ceramic-coating`
- **Corrected 2026-08-11:** reported originally as "the recipe defines no body
  typeface". It does — `tokens.bodyFamily` is `Inter`, and `.cb-slide` sets
  `font-family: var(--cb-body)`, so every line of body copy renders in it. The
  *symptom* was real and the *diagnosis* was wrong, which is worth recording:
  the fix would otherwise have gone to the recipe author instead of to the page.
- **What happened:** the review page showed `Type: Playfair Display` and nothing
  else, in both the recipe panel and the token strip. A reviewer reasonably
  concluded no body face was set and that the sans on every slide was a browser
  default.
- **Why it matters:** a panel that names half the typography reads as the whole
  of it. The wrong conclusion here would have cost a re-author of a brand whose
  type was already correct.
- **Fixed 2026-08-11** — both places now show the display and body faces.

### No per-slide view of the source sentence a slide came from

- **Kind:** Gap
- **Severity:** cost me a fix
- **First seen:** 2026-08-11 — `how-often-ceramic-coating` review
- **What happened:** three slides drifted from the source post and nothing on
  the review page could show it — noticing required holding the post and the
  deck open in two tabs and comparing by hand. The copywriter is now
  constrained (v5), but the reviewer still cannot SEE fidelity.
- **Why it matters:** a constraint without a check degrades quietly. The next
  drift will again be caught only by a human who happens to re-read the post.
- **Direction:** the parse step knows which beat produced each slide; carry
  that through and show the source sentence under each card on review.

### No phone-size scroll view on the review page

- **Kind:** Gap
- **Severity:** minor
- **First seen:** 2026-08-11 — `how-often-ceramic-coating` review
- **What happened:** the review page shows slides as a strip of small cards —
  the one view in which seven identical gradient panels look fine. The monotony
  was obvious only after export, at full size.
- **Why it matters:** the review page's whole job is to catch what will look
  wrong on a phone, at phone size.
- **Direction:** a stacked, phone-width view; the ScaledSlide component already
  renders at arbitrary width.

### An image can still contradict its slide, and the checker only catches some of it

- **Kind:** Gap
- **Severity:** minor
- **First seen:** 2026-08-11 — `how-often-ceramic-coating`, round 2
- **What happened:** the new `image-copy-check` catches PRACTICE mismatches
  reliably — a wash-bay photo against a deck that condemns automatic washes was
  flagged 3 runs out of 3, with no false positives on the corrected deck across
  2 runs. STATE mismatches are inconsistent: a photo of flat clinging droplets
  under "water sheets off cleanly" was caught on one run and missed on the next.
- **Why it matters:** the state case is the harder judgement (is this beading or
  sheeting?) and it is also the more common one. An inconsistent check is worth
  having, but it is not a guarantee, and the hand-back should not describe it as
  one.
- **Direction:** for state claims the copy usually names the state in words —
  "tight", "flat", "clinging", "sheeting". Extracting that adjective and asking
  the narrower question ("does this photo show tight beads or flat ones?") is
  likely more reliable than asking for contradictions in general.

### Authored story slides ignore STORY_UI_RESERVE

- **Kind:** Gap
- **Severity:** minor
- **First seen:** 2026-08-11 — `how-often-ceramic-coating` promo story
- **What happened:** `safeAreaFor('story')` reserves 250px top and bottom, and
  `safeInsets` applies it — but an authored slide's padding comes from the
  recipe stylesheet, which knows nothing about the reserve. The promo story's
  CTA button sat low enough that Instagram's reply bar could overlap it. Patched
  for the promo story specifically (a trailing `fill` re-centres the stack);
  every other authored story has the same exposure.
- **Why it matters:** it is invisible in the export and only shows up on a phone,
  after posting.
- **Direction:** the per-format variant block in a recipe (`formats['1080x1920']`)
  is the right place — the reserve could be appended there when the recipe is
  authored, so it applies to every story rather than per-caller.

### Descenders collide with the block below

- **Kind:** Defect
- **Severity:** minor
- **First seen:** 2026-08-11 — `raise-average-ticket-add-ons`, slide 8 and the promo story
- **What happened:** on slide 8 the headline `Quer um guia para começar?` sits
  directly on the gold `.cta` chip — the cedilla of "começar" and the question
  mark overlap the chip's top edge. In the promo story the headline
  `oferecer um extra` overlaps the cover thumbnail's top border the same way.
  Both are the display serif at its largest size with a descender on the last
  line.
- **Why it matters:** small, but it is the kind of thing that reads as "made by
  a machine" at phone size, and it lands on the two slides that carry the CTA.
- **Direction:** the render check already detects overflow objectively; this is
  the adjacent case — a bounding box that fits but whose ink does not. Extra
  line-height or a min-margin under `.headline` when the next sibling is
  `.cta` or `.cb-shot` would cover it.
- **Seen again:**
  - 2026-08-12 — prepaid-packages-cash-flow — the cover's image box clipped the descenders of "you touch the car" at both the default size and `size: md`; only moving the photo to `placement: background` cleared it.

## Resolved

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

