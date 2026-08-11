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

### The `.cb-shot` gradient makes a dark carousel cover unreadable in a promo story

- **Kind:** Defect
- **Severity:** blocked shipping
- **First seen:** 2026-08-11 — `raise-average-ticket-add-ons` promo story
- **What happened:** `POST /projects/:id/promo-story` placed the rendered cover
  into the composed frame's `cb-shot` slot correctly (`placement: "slot"`,
  687KB export, no blank frame). But detailmasters' brand is cream-on-near-black
  (`background: #0D0D0F`), so a slide-of-a-slide sits dark-on-dark, and the
  slot's own dark gradient overlay crushes what is left. In the exported PNG the
  embedded cover reads as a faintly outlined black rectangle — its headline is
  legible only if you already know what it says.
- **Why it matters:** the promo story works entirely by **recognition** — a
  follower is meant to see the carousel they are being sent to. An invisible
  thumbnail removes the only reason the feature exists over a plain text frame.
  It is not postable as-is.
- **Direction:** the gradient is right for photography and wrong for a render of
  our own slide. Either let a photo opt out of the `.cb-shot` treatment
  (`imageTreatment: 'none'` already exists on slide overrides — it may just need
  wiring to the slot), or have `promo-story` render the cover onto a light plate
  first so it reads as a card rather than a hole.

### Composed body copy is clipped mid-sentence, with no terminator

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

### No recipe fragment carries a `cb-shot` hole, so decks are silently text-only

- **Kind:** Friction
- **Severity:** cost me a fix
- **First seen:** 2026-08-11 — `raise-average-ticket-add-ons`
- **What happened:** the CRM payload offered a published hero image. Every one
  of the 8 composed slides came back with **zero** `data-cb-slot` placeholders,
  so there was nowhere to attach it. Reading `compose.ts` explains it: a role
  whose fragment has no `cb-shot` hole is skipped for photo substitution, and
  none of detailmasters' seven fragments has one. The same cause is why the
  promo story's frame composed via the model (`composedBy: "ai"`) instead of the
  free substitution path.
- **Why it matters:** the account's own audit says product-demo posts — ones
  showing a real screen — are the posts that earn comments. A brand whose recipe
  cannot hold a picture can only ever produce positioning posts. Nothing warned
  me; I found it by diffing the payload against the composed slides.
- **Direction:** at minimum, say so — compose could report "this brand's
  fragments cannot take photos" when a caller supplies images and no slot
  exists. Better: `fillFragmentGaps` already adds missing copy holes to a
  fragment; the same idea could add a `cb-shot` hole to the roles that should
  have one.

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

*(move entries here with the date and what fixed them, rather than deleting —
a fixed-then-regressed finding is worth being able to point at)*
