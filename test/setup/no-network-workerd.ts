import { beforeAll } from 'vitest';

/** Workerd equivalent of the Node nock setup: network is denied by default. */
beforeAll(() => {
  globalThis.fetch = (() => {
    throw new Error('Network access is disabled in tests');
  }) as typeof fetch;
});
