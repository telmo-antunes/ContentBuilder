import type { BrandLayout } from '@contentbuilder/shared';

/**
 * Deterministic guard: drop "rule"/"divider" decorations that don't physically
 * sit against a text block — a floating accent shape reads as a mistake, and the
 * prompt alone doesn't reliably prevent it. Logos + scrims are positioned by
 * design and always kept. Pure + unit-testable.
 */
export function pruneFloatingDecorations<T extends BrandLayout>(layout: T): T {
  if (!layout.decorations?.length) return layout;
  const anchored = layout.decorations.filter((d) => {
    if (d.kind === 'logo' || d.kind === 'scrim') return true;
    const g = d.frame;
    // Reject a rule/divider that SITS ON a text block (covers its interior) —
    // it should sit beside/against text, never over it.
    const coversText = layout.blocks.some((b) => {
      const f = b.frame;
      const vOverlap = Math.min(g.y + g.h, f.y + f.h) - Math.max(g.y, f.y);
      const hOverlap = Math.min(g.x + g.w, f.x + f.w) - Math.max(g.x, f.x);
      return hOverlap > 0 && vOverlap > 0.5 * g.h;
    });
    if (coversText) return false;
    // Keep only if it is anchored adjacent to some block (touching its edge).
    return layout.blocks.some((b) => {
      const f = b.frame;
      const hOverlap = g.x < f.x + f.w && g.x + g.w > f.x;
      const vGap = Math.min(
        Math.abs(g.y - (f.y + f.h)), // decoration just below the block
        Math.abs(g.y + g.h - f.y), // decoration just above the block
        Math.abs(g.y - f.y), // decoration alongside the block's top
      );
      return hOverlap && vGap <= 0.05;
    });
  });
  return { ...layout, decorations: anchored.length ? anchored : undefined };
}
