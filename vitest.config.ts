import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// Alias the workspace package to its TypeScript source so Vitest transforms it
// (it won't transpile TS that resolves through the node_modules symlink).
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'apps/*/lib/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@contentbuilder/shared': resolve(process.cwd(), 'packages/shared/src/index.ts'),
    },
  },
});
