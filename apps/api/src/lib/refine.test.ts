import { describe, it, expect } from 'vitest';
import type { Slide } from '@contentbuilder/shared';
import { refineSlide, isRefineIntent } from './refine';

const slide = (over: Partial<Slide> = {}): Slide => ({
  id: 's',
  order: 0,
  layoutType: 'FreePosition',
  imageNeed: 'none',
  blocks: [
    { type: 'title', text: 'Hi', frame: { x: 0.1, y: 0.3, w: 0.6, h: 0.15 }, z: 10 },
    { type: 'paragraph', text: 'Body', frame: { x: 0.1, y: 0.52, w: 0.7, h: 0.3 }, z: 11 },
  ],
  ...over,
});

const hero = (s: Slide) => s.blocks.find((b) => b.type === 'title')!.frame!;

describe('refineSlide', () => {
  it('bigger-headline grows the hero, clamped to the safe area', () => {
    const r = refineSlide(slide(), 'bigger-headline', '1080x1350');
    expect(r.changed).toBe(true);
    expect(hero(r.slide).w).toBeGreaterThan(0.6);
    expect(hero(r.slide).h).toBeGreaterThan(0.15);
    expect(hero(r.slide).x + hero(r.slide).w).toBeLessThanOrEqual(1 - 80 / 1080 + 1e-6);
  });

  it('fill-space widens the hero toward full width', () => {
    expect(hero(refineSlide(slide(), 'fill-space', '1080x1350').slide).w).toBeGreaterThanOrEqual(0.84);
  });

  it('more-breathing-room shrinks the hero', () => {
    expect(hero(refineSlide(slide(), 'more-breathing-room', '1080x1350').slide).w).toBeLessThan(0.6);
  });

  it('tidy re-stacks a header stranded below its body', () => {
    const s = slide({
      blocks: [
        { type: 'paragraph', text: 'Body', frame: { x: 0.1, y: 0.2, w: 0.7, h: 0.4 }, z: 10 },
        { type: 'title', text: 'Header', frame: { x: 0.1, y: 0.7, w: 0.7, h: 0.12 }, z: 11 },
      ],
    });
    const r = refineSlide(s, 'tidy', '1080x1350');
    expect(r.changed).toBe(true);
    const title = r.slide.blocks.find((b) => b.type === 'title')!.frame!;
    const para = r.slide.blocks.find((b) => b.type === 'paragraph')!.frame!;
    expect(title.y).toBeLessThan(para.y); // header now above body
  });

  it('bolder / calmer background steps through the role assets', () => {
    const map = { canvas: 'bg-canvas', texture: 'bg-texture', statement: 'bg-statement' };
    const s = slide({ overrides: { backgroundMediaAssetId: 'bg-canvas' } });
    const bolder = refineSlide(s, 'bolder-background', '1080x1350', { backgroundsByRole: map });
    expect(bolder.slide.overrides?.backgroundMediaAssetId).toBe('bg-texture');

    const s2 = slide({ overrides: { backgroundMediaAssetId: 'bg-statement' } });
    const calmer = refineSlide(s2, 'calmer-background', '1080x1350', { backgroundsByRole: map });
    expect(calmer.slide.overrides?.backgroundMediaAssetId).toBe('bg-texture');
  });

  it('background intents no-op without a role map', () => {
    const s = slide({ overrides: { backgroundMediaAssetId: 'bg-canvas' } });
    expect(refineSlide(s, 'bolder-background', '1080x1350').changed).toBe(false);
  });

  it('validates intent names', () => {
    expect(isRefineIntent('bigger-headline')).toBe(true);
    expect(isRefineIntent('nonsense')).toBe(false);
  });
});
