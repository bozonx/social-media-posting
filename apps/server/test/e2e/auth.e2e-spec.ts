import { describe, expect, it } from 'vitest';
import { createTestApp, postJson } from '../helpers/create-test-app.js';
import { fakePlatform } from '../helpers/fake-platform.js';

const request = {
  platform: 'telegram',
  body: 'hello',
  auth: { apiKey: 't', chatId: 'c' },
};

function appWithTokens(tokens?: string) {
  return createTestApp({
    platforms: [fakePlatform().platformModule],
    env: tokens === undefined ? {} : { AUTH_BEARER_TOKENS: tokens },
  }).app;
}

describe('bearer authentication', () => {
  it('is off when no tokens are configured', async () => {
    const { status } = await postJson(appWithTokens(), '/api/v1/post', request);

    expect(status).toBe(200);
  });

  it('rejects a request with no Authorization header', async () => {
    const { status, body } = await postJson(appWithTokens('secret'), '/api/v1/post', request);

    expect(status).toBe(401);
    expect(body.message).toMatch(/missing/i);
  });

  it('rejects a malformed Authorization header', async () => {
    const { status, body } = await postJson(appWithTokens('secret'), '/api/v1/post', request, {
      authorization: 'Basic secret',
    });

    expect(status).toBe(401);
    expect(body.message).toMatch(/Expected: Bearer/);
  });

  it('rejects an unknown token', async () => {
    const { status } = await postJson(appWithTokens('secret'), '/api/v1/post', request, {
      authorization: 'Bearer wrong',
    });

    expect(status).toBe(401);
  });

  it('accepts any of several configured tokens', async () => {
    const app = appWithTokens('first, second');

    expect(
      (await postJson(app, '/api/v1/post', request, { authorization: 'Bearer first' })).status,
    ).toBe(200);
    expect(
      (await postJson(app, '/api/v1/post', request, { authorization: 'Bearer second' })).status,
    ).toBe(200);
  });
});
