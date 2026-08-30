import { describe, expect, it } from 'vitest';
import { createApp, PLATFORMS } from '../../src/app.js';
import type { ServerConfig } from '../../src/config/schema.js';

describe('createApp', () => {
  const baseConfig: ServerConfig = {
    accounts: {
      tg: {
        platform: 'telegram',
        auth: { apiKey: '123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11' },
        target: '@my_channel',
      },
    },
    strictResumeHandles: false,
    requestTimeoutSecs: 30,
  };

  it('creates an app with default runtime options and registered platforms', async () => {
    const { app, drain, logger, options } = createApp({
      config: baseConfig,
    });

    expect(app).toBeDefined();
    expect(drain).toBeDefined();
    expect(logger).toBeDefined();
    expect(options.serviceName).toBe('social-posting-server');
    expect(options.basePath).toBe('');

    // Health endpoint is available at /api/v1/health
    const healthRes = await app.request('/api/v1/health');
    expect(healthRes.status).toBe(200);
    const healthData = (await healthRes.json()) as Record<string, unknown>;
    expect(healthData.status).toBe('ok');
  });

  it('mounts routes under configured base path prefix', async () => {
    const { app } = createApp({
      config: baseConfig,
      env: {
        BASE_PATH: 'social',
      },
    });

    // Default /api/v1/health should not match when base path is set
    const defaultRes = await app.request('/api/v1/health');
    expect(defaultRes.status).toBe(404);

    // /social/api/v1/health matches
    const prefixedRes = await app.request('/social/api/v1/health');
    expect(prefixedRes.status).toBe(200);
  });

  it('rejects oversized request bodies with 413 Payload Too Large', async () => {
    const { app } = createApp({
      config: baseConfig,
      env: {
        MAX_REQUEST_BODY_BYTES: '1024', // Minimum bounded integer
      },
    });

    const largePayload = JSON.stringify({
      platform: 'telegram',
      account: 'tg',
      body: 'a'.repeat(2000),
    });

    const res = await app.request('/api/v1/post', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: largePayload,
    });

    expect(res.status).toBe(413);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.statusCode).toBe(413);
    expect(data.message).toBe('Request body is too large');
  });

  it('exports PLATFORMS array with telegram module', () => {
    expect(PLATFORMS.length).toBeGreaterThanOrEqual(1);
    expect(PLATFORMS[0]?.name).toBe('telegram');
  });
});
