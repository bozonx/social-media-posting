import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PostType } from '@bozonx/social-posting';
import type {
  IPlatform,
  PlatformPublishResponse,
  PostRequest,
  PublishOptions,
} from '@bozonx/social-posting';
import { createTestApp } from './test-app.factory.js';

/** A platform that never finishes on its own, so the abort path is observable. */
class SlowPlatform implements IPlatform {
  readonly name = 'slow-platform';
  readonly capabilities = { name: 'slow-platform', supportedTypes: [PostType.POST] };

  public wasAborted = false;

  async publish(
    _request: PostRequest,
    _config: unknown,
    options?: PublishOptions,
  ): Promise<PlatformPublishResponse> {
    const signal = options?.signal;
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        this.wasAborted = true;
        reject(new Error('Aborted immediately'));
        return;
      }

      const onAbort = () => {
        this.wasAborted = true;
        reject(new Error('Aborted by signal'));
      };

      signal?.addEventListener('abort', onAbort);

      setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve({ status: 'published', postId: '123', url: 'http://example.com' });
      }, 5000);
    });
  }

  async preview(): Promise<never> {
    throw new Error('not used');
  }
}

describe('Client Disconnect Handling (e2e)', () => {
  let app: NestFastifyApplication;
  let slowPlatform: SlowPlatform;

  beforeEach(async () => {
    slowPlatform = new SlowPlatform();
    app = await createTestApp({
      platforms: [slowPlatform],
      accounts: { test: { platform: 'slow-platform', auth: {} } },
      globalPrefix: 'api/v1',
    });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('should abort platform request when client disconnects', async () => {
    // Start server on all interfaces
    await app.listen(0, '0.0.0.0');
    const address = app.getHttpServer().address();
    const port = typeof address === 'string' ? 0 : address?.port;

    const { request: httpRequest } = await import('http');

    const postData = JSON.stringify({
      platform: 'slow-platform',
      account: 'test',
      body: 'test post',
      type: 'post',
    });

    let responseReceived = false;
    let responseBody = '';

    const req = httpRequest({
      hostname: '127.0.0.1',
      port: port,
      path: '/api/v1/post',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    });

    req.on('response', res => {
      res.on('data', chunk => {
        responseBody += chunk.toString();
      });
      res.on('end', () => {
        responseReceived = true;
      });
    });

    req.on('error', () => {
      // Expected error on destroy
    });

    req.write(postData);
    req.end();

    // Wait for server to start processing
    await new Promise(r => setTimeout(r, 1000));

    req.destroy();

    // Wait for server to detect close and abort
    await new Promise(r => setTimeout(r, 1000));

    // The test passes if either:
    // 1. SlowPlatform was called and aborted (wasAborted = true)
    // 2. PostController detected early abort and PostService threw "Request aborted by client"
    // Both scenarios prove that client disconnection is properly handled

    if (slowPlatform.wasAborted) {
      // Scenario 1: Platform was invoked and then aborted mid-flight
      expect(slowPlatform.wasAborted).toBe(true);
    } else if (responseReceived && responseBody.includes('Request aborted by client')) {
      // Scenario 2: Early abort before platform invocation
      expect(responseBody).toContain('Request aborted by client');
    } else {
      // If neither scenario occurred, the test should fail
      expect(slowPlatform.wasAborted).toBe(true); // This will fail and show the issue
    }
  });
});
