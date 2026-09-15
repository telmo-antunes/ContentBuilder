/**
 * POSTER SIZE — the ceiling that fills the frame.
 *
 * The type floor stops a headline shrinking below what a phone can read. It
 * never said what a headline should do with a frame it does not need: a
 * statement carrying eight words and nothing else rendered at the floor,
 * anchored low, and left three-quarters of the canvas empty. That passed
 * every gate — the slack limit for display roles allows 65% — and it is the
 * slide the owner pointed at.
 *
 * So the app owns two larger headline sizes, `lg` and `xl`, per canvas, the
 * way it owns `.sm` through the recipe: the render check climbs to them when a
 * bare headline-led slide measures sparse, and steps back down if the bigger
 * setting overflows or runs past three lines. Sized per format because the
 * canvases differ in height, not in width.
 */
export const POSTER_HEADLINE_PX: Record<string, { lg: number; xl: number }> = {
  '1080x1350': { lg: 124, xl: 152 },
  '1080x1920': { lg: 136, xl: 168 },
  '1080x1080': { lg: 104, xl: 120 },
};

/** Roles whose slide is led by its headline, and so may be set at poster size. */
export const POSTER_ROLES: ReadonlySet<string> = new Set(['statement', 'cover', 'cta']);

/**
 * A frame this empty, on a poster role, is a headline set too small. Slack is
 * the LARGEST empty band, and a centred one-liner splits its emptiness into
 * two bands of ~30% each — so the threshold sits below 40%, and the
 * measurement after the climb (fits, three lines at most, less slack than
 * before) is what actually decides.
 */
export const POSTER_SLACK = 0.3;

export function slidePosterCss(format: string): string {
  const px = POSTER_HEADLINE_PX[format] ?? POSTER_HEADLINE_PX['1080x1350']!;
  // Doubled `.headline.headline` to outrank the brand's own `.headline` and its
  // per-format override without depending on order; `.sm` stays the brand's.
  return [
    `.cb-slide .headline.headline.lg{font-size:${px.lg}px;line-height:1.02}`,
    `.cb-slide .headline.headline.xl{font-size:${px.xl}px;line-height:.98;letter-spacing:-.02em}`,
  ].join('\n');
}
