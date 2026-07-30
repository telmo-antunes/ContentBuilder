/**
 * Print the current digest of every versioned prompt, for pasting into
 * EXPECTED_HASHES after a deliberate version bump.
 *
 *   npm --prefix apps/api run prompt:hashes
 */
import { PROMPT_TEXT, promptHash } from '../lib/promptHashes';

for (const [id, text] of Object.entries(PROMPT_TEXT)) {
  if (text) console.log(`  ${id}: '${promptHash(text)}',`);
}
