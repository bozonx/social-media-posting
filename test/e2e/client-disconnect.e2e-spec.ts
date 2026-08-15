import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe, Injectable } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { PlatformRegistry } from '../../src/modules/platforms/base/platform-registry.service.js';
import { IPlatform } from '../../src/modules/platforms/base/platform.interface.js';
import { PostType } from '../../src/common/enums/index.js';
import { PostRequestDto } from '../../src/modules/post/dto/index.js';
import { AppConfigService } from '../../src/modules/app-config/app-config.service.js';

// Mock Platform
@Injectable()
class SlowPlatform implements IPlatform {
  readonly name = 'slow-platform';
  readonly supportedTypes = [PostType.POST];

  public wasAborted = false;

  async publish(request: PostRequestDto, config: any, signal?: AbortSignal): Promise<any> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        this.wasAborted = true;
        return reject(new Error('Aborted immediately'));
      }

      const onAbort = () => {
        this.wasAborted = true;
        reject(new Error('Aborted by signal'));
      };

      signal?.addEventListener('abort', onAbort);

      // Simulate long processing
      setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve({ postId: '123', url: 'http://example.com' });
      }, 5000);
    });
  }

  async preview(request: PostRequestDto, config: any): Promise<any> {
    return { success: true, data: {} };
  }
}

describe('Client Disconnect Handling (e2e)', () => {
  let app: NestFastifyApplication;
  let slowPlatform: SlowPlatform;

  beforeEach(async () => {
    slowPlatform = new SlowPlatform();

    const mockPlatformRegistry = {
      get: jest.fn().mockImplementation((name: string) => {
        if (name === 'slow-platform') return slowPlatform;
        throw new Error(`Platform ${name} not found`);
      }),
      register: jest.fn(),
      has: jest.fn().mockReturnValue(true),
    };

    const mockAppConfigService = {
      onModuleInit: jest.fn(),
      get: jest.fn(),
      getAccount: jest.fn().mockReturnValue({
        platform: 'slow-platform',
        auth: {},
      }),
      getAllAccounts: jest.fn(),
      getCommonConfig: jest.fn().mockReturnValue({
        retryAttempts: 3,
        retryDelayMs: 100,
        requestTimeoutSecs: 10,
      }),
      getConversionConfig: jest.fn().mockReturnValue({}),
      retryAttempts: 3,
      retryDelayMs: 100,
      requestTimeoutSecs: 10,
    };

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PlatformRegistry)
      .useValue(mockPlatformRegistry)
      .overrideProvider(AppConfigService)
      .useValue(mockAppConfigService)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
    );

    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );

    app.setGlobalPrefix('api/v1');

    await app.init();
    await app.getHttpAdapter().getInstance().ready();
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
