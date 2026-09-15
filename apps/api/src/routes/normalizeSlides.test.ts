import { describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';

// The route module pulls in the AI client; stub it as the other route tests do.
vi.mock('../lib/ai', () => ({
  aiMessage: async () => ({ content: [] }),
  aiJson: async () => ({ json: null }),
  textOf: () => '',
  modelFor: async () => 'test-model',
  designModel: async () => 'test-model',
  cachedSystem: (s: string) => [{ type: 'text', text: s }],
  cachedSystemLayers: (...parts: string[]) => parts.map((text) => ({ type: 'text', text })),
  withOpusReasoning: (p: unknown) => p,
}));

const { normalizeSlides } = await import('./projects');

const asset = new Types.ObjectId().toString();
const photo = (slot: string) => ({ id: 'p1', mediaAssetId: asset, placement: 'slot' as const, slot, fit: 'cover' as const });

describe('normalizeSlides — a slot photo must name a slot the slide declares', () => {
  it('moves a photo aimed at an undeclared slot into the first declared one', () => {
    const [s] = normalizeSlides([
      { authored: { html: '<div class="headline">x</div><figure class="cb-shot" data-cb-slot="proof"></figure>' }, photos: [photo('hero')] } as never,
    ]);
    expect(s!.photos[0]!.slot).toBe('proof');
  });

  it('keeps a photo whose slot is declared', () => {
    const [s] = normalizeSlides([
      { authored: { html: '<figure class="cb-shot" data-cb-slot="hero"></figure>' }, photos: [photo('hero')] } as never,
    ]);
    expect(s!.photos[0]!.slot).toBe('hero');
  });

  it('refuses a slot photo on a slide that declares no slot, naming the field', () => {
    expect(() =>
      normalizeSlides([{ authored: { html: '<div class="headline">no slot here</div>' }, photos: [photo('hero')] } as never]),
    ).toThrowError(/declares no image slot/);
  });
});
