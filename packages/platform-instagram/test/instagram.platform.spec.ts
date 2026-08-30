import { describe, expect, it, vi } from 'vitest';
import { PostType } from '@bozonx/social-posting';
import type { ILogger, ResolvedAccountConfig } from '@bozonx/social-posting';
import { InstagramPlatform } from '../src/instagram.platform.js';
const logger: ILogger = { debug: vi.fn(), log: vi.fn(), warn: vi.fn(), error: vi.fn() };
const account: ResolvedAccountConfig = {
  platform: 'instagram',
  source: 'account',
  target: { id: 'ig1' },
  auth: { accessToken: 'token' },
};
describe('Instagram containers', () => {
  it('uses REELS for shortVideo and publishes after FINISHED', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const replies = [{ id: 'c1' }, { id: 'c1', status_code: 'FINISHED' }, { id: 'm1' }];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      calls.push({ url: String(input), body: String(init?.body ?? '') });
      return new Response(JSON.stringify(replies.shift()), { status: 200 });
    });
    const platform = new InstagramPlatform({ logger, fetch });
    const created = await platform.publish(
      {
        platform: 'instagram',
        target: { id: 'ig1' },
        type: PostType.SHORT_VIDEO,
        media: [{ type: 'video', source: { kind: 'url', url: 'https://cdn.example/v.mp4' } }],
      },
      account,
    );
    const done = await platform.checkStatus(created.handle!, account);
    expect(calls[0]?.url).toContain('/ig1/media');
    expect(calls[0]?.body).toContain('media_type=REELS');
    expect(calls[2]?.url).toContain('/ig1/media_publish');
    expect(done.postId).toBe('m1');
  });
  it('reports remaining rolling-window publication quota', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          JSON.stringify({ data: [{ quota_usage: 37, config: { quota_total: 100 } }] }),
          {
            status: 200,
          },
        ),
    );
    const quota = await new InstagramPlatform({ logger, fetch }).getQuota(account);
    expect(quota).toMatchObject({ unit: 'publications', limit: 100, remaining: 63 });
  });
});
