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
    // The browser's own dropdown ignores the design system; use Select (short
    // lists) or Combobox (long, searchable ones) from components/ui.
    files: ['apps/web/src/**/*.tsx'],
    ignores: ['apps/web/src/components/ui/select.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXOpeningElement[name.name='select']",
          message: 'Use Select or Combobox from @/components/ui, not a native <select>.',
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
  {
    // Load-test runner and post-run checks: Node CLI scripts, like the above.
    files: ['apps/api/load/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
    rules: { 'no-console': 'off' },
  },
  {
    // k6 scripts run in k6's own runtime, which provides these globals.
    files: ['apps/api/load/**/*.js'],
    languageOptions: { globals: { __ENV: 'readonly', __VU: 'readonly', __ITER: 'readonly' } },
  },
  prettier,
);
