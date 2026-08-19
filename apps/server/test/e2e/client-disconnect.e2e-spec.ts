import { describe, expect, it, vi } from 'vitest';
import { PostType } from '@bozonx/social-posting';
import { createTestApp } from '../helpers/create-test-app.js';
import { fakePlatform } from '../helpers/fake-platform.js';

const request = {
  platform: 'telegram',
  body: 'slow post',
  type: PostType.POST,
  auth: { apiKey: 't', chatId: 'c' },
};

describe('client disconnect', () => {
  it('aborts the platform call when the caller hangs up', async () => {
    const { platform, platformModule } = fakePlatform();
    let observed: AbortSignal | undefined;

    platform.publish.mockImplementation(
      async (_req, _account, options) =>
        new Promise((_resolve, reject) => {
          observed = options?.signal;
          options?.signal?.addEventListener('abort', () => {
            reject(new Error('Aborted by signal'));
          });
        }),
    );

    const { app } = createTestApp({ platforms: [platformModule] });
    const controller = new AbortController();

    const inFlight = Promise.resolve(
      app.request('/api/v1/post', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      }),
    );

    await vi.waitFor(() => expect(observed).toBeDefined());
    expect(observed?.aborted).toBe(false);

    controller.abort();

    // The request's own signal is what the library receives, so hanging up
    // stops the platform call instead of finishing a publish nobody will read.
    await vi.waitFor(() => expect(observed?.aborted).toBe(true));
    await inFlight.catch(() => undefined);
  });

  it('gives the platform a live signal on a normal request', async () => {
    const { platform, platformModule } = fakePlatform();
    const { app } = createTestApp({ platforms: [platformModule] });

    await app.request('/api/v1/post', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });

    const options = (platform.publish.mock.calls[0]?.[2] ?? {}) as { signal?: AbortSignal };
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.signal?.aborted).toBe(false);
  });
});
