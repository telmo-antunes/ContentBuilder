import { describe, it, expect } from 'vitest';
import type { BrandLayout } from '@contentbuilder/shared';
import { pruneFloatingDecorations } from './prune';

const base = (decorations: BrandLayout['decorations']): BrandLayout => ({
  name: 'X',
  purpose: 'cover',
  imageNeed: 'none',
  blocks: [{ type: 'title', frame: { x: 0.1, y: 0.3, w: 0.8, h: 0.2 }, z: 10 }],
  decorations,
});

describe('pruneFloatingDecorations', () => {
  it('keeps a rule anchored just under its title', () => {
    const l = base([{ kind: 'rule', frame: { x: 0.1, y: 0.51, w: 0.3, h: 0.01 } }]);
    expect(pruneFloatingDecorations(l).decorations).toHaveLength(1);
  });

  it('drops a rule floating in empty space', () => {
    const l = base([{ kind: 'rule', frame: { x: 0.1, y: 0.85, w: 0.3, h: 0.06 } }]);
    expect(pruneFloatingDecorations(l).decorations).toBeUndefined();
  });

  it('drops a rule that sits on top of a text block', () => {
    // title occupies y 0.3–0.5; this rule sits squarely over it.
    const l = base([{ kind: 'rule', frame: { x: 0.1, y: 0.34, w: 0.4, h: 0.1 } }]);
    expect(pruneFloatingDecorations(l).decorations).toBeUndefined();
  });

  it('always keeps logos and scrims', () => {
    const l = base([
      { kind: 'logo', frame: { x: 0.1, y: 0.86, w: 0.2, h: 0.06 } },
      { kind: 'scrim', frame: { x: 0, y: 0, w: 1, h: 1 } },
    ]);
    expect(pruneFloatingDecorations(l).decorations).toHaveLength(2);
  });

  it('is a no-op when there are no decorations', () => {
    const l = base(undefined);
    expect(pruneFloatingDecorations(l).decorations).toBeUndefined();
  });
});
