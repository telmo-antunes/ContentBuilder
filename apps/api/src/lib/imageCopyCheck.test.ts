import { beforeEach, describe, expect, it, vi } from 'vitest';

const aiMessage = vi.fn();
vi.mock('./ai', () => ({
  aiMessage: (...a: unknown[]) => aiMessage(...a),
  modelFor: async () => 'test-model',
  textOf: (r: { text: string }) => r.text,
}));
vi.mock('./usage', () => ({ recordUsage: async () => {} }));

const { findImageCopyContradictions } = await import('./imageCopyCheck');
const { solidPng } = await import('./png');

const pairing = (index: number, copy: string) => ({ index, copy, image: solidPng(64, 64, '#334455') });
const reply = (obj: unknown) => ({ text: JSON.stringify(obj), usage: {} });

describe('findImageCopyContradictions', () => {
  beforeEach(() => aiMessage.mockReset());

  it('reports a contradiction the checker found', async () => {
    aiMessage.mockResolvedValueOnce(reply({
      contradictions: [{ slide: 2, says: 'water sheets off cleanly', shows: 'droplets clinging', question: 'Intended?' }],
    }));
    const out = await findImageCopyContradictions([pairing(1, 'Cover'), pairing(2, 'Water sheets off cleanly.')]);
    expect(out.checked).toBe(2);
    expect(out.contradictions).toHaveLength(1);
    expect(out.contradictions[0]?.slide).toBe(2);
  });

  /** A verdict about a slide that was never sent points the reviewer at the
   *  wrong card, which is worse than saying nothing. */
  it('drops verdicts about slides that were not sent', async () => {
    aiMessage.mockResolvedValueOnce(reply({
      contradictions: [{ slide: 9, says: 'x', shows: 'y', question: 'Intended?' }],
    }));
    const out = await findImageCopyContradictions([pairing(1, 'Only slide')]);
    expect(out.contradictions).toHaveLength(0);
  });

  it('skips slides with no picture or no copy, without calling the model', async () => {
    const out = await findImageCopyContradictions([{ index: 1, copy: '   ', image: solidPng(8, 8, '#000') }]);
    expect(out.checked).toBe(0);
    expect(out.skipped).toMatch(/both a picture and copy/);
    expect(aiMessage).not.toHaveBeenCalled();
  });

  it('never throws when the model call fails', async () => {
    aiMessage.mockRejectedValueOnce(new Error('boom'));
    const out = await findImageCopyContradictions([pairing(1, 'Some copy')]);
    expect(out.contradictions).toEqual([]);
    expect(out.skipped).toBeTruthy();
  });

  it('returns an empty list for a clean deck', async () => {
    aiMessage.mockResolvedValueOnce(reply({ contradictions: [] }));
    const out = await findImageCopyContradictions([pairing(1, 'Fine'), pairing(2, 'Also fine')]);
    expect(out.contradictions).toEqual([]);
    expect(out.checked).toBe(2);
  });
})
