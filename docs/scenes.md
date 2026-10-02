# Scenes — acting the product out, inside a slide

*Design note, 2026-10-02, written at Telmo's ask: the motion scenes on /crm and
/about, and the Liquid Glass reels, should be something ContentBuilder can make
too. Steps 1–3 below were built the same day (branch `claude/scene-slides`);
the composer's scene role is the open piece.*

## What exists today, and why none of it transfers as-is

Three motion systems, each right for its own surface and each unable to feed
the others:

| | **the website** (`apps/web/components/crm/scenes/`) | **ContentBuilder video** (`lib/render/AuthoredSlide.tsx` + `videoExporter.ts`) | **the reels** (`marketing/reels/*/promo.html`) |
|---|---|---|---|
| what moves | a UI acting out a sequence of states — a booking lands, a reminder goes out, a message is approved. 16 scenes. | the *entrance* of a static composition: rise / fade / slide / punch / pop, per role, then hold | one glass body morphing through states, with a pointer making real taps |
| the clock | `useScene`: `setTimeout` steps `step` 0→n while the card is in view; framer-motion animates between steps | CSS `cb-enter` animations; the exporter pauses `document.getAnimations()` and seeks `currentTime` frame by frame | `seek(t)`: every frame is a pure function of time — closed-form springs summed per retarget |
| exportable to video? | **no** — `setTimeout` and framer-motion springs are not steppable; a headless capture gets whatever frame the wall clock reached | yes, that is what it is for — but it can only step what is a Web Animation | yes, by construction; this is why the reel engine exists |

The website's scenes are the ones Telmo likes, and they are the one system that
cannot be rendered to a file. The reel's engine renders perfectly and has no
authoring surface — every scene is hand-written JavaScript. ContentBuilder has
the authoring surface (a recipe, a composer, review, export) and animates only
entrances.

## The proposal: a `scene` slide, driven by a seekable clock

One new slide kind in ContentBuilder. It is authored like any other slide
(recipe classes, the brand's type and surfaces, sanitised markup), with two
additions:

1. **Steps.** The markup carries `data-cb-step="0,1"` on elements that exist
   only during those steps, and a `data-cb-steps="2.8,2.4,2.6"` on the slide
   root naming how long each step holds. That is `useScene`'s model, written
   down instead of coded.
2. **A seekable clock.** Instead of `setTimeout`, the render page exposes
   `window.__cbSeek(t)`: given a time, it computes which step is live and the
   spring progress of every element entering or leaving it, and paints that
   frame. The reel's `Track` class (≈40 lines: a sum of closed-form damped
   step responses, Apple parameters) is the right primitive and ports
   unchanged. Between steps, content swaps the way both the reel and the
   website already do: exit 120 ms with blur, enter 60 ms later on its own
   spring.

The exporter then has one new branch: if the page defines `__cbSeek`, drive it
instead of `getAnimations()`. Everything downstream — frame capture, ffmpeg,
the per-slide clip, the zip — is untouched.

**Why this and not a port of framer-motion.** The exporter needs determinism:
frame 311 must paint the same whether it is rendered first or after a pause.
A timer-driven scene cannot promise that; a pure function of `t` cannot fail
it. The website keeps its scenes as they are — they are fine on a page, where
the wall clock *is* the clock. This is the same scene *model* with a different
clock under it, which is why the two can share markup later if that is ever
wanted.

## What the composer learns

Today the composer writes copy into roles (`cover`, `list`, `stat`, `cta`…).
A `scene` role asks it for something it has not written before: **a short
sequence of states that proves one claim**, each state a sentence of UI. The
website's 16 scenes are the training set — they are already the claims the
brand makes, each acted out in three to five steps, and the beat sheet for the
intro reel is the same thing at film length. The composer's brief for a scene
slide is the truth table (the facts that may appear) plus the one claim the
scene proves, and its output is the step list.

What it must not do is the same as everywhere else: no stat it was not given,
no feature that does not exist, no suggestion that the platform sends clients.

## Status — 2026-10-02

| | |
|---|---|
| the clock, step markup, sanitiser, exporter branch | **built** — `shared/scenes.ts`, `htmlSanitize.ts`, `AuthoredSlide.tsx`, `videoExporter.ts` |
| one scene by hand, exported | **built** — Smart Reconnect, project `6abfb3c28dcd44ce8b58c936`, 9 s clip; frames at 1.8 / 2.9 / 5.4 s show the three states |
| the composer's scene role | open |
| the Studio: scrub and edit steps | open |

**Found on the proof.** The one-ask check (`oneAskFaults`) read the scene's
"Send to Ana" button as *a second ask*. In a scene a button is a state in the
story, not an ask to the reader; the check needs to know the slide is a scene
(`isScene(html)`) and skip buttons carrying `data-cb-step`. One line, once the
composer role lands and decides what a scene's close looks like.

## What it costs, in order

1. **The clock** — port `Track`/`S()` from the reel into the render page,
   `__cbSeek(t)`, and the exporter branch. Small, and the whole thing hinges
   on it. *About a day.*
2. **Step markup + sanitiser allowance** — `data-cb-step`, `data-cb-steps`,
   both re-validated the way `data-cb-slot` is. *Half a day.*
3. **One scene, by hand** — the Smart Reconnect beat from the reel (a quiet
   client, a drafted message splitting off, sent), authored as a slide, exported
   as a clip. This is the proof; nothing else should start before it renders.
   *A day, most of it looking at frames.*
4. **The composer's scene role** — prompt, the step-list output shape, the
   corrective pass checking that every state is a stated fact. *Two to three
   days, because this is where the quality is decided.*
5. **The Studio** — show the step list, scrub it, edit a step's copy. Later.

A promo story could then be a scene too: the carousel's cover, acted out.

## What it does not do

It does not make Liquid Glass. The reel's refraction is a WebGL pass over a
wallpaper texture, and a slide has no wallpaper — it has the brand's ground.
A scene slide moves the brand's own surfaces (cards, rows, buttons, type) the
way the website's scenes do. That is the right scope: the glass is the reel's
signature, the recipe is the deck's.
