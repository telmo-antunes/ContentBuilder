import { describe, it, expect } from 'vitest';
import { parseConcepts } from './campaign';

let n = 0;
const idFor = () => `id-${n++}`;

describe('parseConcepts', () => {
  it('parses a well-formed array and assigns ids', () => {
    n = 0;
    const raw = JSON.stringify([
      { title: 'One', angle: 'a1', paragraph: 'p1 p1 p1' },
      { title: 'Two', angle: 'a2', paragraph: 'p2 p2 p2' },
    ]);
    const out = parseConcepts(raw, 5, idFor);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: 'id-0', title: 'One', angle: 'a1' });
  });

  it('drops entries missing a title or paragraph', () => {
    const raw = JSON.stringify([
      { title: '', paragraph: 'has no title' },
      { title: 'No paragraph', angle: 'x' },
      { title: 'Good', paragraph: 'kept' },
    ]);
    const out = parseConcepts(raw, 5, idFor);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe('Good');
  });

  it('caps at count', () => {
    const raw = JSON.stringify(
      Array.from({ length: 8 }, (_, i) => ({ title: `T${i}`, paragraph: `P${i}` })),
    );
    expect(parseConcepts(raw, 3, idFor)).toHaveLength(3);
  });

  it('tolerates surrounding prose and returns [] on junk', () => {
    const wrapped = 'Here you go:\n[{"title":"A","paragraph":"B"}]\nHope that helps!';
    expect(parseConcepts(wrapped, 5, idFor)).toHaveLength(1);
    expect(parseConcepts('not json at all', 5, idFor)).toHaveLength(0);
  });
});
