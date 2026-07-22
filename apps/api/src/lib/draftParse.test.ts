import { describe, it, expect } from 'vitest';
import { extractUnits } from './draftParse';

const SOURCE = 'Stop the tire-kickers. Our ceramic coating lasts years. Book your slot today.';

describe('extractUnits (verbatim guard)', () => {
  it('keeps only text that appears verbatim in the source', () => {
    const raw = JSON.stringify([
      { purpose: 'cover', blocks: [{ type: 'title', text: 'Stop the tire-kickers' }] },
      { purpose: 'cta', blocks: [{ type: 'cta', text: 'Book your slot today' }, { type: 'title', text: 'INVENTED HYPE LINE' }] },
    ]);
    const units = extractUnits(raw, SOURCE);
    expect(units).toHaveLength(2);
    // the invented block was dropped; the verbatim cta survived
    expect(units[1]?.blocks).toHaveLength(1);
    expect(units[1]?.blocks[0]?.text).toBe('Book your slot today');
  });

  it('filters invented list items but keeps real ones', () => {
    const raw = JSON.stringify([
      { purpose: 'list', blocks: [{ type: 'list', items: ['Our ceramic coating lasts years', 'made up bonus item'] }] },
    ]);
    const units = extractUnits(raw, SOURCE);
    expect(units[0]?.blocks[0]?.items).toEqual(['Our ceramic coating lasts years']);
  });

  it('drops a unit whose every block was invented', () => {
    const raw = JSON.stringify([{ purpose: 'content', blocks: [{ type: 'paragraph', text: 'totally fabricated copy' }] }]);
    expect(extractUnits(raw, SOURCE)).toHaveLength(0);
  });

  it('returns [] on non-array / garbage', () => {
    expect(extractUnits('not json', SOURCE)).toEqual([]);
    expect(extractUnits('{}', SOURCE)).toEqual([]);
  });
});
