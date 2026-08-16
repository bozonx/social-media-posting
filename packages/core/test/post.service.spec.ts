import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostService } from '../src/services/post.service.js';
import { PostingConfig } from '../src/config/posting-config.js';
import { PlatformRegistry } from '../src/platforms/platform-registry.js';
import { AuthValidatorRegistry } from '../src/platforms/auth-validator-registry.js';
import { PostType } from '../src/types/post-type.js';
import { ErrorCode } from '../src/errors/error-code.js';
import { ValidationError } from '../src/errors/posting-error.js';
import type { IPlatform, PlatformPublishResponse } from '../src/platforms/platform.interface.js';
import type { ILogger } from '../src/logger/logger.js';
import type { PostRequest } from '../src/types/post-request.js';
import type { PostResponse } from '../src/types/post-response.js';

const accountConfig = {
  platform: 'telegram',
  auth: { apiKey: '123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11', chatId: 'test-chat-id' },
};

const silentLogger: ILogger = {
  debug: () => {},
  log: () => {},
  warn: () => {},
  error: () => {},
};

const createPostRequest = (overrides: Partial<PostRequest> = {}): PostRequest => ({
  platform: 'telegram',
  account: 'test-channel',
  body: 'Test message',
  type: PostType.POST,
  ...overrides,
});

const createPlatformResult = (
  overrides: Partial<PlatformPublishResponse> = {},
): PlatformPublishResponse => ({
  postId: '12345',
  url: 'https://t.me/test/12345',
  raw: { message_id: 12345 },
  ...overrides,
});

function createService(configOverrides: Record<string, unknown> = {}) {
  const platform = {
    name: 'telegram',
    supportedTypes: [
      PostType.AUTO,
      PostType.POST,
      PostType.IMAGE,
      PostType.VIDEO,
      PostType.ALBUM,
      PostType.DOCUMENT,
    ],
    publish: vi.fn<IPlatform['publish']>(),
    preview: vi.fn<IPlatform['preview']>(),
  };

  const platformRegistry = new PlatformRegistry();
  platformRegistry.register(platform);

  const config = new PostingConfig({
    accounts: { 'test-channel': accountConfig },
    retryAttempts: 3,
    retryDelayMs: 0,
    ...configOverrides,
  });

  const service = new PostService({
    config,
    platformRegistry,
    authValidatorRegistry: new AuthValidatorRegistry(),
    logger: silentLogger,
  });

  return { service, platform, config };
}

