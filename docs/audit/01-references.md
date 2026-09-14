# 01 — The bar: what the reference accounts actually do

*Captured 2026-09-13 in the owner's logged-in Chrome, from the twenty accounts
in the owner's swipe file (artifact ff5fe15d). Twenty profile grids and
carousel slides from nine of them. Observations are of the current feed, not
of the accounts' reputations.*

## The rule the owner set, confirmed in the pixels

Every account constructs its visual — a chart, a diagram, an illustration, a
cropped interface, a typographic system — and the visual carries the
information. Photography appears only where it pulls the reader in (NYT
Cooking's finished dish, Dezeen's building under a headline). Nothing in the
set looks like ContentBuilder's output: a dark ground, a small eyebrow, a
serif headline, a body paragraph, and a photo card floating below.

## What each does, in one line, and the move worth stealing

| account | what the grid shows | the move for ContentBuilder |
|---|---|---|
| **Notion** | a labelled step ("Step 1"), a two-line headline, two short paragraphs, then the interface cropped to the one element that matters, at real scale, bleeding off the bottom | **the product-proof slide**: copy above, UI crop below the fold, never a full-dashboard thumbnail in a card |
| **Precision Nutrition** | one dense instructional poster per post: numbered sections, an icon per section, a sentence of explanation and a three-item sub-list under each | **the numbered teaching poster**: 3 items × (number, icon, headline, why, two bullets) on ONE slide — a whole "four things" post that ContentBuilder currently spreads over four bare-row slides |
| **McKinsey** | four stats in a 2×2, each with a bold label and a two-word explanation, a title that states the finding, deep navy, the source lockup bottom-left | **the exhibit slide**: numbers as the composition, labels as the copy; the deck's title states the finding, not the topic |
| **Our World in Data** | a titled bar chart, a subtitle that says exactly what is measured, source and licence in the footer | **cite the source on the slide** — the CRM's facts list already exists; naming it is free authority |
| **WHOOP** | dark ground, one metric or one line in enormous type, a second-person sentence; photo carousels are black and white and silent | **the one-line slide**: a single sentence at display size with nothing else on the frame |
| **Headspace** | "You are LOVED" — three words, one accent word, a flat colour field; a carousel of the same frame with one word changing | **pacing**: a slide may be six words; a carousel may repeat one frame with one word changing |
| **The Economist** | a kicker in small type, a serif headline, a hard horizontal rule, then an illustration in a single accent colour filling the lower half | **the fixed lockup + a constructed picture**: type in the top third, the picture owns the rest, one brand element (the red rule) in the same place every time |
| **Visual Capitalist** | one enormous infographic, the hero number at poster size ("3,803"), sliced so each crop still reads | **one number at poster size** with its label under it; and slicing one artboard into slides |
| **Blinkist** | a soft gradient field, one italic serif line ("Plot twist: Being busy is a form of laziness"), a small arrow bottom-right | **the swipe cue** and a cover that is an opinion, not a title |
| **Axios** | photo + a fixed two-line bold headline in the lower third with an "Exclusive" pill; the caption carries the named skeleton (why it matters / the big picture) | **a named, repeatable skeleton** the reader learns once; keyword pills |
| **Dezeen** | photo, one type lockup in the lower-left, a two-tone headline (white + bold white), thousands of times | **one lockup that survives any image** |
| **Monzo** | hot coral, a product photo or a drawn object, headline over it; "How to make your student loan last all term" as an illustrated card | a loud single accent doing the brand work |
| **Mailchimp** | yellow, a giant "30x ROI", surreal objects | a number as the whole slide, again |
| **Finimize / Morning Brew / WIRED** | people-and-headline covers, bold caps; explainers behind | a hook in caps over a face is their move, not this product's |
| **Quanta** | commissioned illustration with a short question as the headline | an unphotographable subject made ownable by illustration |
| **Pentagram / The Brand Identity** | the work in a rigid frame, oversized single words ("MONA LISA", "London Design Festival") | typographic covers with ONE word at poster scale |
| **NYT Cooking** | finished dish first, then numbered steps | result → steps → result |

## The seven slide forms the bar implies

ContentBuilder has seven roles (cover, statement, quote, feature, stat, list,
cta) and effectively two compositions: the eyebrow/headline/body stack and
the bordered list panel. The references suggest the vocabulary a recipe
should be able to express, each as a fragment variant:

1. **The one-line slide** (WHOOP, Headspace): 3–8 words at display size,
   optionally one accent word, nothing else. Currently unreachable — the
   `statement` fragment always wants a body.
2. **The number slide** (Visual Capitalist, Mailchimp, McKinsey): one figure at
   poster size, a label under it, a one-sentence "what it means to you". The
   `stat` role exists but composes the number beside a headline at similar
   weight.
3. **The exhibit** (McKinsey): 2–4 figures in a grid with bold labels. No
   equivalent role.
4. **The numbered teaching poster** (Precision Nutrition): number + icon +
   headline + why, three per slide. The `list` role renders bare rows; the
   reason behind each row is exactly what the owner scored as missing
   (fidelity 2, specificity 2).
5. **The product-proof slide** (Notion): a step label, a short headline, two
   short lines, the UI cropped to one element and bleeding off the frame.
   ContentBuilder's `feature` puts the screenshot in an inset card that is
   unreadable at feed scale (owner: legibility 1).
6. **The picture-owns-the-frame slide** (Economist, Dezeen, Axios): type in
   one third, a constructed picture or a photo in the other two, one fixed
   brand element. The `showcase` archetype intends this and never gets its
   photo (baseline cause 1).
7. **The close as an arrival** (Blinkist's arrow, WHOOP's single line): one
   sentence and one button, centred, nothing else. The current `cta` carries
   eyebrow + headline + tagline + button + handle (owner: cta 1).

## What this changes in the plan

- The **variety** problem is not "rotate more skeletons"; it is that the
  vocabulary has two forms and needs seven. That is a recipe-author change
  (Phase 2.3) and a fragment contract change, before it is a prompt change.
- The **hook** problem: every reference cover is an opinion, a number or a
  question, never the post's title. The copywriter prompt needs the
  distinction spelled out with examples (Phase 1.3).
- **Legibility** at the owner's bar means: one thing per slide at display
  size; no paragraph under 40px; no screenshot smaller than half the frame.
  Those are measurable floors, so they belong in the render gates, not only
  in a prompt.
- **Photography** is optional at this bar. A deck with zero photos is fine
  if every slide is constructed. That relaxes cause 1 from "fix the photo
  pool" to "give the recipe forms that do not need a photo to have a
  subject".
