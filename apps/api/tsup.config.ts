import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  // Bundle the workspace shared package (source-only TS) into the output.
  noExternal: ['@contentbuilder/shared'],
  clean: true,
  sourcemap: true,
});
