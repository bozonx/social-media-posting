import { describe, expect, it, vi } from 'vitest';
import { PostType } from '@bozonx/social-posting';
import type { ILogger, ResolvedAccountConfig } from '@bozonx/social-posting';
import { ThreadsPlatform } from '../src/threads.platform.js';
const logger: ILogger = { debug: vi.fn(), log: vi.fn(), warn: vi.fn(), error: vi.fn() };
const account: ResolvedAccountConfig = {
  platform: 'threads',
  source: 'account',
  target: { id: 'u1' },
  auth: { accessToken: 'token' },
};
function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
describe('Threads containers', () => {
  it('creates, waits, then publishes exactly once', async () => {
    const replies = [
      json({ id: 'c1' }),
      json({ id: 'c1', status: 'IN_PROGRESS' }),
      json({ id: 'c1', status: 'FINISHED' }),
      json({ id: 'p1' }),
    ];
    const fetch = vi.fn<typeof globalThis.fetch>(async () => replies.shift()!);
    const platform = new ThreadsPlatform({ logger, fetch });
    const created = await platform.publish(
      { platform: 'threads', type: PostType.POST, body: 'hello', target: { id: 'u1' } },
      account,
    );
    expect(created.status).toBe('processing');
    expect((await platform.checkStatus(created.handle!, account)).status).toBe('processing');
    expect((await platform.checkStatus(created.handle!, account)).postId).toBe('p1');
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(created.handle)).not.toContain('token');
  });
});
