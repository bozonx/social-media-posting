import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/create-test-app.js';
import { fakePlatform } from '../helpers/fake-platform.js';

describe('BASE_PATH', () => {
  it('serves under api/v1 by default', async () => {
    const { app } = createTestApp({ platforms: [fakePlatform().platformModule] });

    expect((await app.request('/api/v1/health')).status).toBe(200);
    expect((await app.request('/health')).status).toBe(404);
  });

  it('prefixes every route when BASE_PATH is set', async () => {
    const { app } = createTestApp({
      platforms: [fakePlatform().platformModule],
      env: { BASE_PATH: 'social' },
    });

    expect((await app.request('/social/api/v1/health')).status).toBe(200);
    expect((await app.request('/api/v1/health')).status).toBe(404);
  });

  it.each(['/social/', 'social/', '//social//'])('normalises BASE_PATH %s', async basePath => {
    const { app } = createTestApp({
      platforms: [fakePlatform().platformModule],
      env: { BASE_PATH: basePath },
    });

    expect((await app.request('/social/api/v1/health')).status).toBe(200);
  });
});
