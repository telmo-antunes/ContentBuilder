# ContentBuilder

Internal web app that turns a business into on-brand Instagram content. It first authors a **Brand Recipe** — a complete per-brand design system (tokens, an authored stylesheet, a component vocabulary, composition patterns, a motion signature) — and then composes **carousels** (1:1 or 4:5 multi-slide posts) and **stories** (9:16 frames) against it. Slides are exported as pixel-exact PNGs or as animated per-slide MP4 clips.

## The core idea

**Author once, compose cheap, gate deterministically.**

- **Author once** — the expensive, design-critical AI call runs once per brand: it writes the brand's design system (real CSS scoped to the slide root, written against injected `--cb-*` tokens). Every future post reuses it.
- **Compose cheap** — turning an idea into slides is a small-model call: parse the idea into per-slide roles and verbatim copy parts, then arrange those parts using **only the brand's own classes**. The look comes from the recipe, not from per-slide creativity.
- **Deterministic quality gates** — code, not prompts, guarantees the floor at render time:
  - **Contrast repair** — ink is held to WCAG AA body text and the accent to AA large text against the ground; failing colors are walked toward white/black until they pass.
  - **Type floor** — every canvas is 1080px wide and read on a ~393pt phone (≈ px / 2.75), so a deterministic pass raises any undersized type to a legible minimum.
  - **Class consistency** — components advertised to the composer but never defined in the stylesheet are dropped; authored HTML and CSS are sanitized.
  - **Vertical rhythm** — a `.fill` spacer left dangling at the end of a composition (its handle absent, its photo slot unused) grows into empty canvas and leaves the bottom half of the poster blank; the slack is moved behind the top-edge labels instead, and a separator that separates nothing is dropped.
  - **Structural honesty** — a list never loses its rows to a photograph or to the overflow repair, prose never ships in the `.handle`, over-long copy ends on a finished clause rather than an ellipsis, and markdown emphasis the copywriter typed is read as the accent it meant rather than printed as asterisks.
  - **Render-verify (optional)** — the recipe's own output can be rendered, screenshotted, and revised by a vision model before it ships (`POST /brandkits/:kitId/recipe?verify=1`).

The app runs without an Anthropic key: website analysis falls back to heuristic color roles, and the AI compose/candidate/caption buttons disable. Manual kit entry, editing, rendering, and export all keep working.

## Monorepo layout

| Path | What it is |
| --- | --- |
| `apps/web` | Next.js (App Router, TS) — the UI, plus a hidden `/render` route the exporters and the render-verify pass drive. Proxies `/api/*` to the API so the opt-in Basic auth covers both. |
| `apps/api` | Express (TS) — Anthropic calls, Puppeteer capture/render, ffmpeg video encode, Mongo (Mongoose), storage, zip streaming. |
| `packages/shared` | One source of truth for both apps: the Brand Recipe schema + render helpers, formats/dimensions, contrast math, the type floor, slide photos & motion, bundled fonts. |
| `scripts/` | Dev helpers: bundled `mongod` launcher, font bundler. |

## The user flow

