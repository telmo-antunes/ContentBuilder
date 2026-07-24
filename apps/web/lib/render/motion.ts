/**
 * The MOTION layer for animated (video) export — a generic reveal choreography
 * that plays on top of ANY brand recipe. It keys off the recipe's conventional
 * component classes (eyebrow, headline, tagline, …), so every brand animates
 * on-brand without per-brand authoring. Injected only in "motion mode"
 * (AuthoredSlide motion prop); the still PNG export is unaffected.
 *
 * Later (M4) a recipe can carry its own `motion` signature that overrides this.
 *
 * Timing note: the total reveal lands by ~1.9s; the video capture holds a beat
 * after that. Keep delays here in sync with MOTION_DURATION_MS below.
 */

/** How long one slide's motion runs before it settles (ms) — the capture window. */
export const MOTION_DURATION_MS = 2600;

export const MOTION_CSS = `
/* NOTE: do NOT add a base \`opacity: 0\` here. \`animation-fill-mode: both\`
   already applies the keyframe's \`from\` state during the delay (backwards
   fill), and a redundant base opacity leaks into the PAINTED output when the
   animation is paused + seeked for frame capture — computed style reports 1
   while the element renders blank. That silently dropped elements from
   exported video frames. */
.cb-slide.cb-motion > * { animation: cb-rise 0.72s cubic-bezier(0.16,1,0.3,1) both; }
.cb-slide.cb-motion > .fill { animation: none; }
.cb-slide.cb-motion .logo,
.cb-slide.cb-motion .logo-row,
.cb-slide.cb-motion .wordmark { animation-delay: 0.12s; }
.cb-slide.cb-motion .eyebrow { animation-delay: 0.34s; }
.cb-slide.cb-motion .headline { animation-delay: 0.52s; }
.cb-slide.cb-motion .stat { animation-delay: 0.66s; }
.cb-slide.cb-motion .rule { animation-delay: 0.74s; }
.cb-slide.cb-motion .quote { animation-delay: 0.5s; }
.cb-slide.cb-motion .tagline,
.cb-slide.cb-motion .body,
.cb-slide.cb-motion .panel { animation-delay: 0.92s; }
.cb-slide.cb-motion .attr { animation-delay: 1.1s; }
.cb-slide.cb-motion .cta { animation-delay: 1.2s; }
.cb-slide.cb-motion .handle { animation-delay: 1.4s; }
@keyframes cb-rise { from { opacity: 0; transform: translateY(28px); } to { opacity: 1; transform: none; } }
/* the accent-emphasis word warms in a beat after its headline lands */
.cb-slide.cb-motion .headline .em,
.cb-slide.cb-motion .headline .it { display: inline-block; animation: cb-accent 0.8s ease-out 1.0s both; }
@keyframes cb-accent { from { opacity: 0.25; filter: saturate(0.4); } to { opacity: 1; filter: none; } }
`.trim();
