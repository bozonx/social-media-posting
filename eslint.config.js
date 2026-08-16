import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

/**
 * Node built-ins that must never appear in a published package.
 *
 * The target runtime is the web platform — `fetch`, `Request`/`Response`,
 * WHATWG streams, Web Crypto — so the packages also run on Workers, Deno and
 * Bun. This list is the cheap barrier; the real proof is the core test suite
 * running under `workerd` (`pnpm test:workerd`).
 */
const NODE_BUILTINS = [
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants',
  'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http', 'http2',
  'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode',
  'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'timers', 'tls', 'trace_events',
  'tty', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib',
];

const WEB_STANDARD_MESSAGE =
  'Published packages target web standards. Use fetch, Web Crypto, WHATWG streams and friends instead of Node built-ins.';

export default [
  { ignores: ['**/dist/', 'node_modules/', 'coverage/', '**/*.js'] },
  eslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
        sourceType: 'module',
        ecmaVersion: 2022,
      },
      globals: {
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        crypto: 'readonly',
        fetch: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        URL: 'readonly',
      },
    },
    plugins: { '@typescript-eslint': tseslint, prettier },
    rules: {
      'prettier/prettier': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      'no-debugger': 'error',
      'no-undef': 'off',
      'preserve-caught-error': 'off',
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
          patterns: [
            { group: ['node:*'], message: WEB_STANDARD_MESSAGE },
            { group: NODE_BUILTINS, message: WEB_STANDARD_MESSAGE },
          ],
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
    files: ['**/test/**/*.ts', '**/*.spec.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off', 'no-console': 'off' },
  },
  prettierConfig,
];
