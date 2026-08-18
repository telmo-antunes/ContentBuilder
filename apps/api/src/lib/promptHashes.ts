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
import { PARSE_SYSTEM } from './htmlDirector/compose';

/** Stable, whitespace-insensitive digest — reflowing a paragraph is not a change. */
export const promptHash = (text: string): string =>
  createHash('sha256').update(text.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 12);

/** The live text of every versioned prompt. */
export const PROMPT_TEXT: Partial<Record<TouchpointId, string>> = {
  recipeAuthor: RECIPE_AUTHOR_SYSTEM,
  recipeCritique: RECIPE_CRITIQUE_SYSTEM,
  parse: PARSE_SYSTEM,
  compose: SLIDE_AUTHOR_INSTRUCTIONS,
};

/**
 * The digest each prompt had when its current version was declared.
 * Regenerate with:  npm --prefix apps/api run prompt:hashes
 */
export const EXPECTED_HASHES: Partial<Record<TouchpointId, string>> = {
  recipeAuthor: '2f43e9fee6be',
  recipeCritique: '9d8a71521c74',
  parse: '325db5a18599',
  compose: '876b18550cee',
};
