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

describe('a picture that is not ABOUT its slide', () => {
  beforeEach(() => aiMessage.mockReset());

  it('reports it, separately from a contradiction', async () => {
    // The real failure: a CRM screenshot of a customer list under a slide about
    // ozone machines. It contradicts nothing, so the contradiction check passed
    // it — correctly, by its own rules.
    aiMessage.mockResolvedValueOnce(reply({
      contradictions: [],
      unrelated: [{ slide: 2, about: 'ozone machines', shows: 'a software customer list', question: 'Related?' }],
    }));
    const out = await findImageCopyContradictions([pairing(1, 'Cover'), pairing(2, 'Ozone. Read the manual.')]);
    expect(out.contradictions).toEqual([]);
    expect(out.unrelated).toHaveLength(1);
    expect(out.unrelated[0]).toMatchObject({ slide: 2, about: 'ozone machines' });
  });

  it('never reports the same slide twice — the sharper complaint wins', async () => {
    // A reviewer gets one question per picture. Being told a photo both
    // contradicts its slide AND is unrelated to it is two ways of saying the
    // model was unsure.
    aiMessage.mockResolvedValueOnce(reply({
      contradictions: [{ slide: 2, says: 'a', shows: 'b', question: 'Intended?' }],
      unrelated: [{ slide: 2, about: 'c', shows: 'b', question: 'Related?' }],
    }));
    const out = await findImageCopyContradictions([pairing(1, 'Cover'), pairing(2, 'Copy')]);
    expect(out.contradictions).toHaveLength(1);
    expect(out.unrelated).toEqual([]);
  });

  it('drops an unrelated verdict about a slide that was not sent', async () => {
    aiMessage.mockResolvedValueOnce(reply({
      contradictions: [],
      unrelated: [{ slide: 9, about: 'x', shows: 'y', question: 'Related?' }],
    }));
    const out = await findImageCopyContradictions([pairing(1, 'Cover')]);
    expect(out.unrelated).toEqual([]);
  });

  it('tolerates an older reply with no `unrelated` key at all', async () => {
    aiMessage.mockResolvedValueOnce(reply({ contradictions: [] }));
    const out = await findImageCopyContradictions([pairing(1, 'Cover')]);
    expect(out.unrelated).toEqual([]);
  });

  it('returns both lists empty when the check cannot run', async () => {
    aiMessage.mockRejectedValueOnce(new Error('vision down'));
    const out = await findImageCopyContradictions([pairing(1, 'Cover')]);
    expect(out).toMatchObject({ contradictions: [], unrelated: [], checked: 0 });
  });
});
