import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrandRecipe } from '@contentbuilder/shared';

const { designMock, reviewMock } = vi.hoisted(() => ({ designMock: vi.fn(), reviewMock: vi.fn() }));
vi.mock('./designDeck', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./designDeck')>();
  return { ...actual, designDeck: designMock };
});
vi.mock('./reviewDeck', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./reviewDeck')>();
  return { ...actual, reviewDeck: reviewMock };
});
vi.mock('../contactSheet', () => ({ buildContactSheet: vi.fn(async () => Buffer.from('sheet')) }));

import { runDesignPath } from './designPath';
import type { DesignedDeck } from './designDeck';
import type { DeckReview } from './reviewDeck';

const recipe = { signature: { name: 'x', description: 'y' }, components: [], composition: { align: 'flush-left' } } as unknown as BrandRecipe;
const inputs = [
  { role: 'cover', format: '1080x1350', parts: { headline: 'A' } },
  { role: 'cta', format: '1080x1350', parts: { headline: 'B', cta: 'DM' } },
] as never;

const deck = (tag: string): DesignedDeck => ({
  deckCss: '',
  slides: [
    { role: 'cover', html: `<div class="headline">A ${tag}</div>`, photos: [], source: 'designer' },
    { role: 'cta', html: `<div class="headline">B ${tag}</div>`, photos: [], source: 'designer' },
  ],
  rationale: tag,
  fallbacks: [],
  notes: [],
  model: 'test',
});
const scores = (v: number) => ({ fidelity: v, hook: v, specificity: v, variety: v, hierarchy: v, brand: v, legibility: v, cta: v });
const review = (v: number, findings: DeckReview['findings'] = []): DeckReview => ({ scores: scores(v), total: v * 8, findings, verdict: `v${v}`, model: 'rev' });

function harness() {
  const persisted: string[] = [];
  const args = {
    recipe,
    format: '1080x1350',
    type: 'carousel' as const,
    inputs,
    pool: [],
    idea: 'the brief',
    classic: async () => null,
    persist: vi.fn(async (d: DesignedDeck, round: number) => {
      persisted.push(`${round}:${d.rationale}`);
      return d.slides.map((_, i) => `s${round}-${i}`);
    }),
    shoot: vi.fn(async (ids: readonly string[]): Promise<Array<string | null>> => ids.map(() => Buffer.from('png').toString('base64'))),
  };
  return { args, persisted };
}

beforeEach(() => {
  designMock.mockReset();
  reviewMock.mockReset();
});

describe('runDesignPath', () => {
  it('returns null when the first design cannot be made (the route then runs classic)', async () => {
    designMock.mockResolvedValueOnce(null);
    const { args } = harness();
    expect(await runDesignPath(args)).toBeNull();
  });

  it('ships round 1 when the review finds nothing a revision would fix', async () => {
    designMock.mockResolvedValueOnce(deck('one'));
    reviewMock.mockResolvedValueOnce({ status: 'ok', review: review(4) });
    const { args, persisted } = harness();
    const out = await runDesignPath(args);
    expect(designMock).toHaveBeenCalledTimes(1);
    expect(out?.summary.rounds).toHaveLength(1);
    expect(out?.summary.rounds[0]).toMatchObject({ round: 1, kept: true, total: 32 });
    expect(out?.review?.total).toBe(32);
    expect(persisted).toEqual(['1:one']);
    expect(out?.slideIds).toEqual(['s1-0', 's1-1']);
  });

  it('revises on a blocking finding and ships the higher-scoring round', async () => {
    designMock.mockResolvedValueOnce(deck('one')).mockResolvedValueOnce(deck('two'));
    reviewMock
      .mockResolvedValueOnce({ status: 'ok', review: review(3, [{ slide: 1, fault: 'title', fix: 'hook', severity: 'blocking' }]) })
      .mockResolvedValueOnce({ status: 'ok', review: review(4) });
    const { args, persisted } = harness();
    const out = await runDesignPath(args);
    expect(designMock).toHaveBeenCalledTimes(2);
    // The revision was told what was wrong, with the sheet and the previous deck.
    const revisionCtx = designMock.mock.calls[1]![0] as { revision?: { findings: unknown[]; previous: DesignedDeck } };
    expect(revisionCtx.revision?.findings).toHaveLength(1);
    expect(revisionCtx.revision?.previous.rationale).toBe('one');
    expect(out?.deck.rationale).toBe('two');
    expect(out?.summary.rounds.map((r) => r.kept)).toEqual([false, true]);
    expect(persisted).toEqual(['1:one', '2:two']);
    expect(out?.slideIds).toEqual(['s2-0', 's2-1']);
  });

  it('keeps round 1 and puts it back on disk when the revision scores lower', async () => {
    designMock.mockResolvedValueOnce(deck('one')).mockResolvedValueOnce(deck('two'));
    reviewMock
      .mockResolvedValueOnce({ status: 'ok', review: review(3, [{ slide: 1, fault: 'a', fix: 'b', severity: 'blocking' }]) })
      .mockResolvedValueOnce({ status: 'ok', review: review(2) });
    const { args, persisted } = harness();
    const out = await runDesignPath(args);
    expect(out?.deck.rationale).toBe('one');
    expect(out?.summary.rounds.map((r) => r.kept)).toEqual([true, false]);
    expect(persisted).toEqual(['1:one', '2:two', '1:one']);
    expect(out?.slideIds).toEqual(['s1-0', 's1-1']);
  });

  it('ships round 1 unreviewed, with the skip named, when the review cannot run', async () => {
    designMock.mockResolvedValueOnce(deck('one'));
    reviewMock.mockResolvedValueOnce({ status: 'skipped', reason: 'model-failed', detail: 'boom' });
    const { args } = harness();
    const out = await runDesignPath(args);
    expect(out?.review).toBeNull();
    expect(out?.reviewSkip).toMatchObject({ reason: 'model-failed' });
    expect(out?.summary.rounds[0]).toMatchObject({ kept: true, reason: 'not reviewed' });
  });

  it('does not revise when the shots will not make a sheet', async () => {
    designMock.mockResolvedValueOnce(deck('one'));
    const { args } = harness();
    args.shoot = vi.fn(async (ids: readonly string[]): Promise<Array<string | null>> => ids.map(() => null));
    const out = await runDesignPath(args);
    expect(reviewMock).not.toHaveBeenCalled();
    expect(designMock).toHaveBeenCalledTimes(1);
    expect(out?.summary.rounds[0]?.kept).toBe(true);
  });
});
