# ContentBuilder

A local content agent for discussing ideas, using website inspiration, creating slides, reviewing them and exporting PNGs. Every slide change starts as an explicit proposal.

## Run

Use Node 22.12 or newer.

```sh
npm install
cp .env.example .env  # only for a new installation; keep an existing .env
# Set ANTHROPIC_API_KEY in .env; optionally set ANTHROPIC_MODEL as the default.
npm run dev
```

Open http://localhost:3000. The server binds to the local computer only. Choose an available Claude model independently for website analysis, generation and revisions. The lists come from your configured Anthropic provider and are cached for five minutes; new drafts use Latest Sonnet for analysis/rephrasing/chat, Latest Haiku for autocomplete, and Latest Opus for generation/revision. Latest-category choices resolve against the provider catalog at request time and never switch tiers. You can still pin an individual version; the optional ANTHROPIC_MODEL supplies the legacy configured-default choice. Explicitly unsupported choices are disabled. There is no database service or separate API server.

## Conversation

The workspace opens in **Conversation**. Ask for ideas, attach reference images, discuss a selected slide, or describe the result you want. The agent receives the current brief, active numbered directions, website notes, rendered slides, uploaded images, and recent conversation. It can ask a focused clarification question or offer alternatives with selectable replies; free-text answers work too. **Agent settings** selects its model independently (Latest Sonnet by default).

Creating, revising, reordering, duplicating, deleting, undoing and redoing slides always require **Apply proposal**. You can explore alternatives or dismiss a proposal. Discussing a change does not apply it. Proposals that refer to a changed deck, brief, model, reference or selected slide cannot be applied until the context matches or the agent makes a new proposal. A proposed main-brief rewrite also requires approval and shows a wording diff.

Website analysis, render inspection and PNG preparation can run directly when requested. Results return to the conversation. The agent can chain up to five read-only steps per reply; each proposed mutation pauses for approval. It cannot publish posts, send messages, change model settings, or perform arbitrary web research. Website analysis remains its browsing tool.

Messages, pending proposals, the unsent message and attachments save with the draft and portable files. The latest 100 messages are retained; each reply receives the latest 30, up to eight recent uploaded references, a deck contact sheet and the selected slide. Reloading keeps pending proposals; an unanswered saved message offers **Resume reply**. Requests can be stopped and failed actions do not retry automatically. The original instruction fields are preserved unless you explicitly apply a brief rewrite. Approved conversational direction is sent alongside the original brief; newly generated decks retain it for later revisions.

## Brief & settings

The detailed controls remain available in the **Brief & settings** tab:

1. Optionally enter a public website and click **Analyze**. The app samples up to three sections, extracts text, colors, fonts, logos and photos (including CSS backgrounds), prioritizes logos and larger images, then writes an editable inspiration note. Open the reference to choose which images the model may use and inspect larger previews, dimensions and descriptions. Selections of up to four images reach the model as individual 500 × 400 previews; larger selections use labeled contact sheets. Usable original images are retained locally when available (up to 5 MB per image and 24 MB per analysis). Analyzing another website adds a separate reference; analyzing the same URL refreshes it. Each reference has independent notes and image selection. Inline SVG/text header wordmarks are retained as rendered PNG assets when detected.
2. Write your instructions. Specify exact copy, slide count, each slide's layout, or leave those decisions open. Optionally enable **Give instructions per slide**, add free-text fields, and choose the slide number for each. You can direct slides 1 and 4 and leave 2 and 3 to the model; the fields do not set a fixed total slide count. Keep general direction in the main brief and slide-specific text in the numbered fields; there is no need to duplicate it. The main brief can set the total. Specific slide instructions take priority for their slide, and you can generate using only these fields. Blank fields are ignored. Turning the option off keeps your notes for later but excludes them from generation. Choose the canvas dimensions.
3. Choose the **Generation model** (or keep the configured default), then click **Create with the agent** (or **Discuss a new version**). Review its proposal and apply it. The generation model writes a complete deck of standalone HTML/CSS slides in one call.
4. Select a slide, choose the **Revision model** if desired, and describe a revision. Choose that slide or the whole deck, click **Discuss this change**, and apply the resulting proposal. The revision includes a render of the selected slide, or contact sheets for a whole deck. **Compare previous** lets you inspect the prior version; **Undo last change** and **Redo last change** prepare proposals to restore or reapply it, including after a reload. Revision text, scope, target and pending reference images also survive reloads. **Add reference images** beneath the revision input accepts up to eight PNG, JPEG or WebP files (10 MB / 40 megapixels each). The model sees optimized image previews and can place the retained originals when requested; the canvas size stays fixed. Thumbnails can be opened or removed. Attachments clear after a successful revision, remain after a failed or stopped attempt, and are recorded under **Creation flow → Inputs used**. Pending and historical attachments travel with portable drafts. Revisions use the brief saved with the deck; the saved numbered directions travel with it too. If you edit the main brief or per-slide instructions, a checkbox explicitly opts into using the edited generation instructions for the revision. Manual slide moves, duplication and deletion keep saved directions associated with their slides; Undo/Redo restores that context. Older decks without a saved brief use the current main brief and show that limitation. Thumbnails and Fit / 100% zoom help review the result.
5. **Download PNGs** renders the version you are viewing at its original pixel dimensions and downloads a ZIP. While comparing, the title, count, canvas dimensions and export all refer to the previous version. **Slide actions** offers reorder, duplicate, delete (with Undo), and a single-slide PNG download. Arrow keys and Home/End navigate the focused thumbnail strip.
6. Generation runs informational render checks for missing assets, failed fonts and possible clipped text. Open the review notes or use **Check slides** to refresh them. Intentional text crops and transformed text can be flagged. Diagnostics never change HTML, rewrite copy or impose a design score.
7. Open **Creation flow** above the preview for the live stage timeline, actual inputs, requested and reported model, timings and token usage. The last ten actions include successful, failed and cancelled runs. This is an event log of engine work; it adds no planning calls. Each completed run accepts optional instruction/copy/layout feedback and a note. Feedback saves with the run’s inputs, measurements and available output. The newest output and annotated outputs are retained within the last ten runs; older unannotated output snapshots are discarded. Save a portable draft before old runs leave the bounded history.
8. The **Draft** menu saves and opens portable JSON bundles containing the workspace, both history slots, revision draft and retained image files. Opening validates the whole bundle before replacing anything; replacing existing work asks for confirmation. Portable files support up to 40 MB of embedded assets / 64 MB total.

