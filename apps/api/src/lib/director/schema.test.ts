import { describe, it, expect } from 'vitest';
import { extractBrief, extractCompositions, extractBackgroundSet } from './schema';

describe('extractBrief', () => {
  const good = JSON.stringify({
    brief: 'x'.repeat(140),
    backgroundConcept: 'y'.repeat(60),
    do: ['a', 'b', 'c'],
    dont: ['d', 'e', 'f'],
  });

  it('parses a well-formed brief', () => {
    expect(extractBrief(good)?.do).toHaveLength(3);
  });
  it('peels prose/fences around the JSON', () => {
    expect(extractBrief('Here you go:\n```json\n' + good + '\n```')).not.toBeNull();
  });
  it('rejects a brief missing required arrays', () => {
    expect(extractBrief(JSON.stringify({ brief: 'x'.repeat(140), backgroundConcept: 'y'.repeat(60), do: ['a'] }))).toBeNull();
  });
  it('rejects prose with no JSON', () => {
    expect(extractBrief('no json here')).toBeNull();
  });
});

describe('extractCompositions', () => {
  const obj = {
    post: [
      { name: 'Cover', purpose: 'cover', imageNeed: 'none', backgroundRole: 'statement', blocks: [{ type: 'title', frame: { x: 0.1, y: 0.3, w: 0.8, h: 0.2 }, z: 10 }] },
      { name: 'List', purpose: 'list', imageNeed: 'none', backgroundRole: 'canvas', blocks: [{ type: 'list', frame: { x: 0.1, y: 0.2, w: 0.8, h: 0.4 }, z: 10 }] },
      { garbage: true },
    ],
    story: [
      { name: 'Cvr', purpose: 'cover', imageNeed: 'none', backgroundRole: 'statement', blocks: [{ type: 'title', frame: { x: 0.1, y: 0.4, w: 0.8, h: 0.2 }, z: 10 }] },
    ],
  };

  it('parses valid layouts and drops garbage, preserving backgroundRole', () => {
    const { post, story } = extractCompositions(JSON.stringify(obj));
    expect(post).toHaveLength(2);
    expect(post[0]?.backgroundRole).toBe('statement');
    expect(story).toHaveLength(1);
  });
  it('returns empty sets on non-object input', () => {
    expect(extractCompositions('[]')).toEqual({ post: [], story: [] });
  });
});

describe('extractBackgroundSet', () => {
  it('parses the three SVG strings', () => {
    const raw = JSON.stringify({ canvas: '<svg>'.padEnd(70, 'a'), texture: '<svg>'.padEnd(70, 'b'), statement: '<svg>'.padEnd(70, 'c') });
    expect(extractBackgroundSet(raw)?.canvas).toContain('<svg>');
  });
  it('rejects a set missing a variant', () => {
    expect(extractBackgroundSet(JSON.stringify({ canvas: 'x'.repeat(70), texture: 'y'.repeat(70) }))).toBeNull();
  });
});
