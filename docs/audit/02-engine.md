# 02 — Engine experiments (real API)

*Phase 2. Runs on the real models through the worktree's code via the lab
bench (`composeFromParse.ts --parse live --art-direction --critique
--ceiling 0.40`), rendered through the worktree's web server. Spend is
reported per run from the ledger.*

## Run 1 — aftercare, copywriter v10 on Sonnet 4.6 (the current tier)

The copywriter's output (`audit-out/lab/p2--aftercare--run1.parse.json`):
ten slides — an opinion cover, a centred statement expanding the problem, a
one-liner ("One message, sent at handover." + "Four lines. The whole job
covered."), the four-item list, the control as the headline with a product
screenshot, four writing rules, the template as a `quote` object, the
exclusions as `dont` rows, a second product slide from the facts list, and a
three-part close. Every form the prompt teaches appears, unprompted, and the
"why" lines read like a designer's notes.

**Two caveats.**
1. **Contaminated.** The aftercare brief IS the prompt's worked example, so
   the cover comes back word for word. Slides 2, 6 and 9 are the model's own;
   they follow the forms without copying. The clean test is every OTHER
   corpus brief.
2. **The dangling-word rule changed the source.** The corrective re-parse
   fired on "The date they cannot wash it until" and two more rows, and the
   model obeyed by REWORDING verbatim source items ("Fixed three dangling
   rows — each now closes cleanly"). Finding 2 (prompt lab), now seen in
   production: rows must be exempt from that rule before it rewrites the
   brief's own words on every list.

**Dev-server note.** The first attempt lost its render probes when the
worktree web server was stopped by the app mid-run; the parse was saved and
replayed through the rest of the pipeline (run 1b), so the parse call was paid
once (≈$0.03, two parse calls plus art direction, ledger lost with the process).

### Run 1b — the saved parse through the rest of the pipeline ($0.22)

Sheet: [p2--aftercare--run1b](sheets/p2--aftercare--run1b.jpg). Score
(calibrated): fidelity 4 · hook 4 · specificity 3 · variety 3 · hierarchy 3 ·
brand 4 · legibility 3 · cta 3 — against the shipped deck's 2/1/2/2/1/2/1/1.
Ledger: critique $0.067, design pass ×2 $0.063, compose ×2 $0.046, art
direction $0.025, design pass (cover) $0.021 — 7 calls, $0.22, plus ≈$0.03 for
the parse in run 1. About $0.25 a deck on the current tiers.

What worked unprompted: art direction matched forms to content ("the two bare
headline slides get the one-liner treatment, the numbered steps get the
ordered poster, the do-not list gets the verdict treatment"); 9 of 10 slides
substituted from fragments; the design pass improved two feature headlines
and left the cover alone with a reason.

What the critique (now judging against the bar) flagged, and where each lives:
- both bleed photos dropped for tone again → **fixed**: the pool is ordered
  by suitability before it is spent (`lib/photoPool.ts`)
- lists 4, 6, 8 top-packed over an empty half-frame → **fixed**: the `list`
  archetype centres its block (`archetypes.ts`)
- the centred close with a left-aligned button → **fixed**: centred slides
  centre their button and mark (`archetypes.ts`)
- three source rows reworded to dodge the dangling-word rule → **fixed**:
  rows may end on a preposition (`compose.ts`)
- two screenshots shrunk into cards → still open: a zoom/crop on slot photos
- slides 4 and 6 wearing the same numbered form → the art director's call;
  its prompt already asks for no two consecutive slides on one form

### Run 2 — the same parse after the four fixes ($0.28)

Sheet: [p2--aftercare--run2](sheets/p2--aftercare--run2.jpg). Score:
4 · 4 · 3 · 3 · **4** · 4 · 3 · **4** (hierarchy and CTA up one each). The
cover and the close now carry full-bleed photographs, the lists are centred,
the button is centred. Two new things the run taught:

- **Ordering the whole pool by tone was wrong.** The dark car photographs
  went onto the product-proof slots, where the light UI screenshots belong.
  The tone preference now applies only to the bleed pick; slot fills keep
  pool order.
- **The slack gate fights the one-liner.** Slide 3 left the copywriter as a
  headline and a tagline; the gate measured 50% empty on a `statement` role
  (a content role, limit 0.50) and the "said-more" rung asked for a body,
  which the copywriter supplied. A one-liner is 55–60% empty by design.
  `statement` now takes the display limit (0.65).

Cost note: three slides went to the model this run (a statement pinned to a
variant without its tagline hole, a feature without a body hole) plus two
verbatim retries — $0.10 of the $0.28. The art director's pin should respect
the parts a slide carries; a cheap check before pinning would keep those
slides on the free path.

### Run 3 — after the bleed-only order, statement-as-display and the pin check ($0.19)

Sheet: [p2--aftercare--run3](sheets/p2--aftercare--run3.jpg). Score:
4 · 4 · 3 · **4** · 4 · 4 · 3 · 4 — the hand-made ceiling's score, from the
real pipeline, for $0.22 all in (7 calls: critique $0.062, design pass ×2
$0.056, compose ×2 $0.029, art direction $0.022, cover pass $0.022). The pin
check kept slide 3 on the free path and the one-liner survived the slack
gate. One more form conflict surfaced and is now guarded: the director pinned
the numbered variant onto a verdict list, turning ✕ marks into 01–03.

| | shipped (owner) | run 1b | run 2 | run 3 |
|---|---|---|---|---|
| fidelity | 2 | 4 | 4 | 4 |
| hook | 1 | 4 | 4 | 4 |
| specificity | 2 | 3 | 3 | 3 |
| variety | 2 | 3 | 3 | 4 |
| hierarchy | 1 | 3 | 4 | 4 |
| brand | 2 | 4 | 4 | 4 |
| legibility | 1 | 3 | 3 | 3 |
| cta | 1 | 3 | 4 | 4 |
| cost | $0.21 | $0.25 | $0.28 | $0.22 |

Still open after run 3: the product screenshots arrive whole and shrink into
a card (legibility stays at 3 until a slot photo can be zoomed or the
upstream payload sends a crop). Spend so far this phase: $0.72; audit total
$0.77 of $10.

## The clean test — seven uncontaminated briefs, current tiers

Run sequentially on 2026-09-14 (`audit-out/lab/run-corpus.sh`): getting-paid,
reapply-ceramic, momento-certo (pt-PT), prepaid-packages, smell-was-back, and
the two planned briefs. Each: real copywriter (Sonnet 4.6), art direction,
pool photos, gates, critique, $0.40 ceiling.

**Copy, before any pixels (getting-paid).** Without a worked example of this
brief to lean on, the copywriter led with the reader's pain ("A quiet week is
not a marketing problem."), pivoted on a centred one-liner, put the four
package terms in rows, made the two purchase paths a verdict list with notes,
and closed on one line and one button. Every "why" reads like a designer's
note. Ten of ten slides then substituted from fragments — no arrange call.

**One thing for the CRM side.** The facts list arrives in developer
language — "The purchase record stores the Stripe PaymentIntent that paid
for it", "No payment intent or transaction record is created" — and the
no-rewording rule carries it onto slide 5 and slide 6 verbatim. A reader who
runs a detailing studio does not know what a PaymentIntent is. The fix is
upstream: `content:instagram` should hand over facts in the reader's words.

**Clean decks scored (current tiers):**

| brief | slides | free | spend | fidelity · hook · spec · variety · hierarchy · brand · legibility · cta |
|---|---|---|---|---|
| getting-paid | 10 | 10/10 | $0.22 | 4 · 4 · 3 · 3 · 4 · 4 · 3 · 4 |
| reapply-ceramic | 7 | 7/7 | $0.19 | 4 · 4 · 3 · 2 · 3 · 4 · 3 · 4 |
| momento-certo (pt-PT) | 7 | 7/7 | $0.16 | 4 · 4 · 3 · 3 · 3 · 4 · 3 · 4 |
| prepaid-packages | 9 | 7/9 | $0.26 | 4 · 4 · 3 · 3 · 3 · 4 · 3 · 4 |

Copy holds at 4/4 on every clean brief. Three mechanical findings recur and
are the next fixes:
1. **Product screenshots shrink into cards** — blocking in every critique.
   Needs a zoom on slot photos (schema `zoom`, painter `background-size`,
   a default crop for wide light screenshots at attach time).
2. **The boxed-body statement variant** is called the weakest form in every
   deck; the exhibit form landed on a text verdict list. Drop the card
   statement variant; reserve the exhibit for rows that are numbers.
3. **Substitution gives up on the rotation's variant** when a sibling
   variant carries the parts — three paid composes on prepaid-packages for
   nothing. Try every variant of the role before the model.
Copywriter: cap the quote form at ~20 words; on a prose brief with no lists,
make one slide a one-liner or a number.

| smell-was-back | 7 | 5/7 | $0.25 | 3 · 4 · 3 · 2 · 3 · 4 · 3 · 4 |

Two more findings from smell-was-back:
4. **The AI compose path can lose a row's words.** Slide 4 went to the model
   (its variant had no body hole); the composer shipped "Extraction depth
   sets the outcome" as "Extraction", and the verbatim guard — which
   re-splices missing PARTS — does not check rows. The fragment path cannot
   do this. Fix: guard rows too, and (finding 3) stop sending lists to the
   model when a sibling variant carries them.
5. **The pool cannot tell a screenshot from a photograph.** A slide about the
   headliner received the packages table; the copywriter's `imageQuery`
   ("headliner", "dashboard") is never consulted. Cheap fix: classify pool
   assets once (light + wide = screenshot) and match a slot to the slide's
   image intent before falling back to pool order.
| planned-odour | 8 | 4/8 | $0.30 | 3 · 4 · 3 · 2 · 3 · 4 · 3 · 4 |

6. **A headline over budget was clamped, not re-asked.** 67 characters
   against 60 is under the 10% re-parse threshold, so the clamp cut "…on
   foam that still smells" at "still" — not a dangling word, so nothing
   flagged it — and the cover-grade fault the baseline named as cause 4
   shipped again. A headline must never be clamped: any overage triggers the
   corrective re-parse, and the clamp is for body copy only.
7. **Planned briefs write lists with a body line**, and no list variant has
   a body hole, so every list in an eight-beat planned deck goes to the
   model ($0.07 × 4 here) and comes back as the same stack. Give one list
   variant a body hole (the numbered poster can carry a lead-in line).
| planned-maintenance | 8 | 7/8 | $0.27 | 4 · 4 · 3 · 3 · 3 · 4 · 3 · 2 |

8. **A second cover mid-deck.** The copywriter gave a middle beat the `cover`
   role; nothing demoted it, so slide 5 wears the logo lockup and a bleed
   photograph in the middle of the argument. `normalizeParsedDeck` should
   demote any cover after the first to `statement`.
9. **The tagline has no budget.** eyebrow, headline, body, cta and rows are
   budgeted; the tagline is not, so the close's tagline became a six-line
   paragraph over a busy photo. A tagline budget of ~70 characters, held
   the way the headline is (re-ask, never clamp).

**Clean set, seven briefs, current tiers:** mean 3.9 · 4.0 · 3.0 · 2.6 · 3.1 ·
4.0 · 3.0 · 3.7 at a mean $0.23 a deck, 47 of 56 slides from fragments.
Against the owner's scores of the two shipped decks (mean 2.5 · 2 · 2 · 2 · 1
· 2.5 · 1.5 · 1.5) every dimension moved up by 1–2 points; the two that lag,
variety and hierarchy, are the two the nine mechanical findings above address,
and none of them needs a model.

## Tiering — split B: copywriter on Opus 5, arrange on Sonnet 4.6

| brief | free | spend (parse) | score | vs current |
|---|---|---|---|---|
| getting-paid | 10/10 | $0.28 ($0.12) | 4 · 4 · **2** · 3 · 3 · 4 · 3 · 4 | worse — literal developer language on three slides |
| reapply-ceramic | 8/8 | $0.16 ($0.03) | 3 · 4 · 3 · 2 · 3 · 3 · 3 · 4 | equal — dropped the brief's list, used the quote form right |
| prepaid-packages | 8/8 | $0.17 ($0.03) | 4 · 4 · 3 · 3 · 3 · 4 · 3 · 4 | equal, cheaper (first parse passed) |
| planned-odour | 6/8 | $0.27 ($0.10) | 4 · 4 · 3 · 2 · **2** · 4 · **2** · 4 | mixed — no clamped headline; exhibit misfire clipped a grid |

Verdict so far: **no quality gain from Opus as copywriter**, and its parse
costs 1–3× Sonnet's. Opus obeys the no-rewording rule more literally, which
is worse when the facts arrive in developer language. The arrange tier
never ran on three of the four decks, so it cannot be compared here — once
fragments carry the deck, the arrange model is nearly irrelevant to quality
and cost.

10. **Horizontal overflow is invisible to the gate.** The exhibit grid clipped
    a figure cell off the right edge; the layout probe measures height,
    collisions and slack, never width. Add a horizontal check (scrollWidth
    vs clientWidth on the slide root) to the probe.

## Tiering — split C: copywriter on Sonnet 5, arrange on Haiku 4.5

| brief | free | spend (parse) | score | vs current |
|---|---|---|---|---|
| getting-paid | 7/10 | $0.24 ($0.07) | 3 · 3 · **2** · 3 · 3 · 3 · 3 · 4 | worse — generic lines, no terminal punctuation, a clamped headline |
| reapply-ceramic | 7/7 | $0.09 (no critique) | 3 · 4 · **2** · 2 · 3 · 4 · 3 · 4 | worse — the brief's specifics became generic labels |
| prepaid-packages | — | — | — | not run: the Anthropic account's credit balance ran out |
| planned-odour | — | — | — | not run |

Haiku as the ARRANGE model worked: three slides on getting-paid at $0.008
each, verbatim, no retries — and on a fragment-carried deck it hardly ever
runs. Sonnet 5 as the COPYWRITER was worse than Sonnet 4.6 on both briefs.

**Tiering verdict.** Keep the copywriter on Sonnet 4.6 (the current env
tier): Opus 5 gains nothing and costs 1–3× on the parse; Sonnet 5 writes
more generically. Move the arrange step DOWN to Haiku 4.5 — it composes the
few slides fragments cannot carry for a cent each, and the Settings override
pinning `composeModel` to Sonnet 5 buys nothing. Net: quality held, roughly
$0.03 a deck saved, and the inverted split (strong arranger, weaker writer)
that the baseline found is corrected in the right direction.

The runs stopped at 02:02 when the account's credits ran out. Audit spend
to that point: ≈ $3.60 of the $10 cap.

## The three fixes, applied and validated ($0)

Applied after the runs finished (they would have confounded the comparison):

1. **Zoom on slot photos.** `SlidePhoto.zoom` (1–4) in the schema, the
   painter uses it as a width multiple positioned by `focal`, the Studio's
   photo panel gets a slider, and the pool attach gives a wide light picture
   (a screenshot, far more often than not) a default of 1.6× anchored
   upper-left. The first attempt at 2.2× on the upper third landed on
   whitespace; an automatic crop cannot know which row proves the point, so
   the default is a floor and the slider is the control.
2. **Forms.** The boxed-body statement variant is gone from both reference
   recipes (and re-attached to both live kits); the exhibit form is refused
   unless every row is a short number; the numbered form is refused on a
   verdict list.
3. **Try every arrangement before paying.** Substitution now walks the
   role's variants from the rotation's pick; a slide only reaches the model
   when none can carry it.

Validated on the getting-paid parse with `--no-model`
([sheet](sheets/fix3--getting-paid-no-model.jpg)): three slides that had
gone to the model in the live run were rescued onto sibling arrangements,
10/10 from fragments, both screenshots legible at feed scale, no boxed
statement. Typecheck, lint and all 1,428 tests green.

## Backlog from Phase 2 (all deterministic, none needs a model)

- rows are verbatim-guarded on the AI compose path (finding 4)
- a headline over budget is re-asked, never clamped (6)
- a tagline budget of ~70 characters (9)
- one list variant carries a lead-in body line (7)
- any cover after the first is demoted to statement (8)
- pool assets classified screenshot vs photograph and matched to the slide's
  image intent (5)
- the layout probe measures width as well as height (10)
- copywriter: cap the quote form at ~20 words; on a prose brief with no
  lists, make one slide a one-liner or a number; keep terminal punctuation
- Settings: move `composeModel` to Haiku 4.5, leave the copywriter on
  Sonnet 4.6 (the tiering verdict)
- upstream (CRM): hand over facts in the reader's words, not the schema's
