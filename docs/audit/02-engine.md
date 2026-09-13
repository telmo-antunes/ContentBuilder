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
