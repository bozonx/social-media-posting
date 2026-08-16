import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

/**
 * The core test suite, run inside `workerd`.
 *
 * The lint rule against Node built-ins catches a typo; this catches a
 * transitive dependency. A package that passes here runs unchanged on
 * Cloudflare Workers, Deno and Bun.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: '2026-01-01',
      },
    }),
  ],
  test: {
    name: 'core-workerd',
    root: './packages/core',
    include: ['test/**/*.spec.ts'],
  },
});
