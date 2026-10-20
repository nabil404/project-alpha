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
    // A decorator binds to the next class, so an error class written between
    // `@Injectable()` and its service takes the decorator instead.
    files: ['apps/api/src/**/*.ts', 'apps/api/db/seed/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ClassDeclaration[superClass.name=/Error$/] > Decorator',
          message:
            'An error class is never a provider. Move it above the decorator, which belongs to the class below.',
        },
        {
          // supertest on an unstarted app listens on `::` and dials 127.0.0.1,
          // which another local process can answer (src/__tests__/listen-on-loopback.ts).
          selector: "CallExpression[callee.object.name='app'][callee.property.name='init']",
          message:
            'Start a spec app with listenOnLoopback(app) from src/__tests__/listen-on-loopback.',
        },
        {
          // Spec files run in parallel on one database. A table a spec creates
          // or drops beside shared tables (a foreign key to product_variant)
          // deadlocks other files' writes to them.
          selector: 'TemplateElement[value.raw=/\\b(create|drop|alter)\\s+table\\b/i]',
          message:
            'No DDL in code or specs: schema changes go through drizzle-kit, and a spec seeds rows into the real tables.',
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
    // The dev seed's command prints shop names and counts, never a secret.
    files: ['apps/api/db/seed/seed-products.ts'],
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
  {
    // Plain scripts for the legal pages, served as-is to the browser by Caddy.
    files: ['static/**/*.js'],
    languageOptions: {
      globals: { document: 'readonly', localStorage: 'readonly', matchMedia: 'readonly' },
    },
  },
  prettier,
);
