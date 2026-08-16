import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPostingClient, ErrorCode } from '@bozonx/social-posting';
import { pastebin } from '../src/pastebin.platform.js';

const accounts = {
  notes: { platform: 'pastebin', auth: { apiKey: 'demo' } },
};

const request = {
  platform: 'pastebin',
  account: 'notes',
  body: 'a note',
};

const originalFetch = globalThis.fetch;

describe('a platform registered from outside the library', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'p-1', url: 'https://pastebin.example/p-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('is served by a client that knows nothing about it', async () => {
    const client = createPostingClient({ accounts, platforms: [pastebin] });

    expect(client.getRegisteredPlatforms()).toEqual(['pastebin']);

    const result = await client.post(request);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.postId).toBe('p-1');
      expect(result.data.status).toBe('published');
    }
  });

  it('exposes its capabilities to the host', () => {
    const client = createPostingClient({ accounts, platforms: [pastebin] });

    expect(client.getCapabilities('pastebin')).toMatchObject({
      name: 'pastebin',
      supportsUrlPassthrough: false,
      rateLimits: { postsPerDay: 100 },
    });
  });

  it('has its credential validator applied like any built-in platform', async () => {
    const client = createPostingClient({
      accounts: { notes: { platform: 'pastebin', auth: {} } },
      platforms: [pastebin],
    });

    const result = await client.post(request);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(result.error.message).toContain("Field 'apiKey' is required");
    }
  });

  it('reports its own rate limiting through the shared error contract', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('slow down', { status: 429, headers: { 'retry-after': '45' } }),
      ) as unknown as typeof fetch;

    const client = createPostingClient({ accounts, platforms: [pastebin] });
    const result = await client.post(request);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCode.RATE_LIMIT_ERROR);
      expect(result.error.retryable).toBe(true);
      expect(result.error.retryAfterMs).toBe(45_000);
    }
  });
});
