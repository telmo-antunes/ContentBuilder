import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import unusedImports from 'eslint-plugin-unused-imports';

/**
 * Pragmatic flat config: catch the bug classes that bite this codebase
 * (broken hooks deps, dead imports, obvious mistakes) without style noise.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.claude/worktrees/**', // separate checkouts; each lints itself
      '**/dist/**',
      '**/storage/**',
      '**/*.d.ts',
      'apps/api/src/scripts/**', // one-off dev tools
    ],
  },
  ...tseslint.configs.recommended,
  {
    // Pin the root explicitly: sibling worktrees each carry a tsconfig, and the
    // parser refuses to guess between them.
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    plugins: { 'unused-imports': unusedImports },
    rules: {
      // Dead code: auto-fixable, zero-noise.
      'unused-imports/no-unused-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // This codebase deliberately uses `any` at Mongo/AI JSON boundaries.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // React hook correctness for the web app.
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
