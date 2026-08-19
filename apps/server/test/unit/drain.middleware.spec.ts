import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { DrainTracker } from '../../src/middleware/drain.js';

describe('DrainTracker and drain middleware', () => {
  it('initializes with shuttingDown false and inFlightCount 0', () => {
    const drain = new DrainTracker();
    expect(drain.shuttingDown).toBe(false);
    expect(drain.inFlightCount).toBe(0);
  });

  it('tracks in-flight requests and decrements upon completion', async () => {
    const drain = new DrainTracker();
    const app = new Hono();
    app.use('*', drain.middleware());

    let inFlightDuringHandler = -1;
    app.get('/test', async c => {
      inFlightDuringHandler = drain.inFlightCount;
      return c.json({ ok: true });
    });

    const res = await app.request('/test');

    expect(res.status).toBe(200);
    expect(inFlightDuringHandler).toBe(1);
    expect(drain.inFlightCount).toBe(0);
  });

  it('rejects new requests with 503 when draining has started', async () => {
    const drain = new DrainTracker();
    const app = new Hono();
    app.use('*', drain.middleware());
    app.get('/test', c => c.json({ ok: true }));

    drain.startDraining();
    expect(drain.shuttingDown).toBe(true);

    const res = await app.request('/test');

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      statusCode: 503,
      message: 'Server is shutting down',
      error: 'ServiceUnavailable',
    });
  });

  it('waitForIdle resolves immediately when inFlightCount is 0', async () => {
    const drain = new DrainTracker();
    await expect(drain.waitForIdle(1000)).resolves.toBeUndefined();
  });

  it('waitForIdle waits for in-flight requests to complete when draining', async () => {
    const drain = new DrainTracker();
    const app = new Hono();
    app.use('*', drain.middleware());

    let resolveHandler: () => void = () => {};
    const handlerPromise = new Promise<void>(resolve => {
      resolveHandler = resolve;
    });

    app.get('/long', async c => {
      await handlerPromise;
      return c.json({ done: true });
    });

    const requestPromise = app.request('/long');
    // Ensure request has reached the handler
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(drain.inFlightCount).toBe(1);

    drain.startDraining();

    let idleResolved = false;
    const idlePromise = drain.waitForIdle(1000).then(() => {
      idleResolved = true;
    });

    expect(idleResolved).toBe(false);

    // Finish the request
    resolveHandler();
    await requestPromise;
    await idlePromise;

    expect(idleResolved).toBe(true);
    expect(drain.inFlightCount).toBe(0);
  });

  it('waitForIdle resolves after timeout if in-flight requests do not complete', async () => {
    const drain = new DrainTracker();
    const app = new Hono();
    app.use('*', drain.middleware());

    app.get('/stuck', async () => new Promise(() => {}));

    // Start request in background
    void app.request('/stuck');
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(drain.inFlightCount).toBe(1);
    drain.startDraining();

    const start = Date.now();
    await drain.waitForIdle(50);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(40);
  });
});
