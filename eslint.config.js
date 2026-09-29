import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      'apps/api/src/modules/database/database.types.ts',
      'apps/web/src/routeTree.gen.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Tokens and secrets must never reach the logs.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Relative imports are extensionless; the build (SWC in apps/api, tsc in
    // packages/shared, Vite in apps/web) owns what Node or the browser sees.
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^\\.{1,2}/.*\\.(js|ts|tsx|mjs|cjs)$',
              message: 'Drop the file extension from relative imports.',
            },
          ],
        },
      ],
    },
  },
  {
    // Standalone CLI scripts: run by node, not bundled into the app. Reporting
    // to stdout is their purpose, and they never touch a token.
    files: ['apps/api/scripts/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
    rules: { 'no-console': 'off' },
  },
  prettier,
);
