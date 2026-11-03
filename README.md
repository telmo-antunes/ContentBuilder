# ContentBuilder

A local tool for making Instagram posts: describe the post, get slides, change them by asking, download PNGs. Slide changes apply immediately and can be undone.

## Run

Use Node 22.12 or newer.

```sh
npm install
cp .env.example .env  # only for a new installation; keep an existing .env
# Set ANTHROPIC_API_KEY in .env; optionally set ANTHROPIC_MODEL as the default.
npm run dev
```

Open http://localhost:3000. The server binds to the local computer only. Choose an available Claude model independently for website analysis, generation and revisions. The lists come from your configured Anthropic provider and are cached for five minutes; new drafts use Latest Sonnet for analysis/rephrasing/chat, Latest Haiku for autocomplete, and Latest Opus for generation/revision. Latest-category choices resolve against the provider catalog at request time and never switch tiers. You can still pin an individual version; the optional ANTHROPIC_MODEL supplies the legacy configured-default choice. Explicitly unsupported choices are disabled. There is no database service or separate API server.

## Using it

A post moves through three views.

1. **Compose (three beats).** *Say it*: what the post is about, with optional images, a link to read, and the format (Post 4:5, Square, Story 9:16). *Shape it* (optional): how many slides, and instructions for any slide; slides left empty are designed freely. *Make it*: a storyboard of what will be made, the polish switch, and **Create the post**. "Create now" on the first beat skips the shaping.
2. **Conversation.** Your request becomes the first message and the slides stream into a version card. Every change adds a new card (v2, v3…); older cards can be brought back. Type in the bar to ask or change anything. Tap the speech bubble on a slide to aim the next change at that slide: an aimed change revises only that slide, directly, without an agent call; an aimed question still goes to the agent.
3. **Review (stage).** **Review** on the current card (or in the top bar) opens the post full size, framed the way Instagram shows it, with the filmstrip, slide menu, caption, versions, undo and **Download**. "‹ Conversation" goes back.

- **Rearrange:** drag thumbnails, or use the slide menu (•••) to move, duplicate, delete or download one slide. These are instant and never call the model.
- **Undo:** every change shows a toast with Undo; the top bar has Undo and Redo, and holding the eye button shows the version before. Up to 15 versions are kept.
- **Download:** the Download button renders PNGs at full size and saves a ZIP named after the post.
- **Settings** (sliders button) holds the format, websites the agent learned from (notes and which images it may use), the brief for this post, AI models, render checks, and saving or opening a portable copy.
- **Watch it being made:** slides appear one by one as the model writes them. A polish pass then looks at the result at phone size and fixes clipped text, small type and weak contrast (switch it off in Settings).
- **Caption:** every post comes with its Instagram caption, hashtags, a first comment and alt text per slide. Tap the caption under the post to edit, rewrite (on the small model) or copy them; the ZIP includes `caption.txt`.
- **Options:** the slide menu's "Show me 3 options" (or the grid button on a slide in a version card) designs three alternatives for that slide; tap one to use it.
- **Brands:** "Posting as" in Compose (or Settings) switches between brands. Each keeps its own kit, websites, lessons and pinned inspiration.
- **Drafts:** New post sets the current post aside in Drafts (`.data/drafts/`, newest 40 kept), with Undo. Opening a draft swaps it with the post on screen.
- **Retry:** a failed step in the conversation has a Try again button that re-runs it; if a post comes back with a different slide count than you chose, a button offers the fix.
- **Cost:** Settings shows what the AI calls cost for this post and in total, estimated from each call's tokens at list prices.
- **Story or feed version:** the slide menu re-flows the post into a 9:16 story (or back into a feed post) as a new version. The agent can also do it ("make a story version") and change the format for the next post.
- **Versions:** the clock button lists up to 15 earlier versions; tap one to return to it, and come forward again the same way.
- **Brand kit** (Settings): handle, colours, fonts, voice, logo and always/never rules that every post follows and that survive "New post". Learning a website fills the empty fields. Revisions that state a lasting preference ("never say cliente") are saved as lessons; remove any you don't want.
- **Pinned inspiration** (Settings, or the pin on an attached image): images whose look every post learns from, without copying their content.
- **Articles:** when the link you give is an article, its text becomes the post's content source.

Changes happen straight away (direct mode); the agent decides whether a message is a question, a new post or a revision, and runs the action. Turn on **Ask before changing slides** in Settings to get a proposal to approve first. The agent can chain up to five read-only steps (website analysis, checks) per message and runs at most one slide change.

## Engine

The generation path is deliberately small:

- `src/lib/content-agent.ts` and `useContentAgent.ts`: contextual conversation and validated actions, applied directly or as proposals.
- `src/app/page.tsx` and `src/app/studio/`: the Stage interface (post preview, command bar, sheets).
- `src/lib/analyze.ts`: capture the website and describe its identity as inspiration.
- `src/lib/ai.ts`: send the **original brief unchanged**, optional website evidence, and (for revisions) the current deck. The system prompt lives here, in plain text.
- `src/lib/document.ts`: isolate active browser content while preserving static HTML, CSS, SVG and copy.
- `src/lib/render.ts` and `export.ts`: capture the same sandboxed document for visual revisions and PNG export.
- `src/lib/operation.ts`: stream progress and usage, and propagate cancellation.
- `src/lib/storage.ts`: check the expected version and atomically save one JSON file.
- `src/lib/useWorkspace.ts`: coalesce edits without saving unchanged loaded drafts.

