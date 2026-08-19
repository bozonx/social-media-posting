import eslint from '@eslint/js';
import globals from 'globals';
import prettierConfig from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/**
 * Node built-ins that must never appear in a published package.
 *
 * The target runtime is the web platform — `fetch`, `Request`/`Response`,
 * WHATWG streams, Web Crypto — so the packages also run on Workers, Deno and
 * Bun. This list is the cheap barrier; the real proof is the core test suite
 * running under `workerd` (`pnpm test:workerd`).
 */
const NODE_BUILTINS = [
  'assert',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'domain',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'timers',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'worker_threads',
  'zlib',
];

const WEB_STANDARD_MESSAGE =
  'Published packages target web standards. Use fetch, Web Crypto, WHATWG streams and friends instead of Node built-ins.';

export default tseslint.config(
  {
    ignores: ['**/dist/', 'node_modules/', 'coverage/', '**/*.js', '**/*.mjs'],
  },

  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',

      // Type-aware rules. These catch mistakes a reviewer misses.
      '@typescript-eslint/no-deprecated': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/prefer-as-const': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/no-import-type-side-effects': 'error',

      'no-console': 'error',
      'no-debugger': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },

  {
    // Published packages only. `apps/server` is a deployment artefact, never an
    // npm package, so it may use whatever its runtime provides.
    files: ['packages/*/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          // `paths` matches module specifiers exactly, so a local `./http/...`
          // module is not mistaken for the `http` built-in.
          paths: NODE_BUILTINS.map(name => ({ name, message: WEB_STANDARD_MESSAGE })),
          patterns: [{ group: ['node:*'], message: WEB_STANDARD_MESSAGE }],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'process', message: WEB_STANDARD_MESSAGE },
        { name: 'Buffer', message: WEB_STANDARD_MESSAGE },
        { name: '__dirname', message: WEB_STANDARD_MESSAGE },
        { name: '__filename', message: WEB_STANDARD_MESSAGE },
        { name: 'require', message: WEB_STANDARD_MESSAGE },
      ],
    },
  },

  {
    // Repository tooling runs on Node by definition, and is never published.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-undef': 'off',
      'no-console': 'off',
    },
  },

  {
    files: ['examples/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  {
    files: ['packages/core/src/logger/logger.ts', 'apps/server/src/logger.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  {
    files: [
      '**/test/**/*.ts',
      '**/*.spec.ts',
      '**/*.e2e-spec.ts',
      'test/**/*.ts',
      'packages/conformance/src/**/*.ts',
    ],
    rules: {
      // Tests and test-harness utilities reach into internals and build partial doubles on purpose.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      'no-console': 'off',
    },
  },

  // Must stay last: switches off every rule Prettier owns.
  prettierConfig,
);
