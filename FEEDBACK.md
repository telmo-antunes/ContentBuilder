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

### The `stat` role filled its stat and its headline with the same sentence

- **Kind:** Defect
- **Severity:** cost me a fix
- **First seen:** 2026-08-11 — `how-often-ceramic-coating`, slide 5
- **What happened:** the slide rendered two `.headline` divs back to back, both
  reading *"If it still beads, it still works."* — one with the brand's italic
  emphasis span, one plain. The role's fragment has both a `{{stat}}` and a
  `{{headline}}` hole and the copywriter supplied the same line for each.
- **Why it matters:** it reads as a rendering bug rather than a design, and it
  is on the slide meant to be the deck's most quotable.
- **Direction:** the verbatim guard already knows which part each hole carries;
  if two holes resolve to the same string, drop the lower-priority one rather
  than emitting both.

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

### The composer echoed the headline in the eyebrow

- **Kind:** Defect
- **Severity:** minor
- **First seen:** 2026-08-11 — `raise-average-ticket-add-ons`, slide 1 (`cover`)
- **What happened:** eyebrow rendered `O momento certo`; the headline directly
  beneath it read `O momento certo para oferecer um serviço extra`. The first
  three words appear twice, stacked, in the two largest type styles on the
  cover.
- **Why it matters:** the eyebrow is the one place to add context the headline
  does not have (I replaced it with `Ticket médio`). Repeating wastes the slot
  and makes the cover look like a template that was not filled in.
- **Direction:** a cheap check at compose time — reject an eyebrow that is a
  prefix or substring of its own headline and re-ask.

### Slide roles are assigned without checking the copy can fill them

- **Kind:** Friction
- **Severity:** minor
- **First seen:** 2026-08-11 — `raise-average-ticket-add-ons`, slide 6
- **What happened:** slide 6 was composed as `role: "stat"` but contains no
  number, figure or measurement — its body is the question *"Quais os extras que
  os seus clientes aceitam sem hesitar?"*. It renders as an ordinary statement
  slide, indistinguishable from slides 2 and 4.
- **Why it matters:** not wrong on the page, but the deck loses a beat of visual
  variety, and per-role motion in animated exports will be applied to a slide
  that has nothing to count up.
- **Direction:** if the chosen role is `stat` and no part parses as a figure,
  fall back to `statement` rather than composing a stat slide with no stat.

---

## Resolved

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

