import { PARSE_SYSTEM } from './htmlDirector/compose';
import { describe, expect, it } from 'vitest';
import { TOUCHPOINT_REGISTRY, currentVersion, type TouchpointId } from '@contentbuilder/shared';
import { EXPECTED_HASHES, PROMPT_TEXT, promptHash } from './promptHashes';

/**
 * THE GUARD THAT KEEPS THE VERSIONS HONEST.
 *
 * If this test fails, a prompt's text changed. That is not a reason to update
 * the hash and move on — it means every artifact stamped with the current
 * version was made by a prompt that no longer exists. Bump the version in
 * TOUCHPOINT_REGISTRY, write what improved, decide whether it deserves a
 * detector, THEN update the hash (`npm --prefix apps/api run prompt:hashes`).
 */
describe('prompt hashes match their declared versions', () => {
  for (const [id, text] of Object.entries(PROMPT_TEXT) as Array<[TouchpointId, string]>) {
    it(`${id} — v${currentVersion(id)} still describes the live prompt`, () => {
      expect(
        promptHash(text),
        `The "${id}" prompt changed but ${TOUCHPOINT_REGISTRY[id].label} is still v${currentVersion(id)}. ` +
          'Bump it, describe what improved, then refresh the hash.',
      ).toBe(EXPECTED_HASHES[id]);
    });
  }

  it('ignores reflowing — whitespace is not a change', () => {
    expect(promptHash('a  b\n c')).toBe(promptHash('a b c'));
  });

  it('covers every prompt-bearing touchpoint', () => {
    for (const id of Object.keys(PROMPT_TEXT) as TouchpointId[]) {
      expect(EXPECTED_HASHES[id], `${id} has no expected hash`).toBeTruthy();
    }
  });
});

describe('what the guard actually covers', () => {
  it('watches the parse USER rules, not only the system prompt', () => {
    // The per-format budget line lives in the user message. Rewriting it once
    // changed every number a story deck is held to and moved no hash at all,
    // because only PARSE_SYSTEM was hashed. This asserts the coverage itself, so
    // a future refactor cannot quietly narrow it back.
    const text = PROMPT_TEXT.parse ?? '';
    // The BASE format deliberately contributes nothing to the user message —
    // its numbers live in the static system prompt so the cache stays warm
    // across posts. The two formats that do carry a line are covered.
    expect(text).toContain('1080×1920'); // formatGuidance is in there…
    expect(text).toContain('1080×1080');
    expect(text).toContain('SLIDES:'); // …and so is countGuidance
    expect(text.length).toBeGreaterThan(PARSE_SYSTEM.length);
  });

  it('moves the hash when a user-message rule changes', () => {
    const before = promptHash(PROMPT_TEXT.parse ?? '');
    const after = promptHash(`${PROMPT_TEXT.parse ?? ''} body <= 72`);
    expect(after).not.toBe(before);
  });
});
