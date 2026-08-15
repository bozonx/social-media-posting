import { Injectable, OnApplicationShutdown, OnModuleDestroy, Logger } from '@nestjs/common';
import { GRACEFUL_SHUTDOWN_TIMEOUT_MS } from '../../app.constants.js';

/**
 * Service to manage graceful shutdown
 * Tracks in-flight requests and signals shutdown state to the application
 * Thread-safe implementation to prevent race conditions
 */
@Injectable()
export class ShutdownService implements OnApplicationShutdown, OnModuleDestroy {
  private readonly logger = new Logger(ShutdownService.name);
  private isShuttingDown = false;
  private inFlightRequests = 0;
  private shutdownResolve?: () => void;
  private operationLock = false;

  constructor() {}

  /**
   * Check if the application is shutting down
   */
  get shuttingDown(): boolean {
    return this.isShuttingDown;
  }

  public startDraining(): void {
    this.isShuttingDown = true;
  }

  /**
   * Increment in-flight request counter atomically
   */
  trackRequest(): void {
    // Wait for any ongoing operation to complete
    while (this.operationLock) {
      // Busy wait (acceptable for very short operations)
    }
    this.operationLock = true;
    try {
      this.inFlightRequests++;
      this.logger.debug(
        `Request tracked. In-flight requests: ${this.inFlightRequests}`,
        'ShutdownService',
      );
    } finally {
      this.operationLock = false;
    }
  }

  /**
   * Decrement in-flight request counter atomically and resolve shutdown if no requests remain
   */
  untrackRequest(): void {
    // Wait for any ongoing operation to complete
    while (this.operationLock) {
      // Busy wait (acceptable for very short operations)
    }
    this.operationLock = true;
    try {
      this.inFlightRequests--;
      this.logger.debug(
        `Request untracked. In-flight requests: ${this.inFlightRequests}`,
        'ShutdownService',
      );

      // Check if we should resolve shutdown
      if (this.isShuttingDown && this.inFlightRequests <= 0 && this.shutdownResolve) {
        this.logger.log('All in-flight requests completed during shutdown', 'ShutdownService');
        this.shutdownResolve();
        this.shutdownResolve = undefined;
      }
    } finally {
      this.operationLock = false;
    }
  }

  /**
   * Get the current count of in-flight requests
   */
  getInFlightRequestsCount(): number {
    return this.inFlightRequests;
  }

  /**
   * Called by NestJS when shutdown signal is received
   * Waits for all in-flight requests to complete with timeout
   */
  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(
      `Received shutdown signal: ${signal ?? 'unknown'}. In-flight requests: ${this.inFlightRequests}`,
      'ShutdownService',
    );
    this.isShuttingDown = true;

    if (this.inFlightRequests > 0) {
      this.logger.log(
        `Waiting for ${this.inFlightRequests} in-flight requests to complete...`,
        'ShutdownService',
      );

      const startTime = Date.now();

      // Wait for requests to complete with timeout
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          new Promise<void>(resolve => {
            this.shutdownResolve = resolve;
          }),
          new Promise<void>(resolve => {
            timeout = setTimeout(() => {
              this.logger.warn(
                `Shutdown timeout reached. Remaining in-flight requests: ${this.inFlightRequests}`,
                'ShutdownService',
              );
              resolve();
            }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);
            timeout.unref();
          }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }

      const duration = Date.now() - startTime;
      this.logger.log(
        `Shutdown wait completed in ${duration}ms. Remaining requests: ${this.inFlightRequests}`,
        'ShutdownService',
      );
    } else {
      this.logger.log('No in-flight requests, shutting down immediately', 'ShutdownService');
    }
  }

  /**
   * Called by NestJS when module is being destroyed
   * Cleanup internal state
   */
  onModuleDestroy(): void {
    this.logger.debug('ShutdownService module destroyed', 'ShutdownService');
    this.shutdownResolve = undefined;
    this.inFlightRequests = 0;
    this.isShuttingDown = false;
  }
}
