/**
 * THE HASH GUARD — what stops the version numbers becoming a lie.
 *
 * A registry of versions is only worth anything if the numbers move when the
 * prompts do. Left to discipline, that lasts about a week: someone tunes a
 * sentence, ships it, and every artifact in the database is now stamped with a
 * version that no longer describes what made it.
 *
 * So each versioned prompt's text is hashed, and the expected hash is recorded
 * here. `promptHashes.test.ts` compares them. Edit a prompt and the test fails
 * until you bump the version in TOUCHPOINT_REGISTRY, write what improved, and
 * update the hash — which is exactly the moment to think about whether the
 * change deserves a detector.
 */
import { createHash } from 'node:crypto';
import type { TouchpointId } from '@contentbuilder/shared';
import { RECIPE_AUTHOR_SYSTEM, RECIPE_CRITIQUE_SYSTEM } from './htmlDirector/authorRecipe';
import { SLIDE_AUTHOR_INSTRUCTIONS } from './htmlDirector/prompt';
import { PARSE_SYSTEM, countGuidance, formatGuidance } from './htmlDirector/compose';

/**
 * THE RULES THAT LIVE IN THE USER MESSAGE.
 *
 * `PARSE_SYSTEM` is only half of what the copywriter is told. The per-format
 * budget line and the slide-count line are assembled per call, so they cannot be
 * hashed as one string — but their TEMPLATES can, by rendering them for a fixed
 * set of inputs. Rewriting the story budgets changed every number a story deck
 * is held to and moved no hash at all, because that line lives here rather than
 * in the system prompt: half the prompt was outside the guard, and it was the
 * half that varies per post.
 *
 * The inputs are deliberately fixed and boring. This pins the WORDING and the
 * NUMBERS the builders produce, never the brief text that legitimately differs
 * on every call.
 */
const PARSE_USER_RULES = [
  formatGuidance('1080x1350'),
  formatGuidance('1080x1920'),
  formatGuidance('1080x1080'),
  countGuidance({ min: 4, max: 9, target: 6, fixed: false }, 0),
  countGuidance({ min: 6, max: 6, target: 6, fixed: true }, 6),
  countGuidance({ min: 5, max: 5, target: 5, fixed: true }, 0),
].join('\n');

/** Stable, whitespace-insensitive digest — reflowing a paragraph is not a change. */
export const promptHash = (text: string): string =>
  createHash('sha256').update(text.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 12);

/** The live text of every versioned prompt. */
export const PROMPT_TEXT: Partial<Record<TouchpointId, string>> = {
  recipeAuthor: RECIPE_AUTHOR_SYSTEM,
  recipeCritique: RECIPE_CRITIQUE_SYSTEM,
  // The system prompt AND the rule-bearing parts of the user message — see
  // PARSE_USER_RULES. One hash covers both, so either one moving is a version
  // bump, which is the whole point of the guard.
  parse: `${PARSE_SYSTEM}\n${PARSE_USER_RULES}`,
  compose: SLIDE_AUTHOR_INSTRUCTIONS,
};

/**
 * The digest each prompt had when its current version was declared.
 * Regenerate with:  npm --prefix apps/api run prompt:hashes
 */
export const EXPECTED_HASHES: Partial<Record<TouchpointId, string>> = {
  recipeAuthor: '9cb8cb19bdac',
  recipeCritique: '7e2320e8baad',
  parse: '77a00d9bce66',
  compose: '226a775327aa',
};
