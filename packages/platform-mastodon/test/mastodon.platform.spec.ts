import { describe, expect, it, vi } from 'vitest';
import type { ILogger, ResolvedAccountConfig } from '@bozonx/social-posting';
import { PostType } from '@bozonx/social-posting';
import { mastodon, pixelfed } from '../src/index.js';

const logger: ILogger = { debug() {}, log() {}, warn() {}, error() {} };
const account: ResolvedAccountConfig = {
  platform: 'mastodon',
  source: 'account',
  apiBaseUrl: 'https://social.example',
  auth: { accessToken: 'secret' },
};

describe('Mastodon API adapter', () => {
  it('publishes a thread with idempotency keys and replies', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          id: String(calls.length),
          url: `https://social.example/@a/${calls.length}`,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof globalThis.fetch;
    const result = await mastodon.create({ logger, fetch }).publish(
      {
        platform: 'mastodon',
        type: PostType.POST,
        body: 'first',
        idempotencyKey: 'job',
        thread: [{ body: 'second' }],
      },
      account,
    );
    expect(result.postId).toBe('2');
    expect(new Headers(calls[0]?.init?.headers).get('idempotency-key')).toBe('job');
    expect(new Headers(calls[1]?.init?.headers).get('idempotency-key')).toBe('job-1');
    expect(JSON.parse(String(calls[1]?.init?.body))).toMatchObject({ in_reply_to_id: '1' });
  });

  it('merges instance limits into runtime capabilities', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            configuration: {
              statuses: { max_characters: 5000, max_media_attachments: 8 },
              media_attachments: { image_size_limit: 12 },
              polls: { max_options: 6 },
            },
          }),
          { status: 200 },
        ),
    ) as typeof globalThis.fetch;
    const resolved = await mastodon.create({ logger, fetch }).resolveCapabilities!(account);
    expect(resolved.capabilities.maxBodyLength).toBe(5000);
    expect(resolved.capabilities.media?.image?.maxBytes).toBe(12);
    expect(resolved.cacheableForSecs).toBe(3600);
  });

  it('derives Pixelfed without a second implementation', () => {
    const instance = pixelfed.create({ logger });
    expect(pixelfed.dialect).toBe('mastodon-api');
    expect(instance.name).toBe('pixelfed');
    expect(instance.publish).toBeTypeOf('function');
    expect(instance.capabilities.postTypes[PostType.POST]).toBeUndefined();
  });
});
