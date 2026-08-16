import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/create-test-app.js';
import { fakePlatform } from '../helpers/fake-platform.js';

describe('GET /api/v1/health', () => {
  it('reports ok while serving', async () => {
    const { app } = createTestApp({ platforms: [fakePlatform().platformModule] });

    const response = await app.request('/api/v1/health');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'ok',
      service: 'social-posting-server',
      version: 'dev',
    });
  });

  it('reports 503 while draining, so a load balancer stops sending traffic', async () => {
    const { app, drain } = createTestApp({ platforms: [fakePlatform().platformModule] });

    drain.startDraining();
    const response = await app.request('/api/v1/health');

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ status: 'shutting_down' });
  });

  it('needs no bearer token even when one is configured', async () => {
    const { app } = createTestApp({
      platforms: [fakePlatform().platformModule],
      env: { AUTH_BEARER_TOKENS: 'secret' },
    });

    const response = await app.request('/api/v1/health');

    expect(response.status).toBe(200);
  });

  it('takes the service name and version from the environment', async () => {
    const { app } = createTestApp({
      platforms: [fakePlatform().platformModule],
      env: { SERVICE_NAME: 'posting', SERVICE_VERSION: '2.0.0' },
    });

    await expect((await app.request('/api/v1/health')).json()).resolves.toMatchObject({
      service: 'posting',
      version: '2.0.0',
    });
  });
});
