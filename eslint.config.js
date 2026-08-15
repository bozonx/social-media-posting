import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import jest from 'eslint-plugin-jest';

export default [
  { ignores: ['dist/', 'node_modules/', 'coverage/'] },
  eslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: ['./tsconfig.eslint.json', './tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
        sourceType: 'module',
        ecmaVersion: 2022,
      },
      globals: { process: 'readonly', Buffer: 'readonly', console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly' },
    },
    plugins: { '@typescript-eslint': tseslint, prettier, jest },
    rules: {
      'prettier/prettier': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
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
    files: ['test/**/*.ts', '**/*.spec.ts'],
    languageOptions: { globals: { describe: 'readonly', it: 'readonly', test: 'readonly', expect: 'readonly', beforeAll: 'readonly', beforeEach: 'readonly', afterAll: 'readonly', afterEach: 'readonly', jest: 'readonly' } },
    rules: { '@typescript-eslint/no-explicit-any': 'off', 'no-console': 'off' },
  },
  prettierConfig,
];