describe('PostService', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('successful publishing', () => {
    it('publishes using an account from configuration', async () => {
      const { service, platform } = createService();
      platform.publish.mockResolvedValue(createPlatformResult());

      const request = createPostRequest();
      const result = await service.publish(request);

      expect(result).toMatchObject({
        success: true,
        data: {
          postId: '12345',
          url: 'https://t.me/test/12345',
          platform: 'telegram',
          type: PostType.POST,
          raw: { message_id: 12345 },
        },
      });
      expect((result as PostResponse).data.requestId).toBeDefined();
      expect((result as PostResponse).data.publishedAt).toBeDefined();
      expect(platform.publish).toHaveBeenCalledWith(
        request,
        { ...accountConfig, source: 'account' },
        expect.any(AbortSignal),
      );
    });

    it('publishes using inline credentials', async () => {
      const { service, platform } = createService();
      platform.publish.mockResolvedValue(createPlatformResult());

      const result = await service.publish(
        createPostRequest({
          account: undefined,
          auth: { apiKey: 'inline-token', chatId: 'inline-chat-id' },
        }),
      );

      expect(result.success).toBe(true);
      expect(platform.publish).toHaveBeenCalledTimes(1);
    });
  });

  describe('validation errors', () => {
    it('fails when neither account nor auth is provided', async () => {
      const { service } = createService();

      const result = await service.publish(createPostRequest({ account: undefined }));

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCode.VALIDATION_ERROR);
        expect(result.error.message).toContain('Either "account" or "auth" must be provided');
      }
    });

    it('fails when the platform is not registered', async () => {
      const { service } = createService();

      const result = await service.publish(createPostRequest({ platform: 'vk' }));

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCode.VALIDATION_ERROR);
        expect(result.error.message).toContain('Platform "vk" is not supported');
      }
    });

    it('fails when the post type is unknown', async () => {
      const { service } = createService();

      const result = await service.publish(
        createPostRequest({ type: 'UNSUPPORTED_TYPE' as PostType }),
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCode.VALIDATION_ERROR);
      }
    });

    it('fails when the request carries no content at all', async () => {
      const { service } = createService();

      const result = await service.publish(createPostRequest({ body: undefined }));

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCode.VALIDATION_ERROR);
        expect(result.error.message).toContain('must have either body text');
      }
    });

    it('fails when the account belongs to another platform', async () => {
      const { service } = createService({
        accounts: { 'test-channel': { ...accountConfig, platform: 'vk' } },
      });

      const result = await service.publish(createPostRequest());

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('does not match requested platform');
      }
    });
  });

  describe('error handling', () => {
    it('returns an error result rather than throwing', async () => {
      const { service, platform } = createService();
      platform.publish.mockRejectedValue(new Error('Publishing failed'));

      const result = await service.publish(createPostRequest());

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBe('Publishing failed');
        expect(result.error.requestId).toBeDefined();
        expect(result.error.code).toBe(ErrorCode.PLATFORM_ERROR);
      }
    });

    it('reports a network failure as NETWORK_ERROR', async () => {
      const { service, platform } = createService();
      platform.publish.mockRejectedValue(Object.assign(new Error('boom'), { code: 'ENOTFOUND' }));

      const result = await service.publish(createPostRequest());

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCode.NETWORK_ERROR);
      }
    });

    it('preserves the code of an error the platform classified itself', async () => {
      const { service, platform } = createService();
      platform.publish.mockRejectedValue(new ValidationError('body too long'));

      const result = await service.publish(createPostRequest());

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCode.VALIDATION_ERROR);
      }
    });
  });

  describe('retry behaviour', () => {
    it('retries a transient network failure', async () => {
      const { service, platform } = createService();
      platform.publish
        .mockRejectedValueOnce(Object.assign(new Error('down'), { code: 'ECONNRESET' }))
        .mockResolvedValue(createPlatformResult());

      const result = await service.publish(createPostRequest());

      expect(result.success).toBe(true);
      expect(platform.publish).toHaveBeenCalledTimes(2);
    });

    it('does not retry a validation error', async () => {
      const { service, platform } = createService();
      platform.publish.mockRejectedValue(new ValidationError('nope'));

      await service.publish(createPostRequest());

      expect(platform.publish).toHaveBeenCalledTimes(1);
    });

    it('does not retry a permanent platform error', async () => {
      const { service, platform } = createService();
      platform.publish.mockRejectedValue(new Error('rejected by platform'));

      await service.publish(createPostRequest());

      expect(platform.publish).toHaveBeenCalledTimes(1);
    });

    it('gives up after the configured number of attempts', async () => {
      const { service, platform } = createService({ retryAttempts: 2 });
      platform.publish.mockRejectedValue(Object.assign(new Error('down'), { code: 'ECONNRESET' }));

      const result = await service.publish(createPostRequest());

      expect(result.success).toBe(false);
      expect(platform.publish).toHaveBeenCalledTimes(2);
    });
  });

  describe('timeout and cancellation', () => {
    it('times out after requestTimeoutSecs', async () => {
      vi.useFakeTimers();
      const { service, platform } = createService({ requestTimeoutSecs: 1 });
      platform.publish.mockImplementation(() => new Promise(() => {}));

      const publishPromise = service.publish(createPostRequest());
      await vi.advanceTimersByTimeAsync(1000);
      const result = await publishPromise;

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCode.TIMEOUT_ERROR);
      }
    });

    it('aborts when the caller signal is already aborted', async () => {
      const { service, platform } = createService();
      const controller = new AbortController();
      controller.abort();

      const result = await service.publish(createPostRequest(), controller.signal);

      expect(result.success).toBe(false);
      expect(platform.publish).not.toHaveBeenCalled();
    });

    it('passes an abort signal down to the platform', async () => {
      const { service, platform } = createService();
      let receivedSignal: AbortSignal | undefined;
      platform.publish.mockImplementation(
        (_request: PostRequest, _account: unknown, signal?: AbortSignal) => {
          receivedSignal = signal;
          return Promise.resolve(createPlatformResult());
        },
      );

      await service.publish(createPostRequest());

      expect(receivedSignal).toBeInstanceOf(AbortSignal);
      expect(receivedSignal?.aborted).toBe(false);
    });
  });
});
