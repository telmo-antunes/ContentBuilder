# ContentBuilder

Internal web app that generates on-brand Instagram promotional assets — **carousels** (swipeable, ordered multi-slide posts) and **stories** (independent full-screen frames) — for any business.

Coherence comes from a constrained layout library + a single brand type scale, **not** from AI. The app runs fully end-to-end with **zero AI calls**; AI is an optional accelerator used in two one-time places only.

## What it does

1. **Brand kit** — derive a kit from a business's website (Puppeteer screenshot + pixel-sampled palette + computed fonts mapped to bundled fonts + DOM logo), or enter one manually. Every kit is a **draft until a human approves it**.
2. **Build a project** — pick a business (with an approved kit), choose carousel or story and a compatible format, then build slides in a **bounded editor**: pick a layout archetype, add/reorder/edit typed copy blocks, attach images with a focal point. Start empty, **paste shorthand** (deterministic, free), or **draft from a paragraph** (optional AI).
3. **Export** — render every slide to a pixel-correct PNG (the same React layouts power the editor preview *and* the export) and download a ZIP.

**Constraint is the feature:** slides are React components from a fixed 7-layout library, parameterized by `{ brandKit, blocks, image, format }` — never freehand HTML. A brand-driven type scale + WCAG contrast + bounded text-fit keep every slide coherent.

### AI is optional (two one-time calls)
- **Brand role/vibe** — one vision call per business (downscaled screenshot + sampled hexes → color roles + a style descriptor), cached on the kit.
- **Draft from a paragraph** — one opt-in text call per project (paragraph + format only, never the brand kit).

With `ANTHROPIC_API_KEY` unset, both buttons disable and everything else (manual build, shorthand, starter templates, render/export) works unchanged.

## Monorepo layout

```
apps/web        Next.js (App Router, TS) — UI + a hidden /render route for PNG export
apps/api        Express backend (TS) — Anthropic calls, Puppeteer, Mongo, zip
packages/shared Shared types: BlockType, LayoutType, formats, fonts, data model
scripts/        Dev helpers (bundled Mongo launcher, font bundler)
```

## Prerequisites

- Node ≥ 20
- A MongoDB available at `MONGODB_URI`.
  - **Local dev (default):** `npm run db` starts a bundled, prebuilt `mongod`
    (via `mongodb-memory-server`) on `localhost:27017` with a persistent data
    dir at `.mongo-data/`. No system install needed.
  - **Any real MongoDB** (Homebrew service, Atlas, …) drops in with no code
    change — just point `MONGODB_URI` at it and skip `npm run db`.

> Note: Homebrew's `mongodb-community` has no prebuilt bottle for this macOS
> version and building from source requires a newer Xcode, which is why local
> dev uses the bundled binary. The data-layer contract is just `MONGODB_URI`.

## Setup

```bash
cp .env.example .env        # AI keys optional — leave blank to run without AI
npm install                 # installs all workspaces
npm run fonts               # bundle license-clear fonts into apps/web/public/fonts
```

## Run

```bash
npm run dev                 # starts: bundled Mongo + API (:4000) + Web (:3000)
```

Then in another shell, seed sample data:

```bash
npm run seed                # 1 business + 1 approved brand kit + carousel + story
```

- Web: http://localhost:3000
- API health: http://localhost:4000/health

## Environment variables

| Var | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection string |
| `API_PORT` / `API_URL` | Express service port / public URL |
| `WEB_URL` | Next.js URL (CORS origin) |
| `NEXT_PUBLIC_API_URL` | API URL exposed to the browser bundle (mirror `API_URL`) |
| `STORAGE_PROVIDER` / `STORAGE_DIR` | Storage backend (`disk`) + local dir |
| `ANTHROPIC_API_KEY` | **Optional.** Absent ⇒ AI buttons disable |
| `ANTHROPIC_MODEL` | **Optional.** Vision model — brand role/vibe pass |
| `ANTHROPIC_MODEL_SMALL` | **Optional.** Text model — draft-from-paragraph |

## Key routes

- `/` — businesses (list / add / edit / delete)
- `/businesses/:id` — business detail + projects
- `/businesses/:id/brand-kit` — analyze / manual entry → approval & edit screen
- `/projects/new` — create (empty · shorthand · AI draft) + starter templates
- `/projects/:id` — bounded slide editor + Export ZIP
- `/gallery` — dev gallery of all 7 layouts across formats (no DB/AI)
- `/render?projectId=&slideId=` — hidden chrome-less route used by PNG export

## Build order (milestones) — all complete ✅

1. **Scaffold** — monorepo, web, api, Mongo, StorageProvider (disk), bundled fonts, seed, health.
2. **Businesses CRUD** + UI.
3. **Layout library** (7 components) + brand type scale + text-fit/contrast + dev gallery.
4. **Bounded editor** + manual project (live previews, autosave).
5. **Render & export** — hidden render route + Puppeteer PNG capture + ZIP.
6. **Brand extraction** (hybrid) + mandatory approval screen + manual fallback.
7. **Shorthand parser** (deterministic) + cheatsheet + starter templates.
8. **Optional AI draft-from-paragraph** (Haiku, opt-in, allowlist-validated).
9. **Polish** — focal-point control, consent handling, export feedback, error/empty states, caps, fail-soft.

> A design pass between M4 and M5 upgraded both the generated-post layouts and the app interface.
