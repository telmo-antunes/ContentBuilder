import { describe, expect, it } from 'vitest';
import { extractPackage, extractTemplates, packSummary, type BrandTemplate } from './templates';

const skeleton = (over: Record<string, unknown> = {}) => ({
  name: 'Editorial cover',
  purpose: 'cover',
  imageNeed: 'none',
  blocks: [
    { type: 'eyebrow', frame: { x: 0.1, y: 0.12, w: 0.5, h: 0.05 }, z: 10 },
    { type: 'title', frame: { x: 0.1, y: 0.2, w: 0.8, h: 0.25 }, z: 11 },
  ],
  decorations: [{ kind: 'rule', frame: { x: 0.1, y: 0.18, w: 0.08, h: 0.01 }, z: 2 }],
  ...over,
});

describe('extractTemplates', () => {
  it('parses a valid pack (with prose around the JSON)', () => {
    const raw = `Here is the pack:\n${JSON.stringify([skeleton(), skeleton({ name: 'CTA closer', purpose: 'cta' })])}\ndone.`;
    const pack = extractTemplates(raw);
    expect(pack).toHaveLength(2);
    expect(pack[0]!.name).toBe('Editorial cover');
    expect(pack[1]!.purpose).toBe('cta');
  });

  it('repairs out-of-range frames instead of dropping the template', () => {
    const raw = JSON.stringify([
      skeleton({ blocks: [{ type: 'title', frame: { x: 0.8, y: 0.5, w: 0.6, h: 0.2 }, z: 1 }] }),
    ]);
    const pack = extractTemplates(raw);
    expect(pack).toHaveLength(1);
    const f = pack[0]!.blocks[0]!.frame;
    expect(f.x + f.w).toBeLessThanOrEqual(1);
  });

  it('drops templates with unknown purposes or block types', () => {
    const raw = JSON.stringify([
      skeleton({ purpose: 'meme' }),
      skeleton({ blocks: [{ type: 'sticker', frame: { x: 0, y: 0, w: 1, h: 1 } }] }),
      skeleton(),
    ]);
    expect(extractTemplates(raw)).toHaveLength(1);
  });

  it('salvages chrome emitted as blocks by moving it to decorations', () => {
    const raw = JSON.stringify([
      skeleton({
        blocks: [
          { type: 'logo', frame: { x: 0.1, y: 0.05, w: 0.2, h: 0.05 }, z: 2 },
          { type: 'title', frame: { x: 0.1, y: 0.2, w: 0.8, h: 0.25 }, z: 11 },
        ],
        decorations: [],
      }),
    ]);
    const pack = extractTemplates(raw);
    expect(pack).toHaveLength(1);
    expect(pack[0]!.blocks.map((b) => b.type)).toEqual(['title']);
    expect(pack[0]!.decorations?.map((d) => d.kind)).toContain('logo');
  });

  it('throws on a response with no JSON array', () => {
    expect(() => extractTemplates('sorry, no can do')).toThrow();
    expect(() => extractTemplates('[not json')).toThrow();
  });
});

describe('packSummary', () => {
  it('is compact: rounds frames, strips decorations', () => {
    const pack = extractTemplates(JSON.stringify([skeleton()])) as BrandTemplate[];
    const s = packSummary(pack);
    expect(s).toContain('"purpose":"cover"');
    expect(s).not.toContain('decorations');
    expect(s).toContain('0.12');
  });
});

describe('extractPackage', () => {
  const layout = (over: Record<string, unknown> = {}) => ({
    name: 'Editorial cover',
    purpose: 'cover',
    imageNeed: 'none',
    background: 'mesh',
    blocks: [
      { type: 'eyebrow', frame: { x: 0.1, y: 0.15, w: 0.5, h: 0.05 }, z: 10 },
      { type: 'title', frame: { x: 0.1, y: 0.22, w: 0.8, h: 0.25 }, z: 11 },
    ],
    ...over,
  });

  it('parses a full package with direction, posts and stories', () => {
    const raw = `Design:\n${JSON.stringify({
      direction: 'Quiet editorial luxury with hairline structure.',
      post: [layout(), layout({ purpose: 'cta', name: 'Gold close' })],
      story: [layout({ purpose: 'content', name: 'Tall content' })],
    })}`;
    const pkg = extractPackage(raw);
    expect(pkg.direction).toContain('editorial');
    expect(pkg.post).toHaveLength(2);
    expect(pkg.story).toHaveLength(1);
    expect((pkg.post[0] as { backgroundMotif?: string }).backgroundMotif).toBe('mesh');
  });

  it('drops an off-menu background motif but keeps the layout', () => {
    const raw = JSON.stringify({ post: [layout({ background: 'lava-lamp' })], story: [] });
    const pkg = extractPackage(raw);
    expect(pkg.post).toHaveLength(1);
    expect((pkg.post[0] as { backgroundMotif?: string }).backgroundMotif).toBeUndefined();
  });

  it('salvages chrome-as-block inside package layouts too', () => {
    const raw = JSON.stringify({
      post: [
        layout({
          blocks: [
            { type: 'logo', frame: { x: 0.1, y: 0.05, w: 0.2, h: 0.05 } },
            { type: 'title', frame: { x: 0.1, y: 0.2, w: 0.8, h: 0.25 } },
          ],
          decorations: [],
        }),
      ],
      story: [],
    });
    const pkg = extractPackage(raw);
    expect(pkg.post[0]!.blocks.map((b) => b.type)).toEqual(['title']);
    expect(pkg.post[0]!.decorations?.map((d) => d.kind)).toContain('logo');
  });

  it('throws when there are no usable post layouts', () => {
    expect(() => extractPackage(JSON.stringify({ post: [], story: [] }))).toThrow();
    expect(() => extractPackage('no json here')).toThrow();
  });
});
