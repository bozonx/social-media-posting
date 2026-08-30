import { describe, expect, it, vi } from 'vitest';
import { ErrorCode, PlatformError, PostType } from '@bozonx/social-posting';
import type { ILogger, ResolvedAccountConfig, ResumeHandle } from '@bozonx/social-posting';
import { FacebookPlatform } from '../src/facebook.platform.js';
const logger: ILogger = { debug: vi.fn(), log: vi.fn(), warn: vi.fn(), error: vi.fn() };
const account: ResolvedAccountConfig = {
  platform: 'facebook',
  source: 'account',
  target: { id: 'page1' },
  auth: { accessToken: 'token' },
};
const request = {
  platform: 'facebook',
  target: { id: 'page1' },
  type: PostType.ALBUM,
  body: 'gallery',
  media: [
    { type: 'image' as const, source: { kind: 'url' as const, url: 'https://cdn.example/1.jpg' } },
    { type: 'image' as const, source: { kind: 'url' as const, url: 'https://cdn.example/2.jpg' } },
  ],
};
describe('Facebook gallery resume', () => {
  it('keeps partial photo ids and does not upload them twice', async () => {
    let attempt = 0;
    const calls: string[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async input => {
      calls.push(String(input));
      attempt++;
      if (attempt === 1) return new Response(JSON.stringify({ id: 'photo1' }), { status: 200 });
      if (attempt === 2)
        return new Response(
          JSON.stringify({ error: { message: 'temporary', is_transient: true } }),
          { status: 503 },
        );
      if (attempt === 3) return new Response(JSON.stringify({ id: 'photo2' }), { status: 200 });
      return new Response(JSON.stringify({ id: 'post1' }), { status: 200 });
    });
    const platform = new FacebookPlatform({ logger, fetch });
    const error = (await platform.publish(request, account).catch(value => value)) as PlatformError;
    expect(error.code).toBe(ErrorCode.PLATFORM_ERROR);
    expect(error.resumeHandle?.state.photoIds as string[]).toEqual(['photo1']);
    const done = await platform.publish(request, account, {
      resume: error.resumeHandle as ResumeHandle,
    });
    expect(done.postId).toBe('post1');
    expect(calls.filter(url => url.endsWith('/page1/photos'))).toHaveLength(3);
  });
});
