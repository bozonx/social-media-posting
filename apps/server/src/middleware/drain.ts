import type { MiddlewareHandler } from 'hono';

/**
 * Tracks in-flight requests so a Node deploy can drain before exiting.
 *
 * On Workers this is inert: the platform owns the lifecycle there, and nothing
 * ever calls `startDraining()`.
 */
export class DrainTracker {
  private draining = false;
  private inFlight = 0;
  private idle?: () => void;

  /** Whether the process has begun shutting down. */
  get shuttingDown(): boolean {
    return this.draining;
  }

  /** How many requests are still being handled. */
  get inFlightCount(): number {
    return this.inFlight;
  }

  /** Stop accepting new requests. */
  startDraining(): void {
    this.draining = true;
  }

  /**
   * Wait for in-flight requests to finish.
   * @param timeoutMs - How long to wait before giving up on them.
   */
  async waitForIdle(timeoutMs: number): Promise<void> {
    if (this.inFlight === 0) {
      return;
    }

    await Promise.race([
      new Promise<void>(resolve => {
        this.idle = resolve;
      }),
      new Promise<void>(resolve => setTimeout(resolve, timeoutMs)),
    ]);
  }

  /** Middleware that counts requests and refuses new ones while draining. */
  middleware(): MiddlewareHandler {
    return async (c, next) => {
      if (this.draining) {
        return c.json(
          { statusCode: 503, message: 'Server is shutting down', error: 'ServiceUnavailable' },
          503,
        );
      }

      this.inFlight += 1;
      try {
        await next();
      } finally {
        this.inFlight -= 1;
        if (this.draining && this.inFlight === 0 && this.idle) {
          this.idle();
          this.idle = undefined;
        }
      }
    };
  }
}
