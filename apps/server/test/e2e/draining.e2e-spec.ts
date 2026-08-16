import { describe, expect, it, vi } from 'vitest';
import { createTestApp, postJson } from '../helpers/create-test-app.js';
import { fakePlatform } from '../helpers/fake-platform.js';

const request = { platform: 'telegram', body: 'hello', auth: { apiKey: 't', chatId: 'c' } };

describe('draining', () => {
  it('refuses new requests once draining starts', async () => {
    const { app, drain } = createTestApp({ platforms: [fakePlatform().platformModule] });

    drain.startDraining();
    const { status, body } = await postJson(app, '/api/v1/post', request);

    expect(status).toBe(503);
    expect(body.message).toBe('Server is shutting down');
  });

  it('lets an in-flight request finish before reporting idle', async () => {
    const { platform, platformModule } = fakePlatform();
    let release: () => void = () => {};
    platform.publish.mockImplementation(
      async () =>
        new Promise(resolve => {
          release = () => resolve({ status: 'published', postId: '1' });
        }),
    );

    const { app, drain } = createTestApp({ platforms: [platformModule] });

    const inFlight = postJson(app, '/api/v1/post', request);
    await vi.waitFor(() => expect(drain.inFlightCount).toBe(1));

    drain.startDraining();
    const idle = drain.waitForIdle(1000);

    release();
    await inFlight;
    await idle;

    expect(drain.inFlightCount).toBe(0);
  });

  it('returns immediately from waitForIdle when nothing is in flight', async () => {
    const { drain } = createTestApp({ platforms: [fakePlatform().platformModule] });

    await expect(drain.waitForIdle(50)).resolves.toBeUndefined();
  });
});