The current brief, reference, deck, Undo/Redo history, pending revision, agent conversation and attachments, writing conversation, generating brief, last applied instruction, per-action model choices and recent activity save automatically to `.data/workspace.json`. Website screenshots, thumbnails and retained original images are stored once by content hash in `.data/assets/`; the draft contains small image references. The asset cache is retained when starting or resetting drafts.

**New draft** starts a new deck while keeping the website inspiration, canvas size and model choices. **Reset all** clears both the draft and its reference. Canvas changes apply to a new generation; revisions keep the current deck's dimensions.

Opening a tab does not write anything. Saves are debounced and coalesced; each uses the version it loaded. If another tab saved first, the stale write is rejected. The local draft stays on screen so you can save a portable copy before loading the latest saved version. A text-only recovery download remains available if image bundling fails. Pending edits also get a versioned browser-local backup after 100 ms and when the page becomes hidden. On reopening, recovery is offered explicitly instead of silently overwriting the saved workspace. Browser storage limits or unavailable storage are reported; this is a recovery aid, not a guarantee against losing the final keystroke. The version guard assumes one running app process using this data directory.

Operations show real phases, elapsed time and **Stop**, while existing slides remain browsable. Stopping leaves the current deck unchanged and aborts the model/render work. **Creation flow** shows each recorded stage and its duration, the exact brief and per-slide directions used, website notes and image URLs, revision scope, outcome, requested/reported model, input/output tokens, cache reads/writes, model time, rendering time and reused slide renders. Activity persists on completion, failure or cancellation; reloading an active request is warned against. Website contact-sheet preparation is included in total duration; rendering time measures slide capture/check work. Cancelled requests may have incomplete usage totals.

## Writing assistance

The main description has **Autocomplete** enabled by default. After you type at least eight characters and pause for 1.2 seconds, it requests a short continuation at the cursor. Press **Tab** or click **Accept continuation** to insert it; **Esc** dismisses it. Editing, selecting text, leaving the field, composition input, or starting a main action cancels pending suggestions. Suggestions never insert themselves. Turn the checkbox off to stop automatic requests; that preference survives a new draft.

**Suggest rephrasing** reviews grammar and clarity. A word-level comparison shows additions and removals, with changed numbers, quoted wording and slide counts highlighted. Review and edit its proposed wording, then choose **Use this wording**. Rephrasing that drops quoted copy is rejected. New edits disable older proposals so they cannot overwrite newer work. **Undo accepted wording** restores the preceding description while the applied text is still unchanged.

Use **Conversation** for clarification, creative alternatives and proposed brief rewrites. Earlier writing-assistant messages remain saved and available to the agent as context.

**Writing assistant models** selects separate autocomplete and rephrasing models from the configured provider. These text-only actions require structured-output support, not vision. Autocomplete uses a small output budget, debounces typing, cancels superseded requests, and does not retry automatically. Usage shows requests, outcomes and reported tokens for the current draft, counted once per request even when stream events repeat totals. Three consecutive failures pause autocomplete until you resume it. Failed, stopped and interrupted requests can have incomplete usage; these are not billing totals. Each typing-pause request can incur provider usage. Rephrasing and chat run only on request. Model suggestions still need review for intent and factual accuracy.

## Engine

The generation path is deliberately small:

- `src/lib/content-agent.ts` and `useContentAgent.ts`: contextual conversation, validated actions, proposals and explicit approval.
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