The model's structured output is `{ title, slides: [{ html }] }`. Only this transport envelope is constrained; the HTML strings have no design schema. The deck stores its generating brief, numbered slide directions, and a map of the retained image versions it uses. Preview, checks, revisions and export resolve those same originals without rewriting authored HTML. A bounded 64 MB / 100-entry in-memory cache reuses contact sheets and slide captures by HTML, canvas, renderer version and asset hashes. Captures with remote image/font resources expire after 30 seconds; self-contained captures and reference sheets expire after ten minutes. Failed asset loads are not cached, and **Check slides** bypasses the capture cache. Stable website reference blocks use explicit prompt caching when the provider's minimum token threshold is met. The original brief and latest instructions follow the cached prefix. Analysis models must support vision; generation and revision models must also support JSON-schema structured outputs. Saved choices are resolved against the provider, and an unavailable explicit choice returns an error without switching to the default. No slide roles, brand recipes, component vocabulary, fragment library, copy parser, text shortening, type floors, palette enforcement, scoring, learning loop, automatic repair, or template fallback remains. Website identity is optional context; explicit user instructions take priority. Invalid model output returns an error and leaves the current deck unchanged.

Model compliance still depends on the model. A new generation that omits an explicitly directed slide returns an error. Beyond that structural check, the app does not claim to guarantee a requested total slide count or exact wording; it passes those directions through without converting them into a restrictive intermediate format.

## Technical boundaries

Slides are static documents. Scripts, event handlers, embedded pages, metadata redirects and base URLs are removed; the iframe sandbox and content policy disable executable content and forms. Layouts, colors, CSS selectors, type sizes, inline SVG and visual choices are left alone. HTTPS images and fonts are allowed. Retained image originals travel with portable drafts. Fonts and images that could not be retained still depend on the source website; missing image elements stop export with an explicit error. Background-image and font availability may still depend on the source site.

Public website requests and export resources reject private network addresses. Website analysis uses an isolated browser context and checks redirected requests. This is a local tool, not a hardened multi-user hosting service. Do not expose it publicly without adding authentication and network-level egress controls.

Canvas dimensions are 200–2400 px per edge and JSON request payloads are limited to 8 MB to bound browser memory. Reference-image uploads have a separate 10 MB limit per file. Slide generation reserves up to 64,000 output tokens (bounded by the provider model’s limit), including reasoning and HTML. Supported models use medium effort for slides. Writing assistance uses low effort for autocomplete and medium for rephrasing/chat; Haiku 5.5 disables thinking and Sonnet 5.5 uses its documented between-tools mode for these short interactive actions. Full model streams have deadlines: ten minutes for slide generation/revision, five minutes for website analysis, 90 seconds for rephrasing/chat, and 20 seconds for autocomplete. First-output latency, reported reasoning tokens, effort and model time are recorded separately from render time. A response-start event and explicit thinking blocks update the visible stage without exposing reasoning text. A failure never silently switches models or substitutes a template.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm start
```

Tests also verify proposal requirements, stale-context invalidation, clarification stopping, image context, legacy conversation defaults, and portable conversation attachments. Tests cover untouched instructions and visual choices, selected image references, rendered revision context, isolated one-slide revisions, malformed-output errors, version conflicts, legacy draft loading, asset externalization, streamed progress/cancellation, network chunk boundaries, browser isolation, private URL rejection, and real Chromium PNG/ZIP export at exact dimensions. Coverage also includes portable restoration into a clean directory, tampered assets, pending browser recovery, Undo/Redo, generating-brief and per-slide-direction retention, sparse instructions, duplicate targets, portable per-slide drafts, model routing and capability checks, model-discovery outages, bounded activity history, clipped text, failed fonts, offline originals, and cache invalidation. The test suite makes no paid AI calls.

## Output quality benchmark

With the app running, explicitly run:

```sh
npm run benchmark -- --name baseline
npm run benchmark -- --name candidate --compare baseline
# Recheck saved HTML with the current renderer, without model calls:
npm run benchmark -- --name render-review --replay baseline --compare baseline
```

Normal runs use the configured paid model. The six fixed cases cover exact copy, unusual composition, overriding website identity, a narrow revision with an unrelated edited brief, a whole-deck revision, and dense copy. Use `--case exact-copy` (or another case ID from `benchmark.mjs`) for a focused run. Results never touch the saved workspace.

Each run writes PNGs, `results.json` with instructions/model/usage/timings and mechanical checks, and `review.html` in `.data/benchmarks/<name>/`. Names cannot overwrite an existing run. Open the review URL printed by the command (or the saved HTML file). The report compares renders side by side and provides explicit human judgment fields with a downloadable `judgments.json`. Ratings start **unreviewed**; record your assessment before changing prompts. Mechanical checks inspect rendered text and slide counts; they cannot establish overall design quality. The two verbatim-copy cases are case-sensitive; other cases allow typographic capitalization. Replays identify their source and make no model call.

The reset removed the previous applications and shared package, Mongo data, stored brands/projects/uploads/exports, recipe systems, reference collections, audit reports, experiments and old worktrees. Git history remains; the working app starts empty.