1. **Brand** — add a business (name, website URL) from the home Desk's brand rail.
2. **Profile** — fill in the deterministic business profile (category, offer, audience, tone, goal). Required before AI analysis.
3. **Analyze** — `POST /businesses/:id/analyze` drives Puppeteer at the site: screenshot, pixel-sampled palette, DOM-computed color roles, detected fonts (kept when they exist on Google Fonts, else mapped to a bundled lookalike), DOM logo. A vision pass assigns color roles, a style descriptor, and a voice line (heuristics without a key). The site's biggest photos are harvested into the brand's media library. Low-quality captures retry once and are flagged.
4. **Kit approval** — every kit is a draft until a human approves it. Edits to kit colors/fonts re-point the recipe's tokens (with a live diff preview in the UI), and contrast is re-checked.
5. **Recipe** — authored automatically on first approval, or explicitly from the brand-kit screen. You can also author 2–3 **candidates** concurrently, each with a different creative direction, and pick one visually (`/recipe/candidates` → `/recipe/select`). Direct knobs (accent, display case, density, motion style/pace) apply instantly without a re-author.
6. **Compose** — `/projects/new`: pick a brand, carousel or story plus a format, and write the **brief**; `POST /projects/:id/compose` replaces the slides (the previous state is version-snapshotted). The brief is a small language, not just a paragraph — see [The brief](#the-brief) below. How many slides the deck gets is derived from the material, not dialled in. A slide that wants imagery arrives with the brand's own photograph already in its slot, and only ever asks for a slot the brand can fill.
7. **Studio** — `/projects/:id/review`: reorder the deck, **direct one slide** (a prompt, or exact copy in quotes, that rewrites that slide alone), re-compose a single slide into alternatives (keeping the copy) or into new copy (keeping the arrangement), apply instant deterministic tweaks (headline size, inverse surface), edit copy on-canvas, attach photos (uploads, harvested site photos, a Pexels stock picker; background / slot / free placements), replay the motion, write or regenerate the caption, browse and restore version history (up to 20 snapshots).
8. **Export** — PNG zip or animated MP4 (details below). The Share button surfaces LAN links: `/preview/:id` (live, swipeable, works before any export) and `/share/:id` (phone hand-off that feeds exported PNGs to the native share sheet).
9. **Desk** — the home page: every post across every brand on a lifecycle board (`idea → drafting → ready → shipped`). Exporting advances a post to `shipped` automatically; the rest is drag/edit.

## AI touchpoints

Every touchpoint resolves its model as: per-feature override saved in Settings (`/settings`, stored in Mongo) → env tier → fallback down the stack. Token usage and estimated cost are recorded and shown on the Settings page (`GET /usage`).

| Feature | Env tier (fallbacks) | When it runs | Without a key |
| --- | --- | --- | --- |
| Brand vision (color roles, style, voice) | `ANTHROPIC_MODEL_FREE` → `ANTHROPIC_MODEL` | Once per analyze | Heuristic color roles |
| Recipe author (the design system) | `ANTHROPIC_MODEL_DESIGN` → `_FREE` → `_SMALL` → `ANTHROPIC_MODEL` | Once per brand (approval or on demand; ×2–3 for candidates) | Disabled |
| Parse (brief + source → the deck's copy) | `ANTHROPIC_MODEL_FREE` → `_SMALL` → `ANTHROPIC_MODEL` | Once per post (twice if a budget or a verbatim line needs correcting); once per slide for a Studio rewrite | Disabled |
| Compose (copy → authored slides; slide variants) | `ANTHROPIC_MODEL_SMALL` → `ANTHROPIC_MODEL` | Once per slide (skipped entirely when the recipe has fragments) | Disabled |
| Caption | `ANTHROPIC_MODEL_FREE` → `_SMALL` → `ANTHROPIC_MODEL` | On demand per post | Disabled |

The two halves of a compose sit on **different tiers on purpose**. The parse writes
every headline and row from one sentence of idea — it runs once per deck and is the
most quality-determining output in the product, so it gets the better model. The
compose only arranges copy it may not alter, into classes the recipe already fixed,
under a guard chain that repairs it mechanically — it runs once per slide, so it
gets the cheap tier. Each is independently overridable from Settings
(`parseModel`, `composeModel`).

(`ANTHROPIC_MODEL_FREE` is historical naming — it is the vision/judgment tier, not a free tier.)

## The brief

What you type into the composer is parsed (`packages/shared/src/brief.ts`), not merely
forwarded. Nothing here costs a model call — it is all string work, and the composer
screen runs the same parser so it can show you what it understood *before* you spend a
compose on it.

- **A link is read.** Any `http(s)` URL in the brief is fetched, reduced to readable text
  with its structure intact — headings, paragraphs, list items in document order — and
  handed to the copywriter as THE MATERIAL (`apps/api/src/lib/sourceIngest.ts`). "Create a
  carousel based on this blog post <url>" now writes from the post's real headline, real
  structure and best actual lines instead of from the slug. SSRF-guarded by the same gate
  analyze uses, capped, and best-effort: a link that will not load is reported back with
  the reason and the deck is written from your own words.
- **A plan is an order.** The composer's optional slide-plan editor takes one direction per
  slide; a brief that already contains `Slide 1: … / Slide 2: …` is lifted into the same
  shape automatically. A plan fixes the deck exactly: one slide per entry, in that order.
- **Quotes are verbatim.** Anything in `"double quotes"` must appear word for word in the
  slide it belongs to. It survives the copywriter (a corrective re-parse fires if it does
  not), and it is never shortened by a copy budget.
- **The deck length is derived.** With no plan, the count follows the volume of material,
  weighted by kind — your words are already slide-shaped, an article is prose that has to
  be cut down. The old manual stepper is gone.

The same language works on ONE slide: the Studio's *Direct this slide* box rewrites the
selected slide alone from a prompt, honouring quoted copy, leaving the rest of the deck
untouched.

## What the app learns from you

Every post is a small experiment, and until now nobody was recording it. The app
wrote a deck, you quietly cut the headline in half, deleted the tagline and
shipped it — and the next post was written by a copywriter that had never heard
about any of it. The corrections were the most valuable thing in the product and
they evaporated on save.

So the loop is closed, in four deterministic steps:

| Step | Where | What happens |
| --- | --- | --- |
| **Capture** | `apps/api/src/models/Generation.ts` | Every compose stores what made it: the copywriter's USER message, each slide's composer message, the copy parts it wrote and the markup it shipped. (The SYSTEM prompts are not stored — they are identical for every brand and already versioned in the prompt registry.) |
| **Signal** | `apps/api/src/lib/learningLoop.ts` | Saving or exporting a post diffs what shipped against what was generated, **by copy part**, not by markup — so a font size the type floor raised is never mistaken for a person's edit. |
| **Lesson** | `packages/shared/src/learning.ts` | The signal is aggregated until it repeats. A lesson exists only when at least **three** independent corrections agree, and it carries the posts it came from. |
| **Apply** | the parse step | Lessons ride in the copywriter's USER message — and where a lesson is numeric, it moves the copy budget too. A sentence can be ignored; a clamp cannot. |

**No model is involved in any of it.** Every function is arithmetic over strings,
because a learning system that needs a model to decide what it learned cannot be
audited, cannot be tested, and cannot explain itself to the person it is learning
about.

What it can currently learn: a part you consistently **shorten** (with the median
amount), a part you consistently **delete**, a **role** whose slides you keep
cutting, and words you always take out or always put in.

**You can see all of it, and switch any of it off.** The brand screen lists every
lesson with its evidence — the actual before/after of the edits it came from —
and one click stops it being applied. Nothing here re-composes a post or rewrites
a recipe on its own.

### Photographs are never a placeholder

A slide only asks for a photo slot when the brand can actually fill one — the role's
recipe fragment has a hole for it, AND the brand's media library has an unspent picture
whose bytes are really in storage. Composing then attaches the brand's own photographs
(harvested site images first, then uploads; never stock) into the slots it left. An empty
`cb-shot` renders as a dead grey rectangle over a third of the poster, which is strictly
worse than a slide composed as pure type.

## Environment variables

All read from a single `.env` at the repo root (see `.env.example`).

| Var | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection string (default `mongodb://127.0.0.1:27017/contentbuilder`) |
| `API_PORT` / `API_URL` | Express port (default 4000) / its URL (used by the web proxy and exporters) |
| `WEB_URL` | Next.js URL (default `http://localhost:3000`) — CORS origin + what Puppeteer renders against |
| `NEXT_PUBLIC_API_URL` | Optional override for the browser bundle; by default the browser uses the same-origin `/api` proxy |
| `APP_PASSWORD` | Optional shared password. When set it gates **both** the web UI (Basic auth in `apps/web/middleware.ts`) **and** the API (Basic auth in `apps/api/src/app.ts`, exempting `/health` and media reads). Unset = open (local dev). |
| `STORAGE_PROVIDER` / `STORAGE_DIR` | Storage backend (`disk` only for now) + its directory (default `./storage`) |
| `ANTHROPIC_API_KEY` | Optional — unset disables the AI touchpoints as described above |
| `ANTHROPIC_MODEL` | Base model tier (also the "vision configured" requirement) |
| `ANTHROPIC_MODEL_SMALL` | Cheap tier: the per-slide compose + the "AI draft configured" gate (compose/caption routes) |
| `ANTHROPIC_MODEL_FREE` | Vision/judgment tier (vision, captions, photo fit) |
| `ANTHROPIC_MODEL_DESIGN` | Design-critical tier: recipe authoring; falls back down the stack when unset |
| `PEXELS_API_KEY` | Optional — enables the stock-photo search/picker (free at pexels.com/api) |
| `ALLOW_PRIVATE_URLS` | `true` disables the SSRF guard so analyze/harvest may hit private/localhost hosts. Dev only. |

Independent of auth, expensive POST routes (`/analyze`, `/recipe`, `/recipe/candidates`, `/compose`, `/caption`, `/export`) are rate-limited to 30 requests per 5 minutes per IP.

## Getting started

Prerequisites: Node ≥ 20. No system MongoDB needed — `npm run dev` starts a bundled, prebuilt `mongod` (via `mongodb-memory-server`) on `localhost:27017` with a persistent data dir at `.mongo-data/`. Any real MongoDB drops in by pointing `MONGODB_URI` at it.

```bash
cp .env.example .env        # AI keys optional — leave blank to run without AI
npm install                 # installs all workspaces
npm run fonts               # bundle license-clear fonts into apps/web/public/fonts
npm run dev                 # bundled Mongo (:27017) + API (:4000) + Web (:3000)
```

Then, in another shell:

```bash
npm run seed
```

> **`npm run seed` is destructive.** It wipes ALL businesses, brand kits, projects, and media before recreating the demo state. It seeds three real brands — **Apex Auto Detailing**, **Dynatós Program**, and **DetailMasters CRM** — with approved kits (Dynatós and DetailMasters include hand-authored reference recipes).

- Web: http://localhost:3000
- API health: http://localhost:4000/health (reports DB state + which AI paths are configured)

### Migrations

Schema changes are normally tolerated on read (Mongoose strict mode ignores unknown stored fields; zod strips them at the wire boundary), so most old documents need nothing. A migration exists only where ignoring a field would lose data.

```bash
npm run migrate:photos -- --dry-run   # report what would change; writes nothing
npm run migrate:photos                # migrate (honours MONGODB_URI)
npm run media:orphans                 # media records whose file is gone — report only
npm run media:orphans -- --apply      # …and remove the ones nothing points at
```

**`migrate:photos`** retires the pre-photos-layer `slide.mediaAssetId`. A slide's pictures now live in `slide.photos[]` (slot fills / background / free overlays); the single legacy id is folded in as a `background` photo (`fit: 'cover'`), or simply dropped when `photos[]` already declares a background — the array is authoritative. It covers version snapshots too, so restoring an old version keeps its photo. Idempotent: a second run reports zero changes.

## Testing

```bash
npm test                    # vitest, one root config across all workspaces
npm run typecheck
npm run lint
```

- **Unit tests** live next to their sources in `packages/shared/src` (contrast math, formats, recipe schema/gates, type floor, slide motion/photos, schemas) and `apps/api/src/lib` (AI helper, caption, fonts, sanitizers, stock, the legacy-photo migration).
- **Integration suite** — `apps/api/src/routes/routes.integration.test.ts` runs the real Express app against an in-memory Mongo with every AI/Puppeteer boundary mocked. It covers validation → normalization → persistence → response, the foreign-media scrub, the SSRF guard, the rate limiter, recipe candidates/select, and the video-job lifecycle (including cancel).

## Export

**PNG** — `POST /projects/:id/export` renders every slide through the hidden `/render` route with Puppeteer at the project's exact pixel dimensions (the same React renderer the editor uses — what you see is what exports), persists the PNGs through the StorageProvider, and streams a zip (`01.png`, `02.png`, …). Exporting snapshots a version and advances the Desk stage to `shipped`.

**MP4** — `POST /projects/:id/export-video` starts a durable job (`202` + job id; state lives in Mongo, the artifact in storage, so jobs survive a restart). Output is **one clip per slide** — correct for Instagram, where the viewer advances slides — each playing the brand's reveal choreography and then holding the settled composition. Capture is deterministic: CSS animations are paused and the timeline is stepped frame-by-frame at 30fps, then encoded with bundled ffmpeg. The client polls `GET /projects/:id/export-video/:jobId`; the same URL serves the finished download (a lone slide is one MP4, several are a zip). `POST …/cancel` stops a running job within a second or two. Finished artifacts are swept after ~24h.

## The design system contract (the Brand Recipe)

Defined in `packages/shared/src/recipe.ts` (zod schema, versioned — stored recipes are migrated on read). A recipe carries:

- **`tokens`** — ground/ink/accent colors, font families, radius; injected as `--cb-*` CSS custom properties on the slide root.
- **`stylesheet`** — the authored, sanitized brand CSS, scoped to `.cb-slide` and written against the tokens; optionally split into `layers` (background / type / components) so a refinement can rewrite one layer without touching the rest.
- **`components`** — the class vocabulary the composer is allowed to use, each with a one-line purpose. Per slide, the model writes only semantic markup using these classes.
- **`composition.patterns`** — ordered arrangement recipes per slide role, with deterministic variant rotation so posts vary inside the system.
- **`formats`** — per-format vertical overrides (all Instagram formats are 1080px wide; only vertical metrics differ across 1:1 / 4:5 / 9:16).
- **`signature`**, **`typography`**, **`imagery`**, **`surfaces.inverse`**, **`voice`**, **`rationale`** — the recurring signature move, type settings, photo treatment and stock subjects, an optional inverse surface for rhythm, voice do's/don'ts, and why the choices were made.
- **`motion`** — the brand's motion signature for video export: reveal style + pace, optional per-role overrides, ambient drift, and stat count-up.

At render time the app assembles: base type CSS → the authored stylesheet passed through the **type floor** → surface CSS → the photo/media layer — and the **contrast gate** has already repaired any illegible tokens. Kit edits and recipe knobs re-point tokens without re-authoring, so the kit stays the single source of truth.
