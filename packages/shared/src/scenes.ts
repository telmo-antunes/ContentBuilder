/**
 * SCENES — a slide that acts its claim out, as a short sequence of states.
 *
 * The website's /crm and /about pages have sixteen of these: a booking lands,
 * a reminder goes out, a message is written and approved. They run on a
 * `setTimeout` clock and framer-motion springs, which is right for a page and
 * useless to a frame-by-frame export — a headless capture gets whatever frame
 * the wall clock reached. The reels render perfectly because every frame is a
 * pure function of time, and they have no authoring surface at all.
 *
 * This is the same step model with a seekable clock under it. The markup says
 * which steps an element belongs to; the maths here says, for any time, how
 * present that element is. Nothing stateful, nothing timed: `presenceAt(t)` is
 * the whole runtime, so the exporter can ask for frame 311 before frame 3.
 *
 *   <div data-cb-steps="2.8 2.4 2.6">            durations, in seconds
 *     <div class="row" data-cb-step="0 1">…</div>  on screen during steps 0 and 1
 *     <div class="panel" data-cb-step="1 2">…</div>
 *     <div class="cta" data-cb-step="2">…</div>
 *     <div class="eyebrow">…</div>                 no attribute: every step
 *   </div>
 *
 * Space-separated rather than comma-separated on purpose: `[data-cb-step~="2"]`
 * is a CSS token match, which is how the STILL export shows the rest step
 * without any script at all.
 */

export const STEP_ATTR = 'data-cb-step';
export const STEPS_ATTR = 'data-cb-steps';

/** Twelve states is already a film; past that it is a different product. */
export const MAX_STEPS = 12;
export const MIN_STEP_SECONDS = 0.3;
export const MAX_STEP_SECONDS = 12;

/** Content swaps the way the reels and the website both do them. */
export const SCENE_EXIT_MS = 120;
export const SCENE_ENTER_LAG_MS = 60;
/** Apple's morph spring: response 0.45 s, damping 0.86. */
export const SCENE_SPRING = { response: 0.45, damping: 0.86 } as const;

const STEP_LIST_RE = /^(?:\d|1[01])(?: (?:\d|1[01]))*$/;

/** `"0 1"` → true. Validated at author time because it ends up in a selector. */
export function isStepList(value: string): boolean {
  return STEP_LIST_RE.test(value.trim());
}

export function parseStepList(value: string): number[] {
  if (!isStepList(value)) return [];
  return [...new Set(value.trim().split(' ').map(Number))].sort((a, b) => a - b);
}

/** `"2.8 2.4 2.6"` → true when every hold is a sane length and there are not too many. */
export function isStepDurations(value: string): boolean {
  const parts = value.trim().split(/\s+/);
  if (parts.length < 1 || parts.length > MAX_STEPS) return false;
  return parts.every((p) => {
    if (!/^\d+(?:\.\d+)?$/.test(p)) return false;
    const n = Number(p);
    return n >= MIN_STEP_SECONDS && n <= MAX_STEP_SECONDS;
  });
}

export function parseStepDurations(value: string): number[] {
  return isStepDurations(value) ? value.trim().split(/\s+/).map(Number) : [];
}

/**
 * The step durations a fragment declares, or null when it is not a scene. A
 * regex rather than a DOM parse, like `authoredSlots`: this runs on the server
 * to validate what was authored and in the browser to drive the clock.
 */
export function sceneSteps(html: string): number[] | null {
  if (!html) return null;
  const m = new RegExp(`${STEPS_ATTR}="([^"]*)"`).exec(html);
  if (!m) return null;
  const d = parseStepDurations(m[1] ?? '');
  return d.length ? d : null;
}

export function isScene(html: string): boolean {
  return sceneSteps(html) !== null;
}

/** The one frame that tells the whole story: the last step, unless told otherwise. */
export function restStep(durations: readonly number[]): number {
  return Math.max(0, durations.length - 1);
}

export function sceneTotalMs(durations: readonly number[]): number {
  return Math.round(durations.reduce((a, b) => a + b, 0) * 1000);
}

/** Closed-form damped step response — the same spring the reels run on. */
export function springStep(x: number, response: number, damping: number): number {
  if (x <= 0) return 0;
  const w = (2 * Math.PI) / response;
  if (damping >= 1) return 1 - Math.exp(-w * x) * (1 + w * x);
  const wd = w * Math.sqrt(1 - damping * damping);
  return 1 - Math.exp(-damping * w * x) * (Math.cos(wd * x) + ((damping * w) / wd) * Math.sin(wd * x));
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export interface ScenePresence {
  /** 0 = absent, 1 = fully there. */
  opacity: number;
  /** How far through its entrance, 0–1 (drives the rise). */
  enter: number;
  /** How far through its exit, 0–1 (drives the blur and shrink). */
  exit: number;
}

/**
 * How present an element belonging to `steps` is at time `tMs`.
 *
 * Contiguous steps are merged first, so an element that lives through steps
 * 1 and 2 does not leave and re-enter at their boundary — it simply stays.
 * Exit runs SCENE_EXIT_MS from the boundary; the next entrance starts
 * SCENE_ENTER_LAG_MS after it, on its own spring. Past the end of the scene
 * the last step holds, which is what the exporter's settled frame wants.
 */
export function presenceAt(tMs: number, durations: readonly number[], steps: readonly number[]): ScenePresence {
  const none = { opacity: 0, enter: 0, exit: 0 };
  if (!durations.length || !steps.length) return none;
  const bounds: number[] = [0];
  for (const d of durations) bounds.push(bounds[bounds.length - 1]! + d * 1000);
  const total = bounds[bounds.length - 1]!;
  const t = Math.min(tMs, total - 1e-6);

  // merge the element's steps into intervals
  const sorted = [...new Set(steps.filter((s) => s >= 0 && s < durations.length))].sort((a, b) => a - b);
  const spans: Array<[number, number, boolean]> = []; // start, end, endsAtSceneEnd
  for (const s of sorted) {
    const last = spans[spans.length - 1];
    if (last && last[1] === bounds[s]) { last[1] = bounds[s + 1]!; last[2] = s === durations.length - 1; }
    else spans.push([bounds[s]!, bounds[s + 1]!, s === durations.length - 1]);
  }

  let best: ScenePresence = none;
  for (const [a, b, holds] of spans) {
    if (t < a) continue;
    const lag = a === 0 ? 0 : SCENE_ENTER_LAG_MS;
    const enter = clamp01(springStep((t - a - lag) / 1000, SCENE_SPRING.response, SCENE_SPRING.damping));
    let exit = 0;
    if (!holds && t >= b) { exit = clamp01((t - b) / SCENE_EXIT_MS); exit = exit * exit * (3 - 2 * exit); }
    const opacity = enter * (1 - exit);
    if (opacity > best.opacity) best = { opacity, enter, exit };
  }
  return best;
}

/**
 * The still export's view of a scene: the rest step, by CSS alone. Elements in
 * other steps are removed from the flow so the composition measures as it
 * will be read, not as a stack of every state at once.
 */
export function sceneStillCss(scope: string, rest: number): string {
  return [
    `.${scope} .cb-slide [${STEP_ATTR}]{display:none}`,
    `.${scope} .cb-slide [${STEP_ATTR}~="${rest}"]{display:revert}`,
  ].join('\n');
}

/**
 * In motion mode the clock owns every stepped element's entrance, so the
 * recipe's `cb-enter` reveal must not also run on them — two springs on one
 * element is a stutter.
 */
export function sceneMotionCss(scope: string): string {
  return `.${scope} .cb-slide.cb-motion > [${STEP_ATTR}]{animation:none}`;
}
