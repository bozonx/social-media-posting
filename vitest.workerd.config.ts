import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

/**
 * Every published package's test suite, run inside `workerd`.
 *
 * The lint rule against Node built-ins catches one typed by hand; this catches
 * one arriving through a transitive dependency. A package that passes here runs
 * unchanged on Cloudflare Workers, Deno and Bun.
 *
 * `apps/server` is deliberately absent: it reads `config.yaml` from a
 * filesystem in its Node entry point, and its Workers entry point is verified
 * by `wrangler deploy --dry-run` in CI instead.
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
    name: 'packages-workerd',
    root: '.',
    include: ['packages/*/test/**/*.spec.ts'],
  },
});
