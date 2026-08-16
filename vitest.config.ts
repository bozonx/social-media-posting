import { defineConfig } from 'vitest/config';

/**
 * One runner for the whole workspace.
 *
 * Projects mirror the package boundaries so a failure names the package it
 * belongs to, and so the core can also be run under `workerd`
 * (see `vitest.workerd.config.ts`).
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'core',
          root: './packages/core',
          environment: 'node',
          include: ['test/**/*.spec.ts'],
          setupFiles: ['../../test/setup/no-network.ts'],
          testTimeout: 5000,
        },
      },
      {
        test: {
          name: 'platform-telegram',
          root: './packages/platform-telegram',
          environment: 'node',
          include: ['test/**/*.spec.ts'],
          setupFiles: ['../../test/setup/no-network.ts'],
          testTimeout: 5000,
        },
      },
      {
        test: {
          name: 'server',
          root: './apps/server',
          environment: 'node',
          include: ['test/unit/**/*.spec.ts'],
          setupFiles: ['../../test/setup/no-network.ts'],
          testTimeout: 5000,
        },
      },
      {
        test: {
          name: 'e2e',
          root: './apps/server',
          environment: 'node',
          include: ['test/e2e/**/*.e2e-spec.ts'],
          testTimeout: 30000,
        },
      },
      {
        test: {
          name: 'examples',
          root: './examples/embedded',
          environment: 'node',
          include: ['test/**/*.spec.ts'],
          testTimeout: 5000,
        },
      },
    ],
  },
});
