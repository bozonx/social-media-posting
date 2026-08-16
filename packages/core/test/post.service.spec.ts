import { afterEach, describe, expect, it, vi } from 'vitest';
import { PostService } from '../src/services/post.service.js';
import { PostingConfig } from '../src/config/posting-config.js';
import { PlatformRegistry } from '../src/platforms/platform-registry.js';
import { AuthValidatorRegistry } from '../src/platforms/auth-validator-registry.js';
import { PostType } from '../src/types/post-type.js';
import { ErrorCode } from '../src/errors/error-code.js';
import { ValidationError } from '../src/errors/posting-error.js';
import { PlatformError } from '../src/errors/platform-error.js';
import type { IPlatform, PlatformPublishResponse } from '../src/platforms/platform.interface.js';
import type { ILogger } from '../src/logger/logger.js';
import type { PostRequest } from '../src/types/post-request.js';
import type { PostResponse } from '../src/types/post-response.js';
import type { ResumeHandle } from '../src/types/resume-handle.js';

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
  status: 'published',
  postId: '12345',
  url: 'https://t.me/test/12345',
  raw: { message_id: 12345 },
  ...overrides,
});

function createService(configOverrides: Record<string, unknown> = {}) {
  const platform = {
    name: 'telegram',
    capabilities: {
      name: 'telegram',
      supportedTypes: [
        PostType.AUTO,
        PostType.POST,
        PostType.IMAGE,
        PostType.VIDEO,
        PostType.ALBUM,
        PostType.DOCUMENT,
      ],
    },
    publish: vi.fn<IPlatform['publish']>(),
    preview: vi.fn<NonNullable<IPlatform['preview']>>(),
    detectType: vi.fn<NonNullable<IPlatform['detectType']>>(() => PostType.POST),
  };

  const platformRegistry = new PlatformRegistry();
  platformRegistry.register(platform);

  const config = new PostingConfig({
    accounts: { 'test-channel': accountConfig },
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
      const result = await service.publish(request, { includeRaw: true });

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
        { signal: expect.any(AbortSignal), resume: undefined },
      );
    });

    it('returns the detected type instead of auto', async () => {
      const { service, platform } = createService();
      platform.detectType.mockReturnValue(PostType.IMAGE);
      platform.publish.mockResolvedValue(createPlatformResult());

      const result = await service.publish(
        createPostRequest({
          type: PostType.AUTO,
          body: undefined,
          cover: { src: 'https://a/b.jpg' },
        }),
      );

      expect(result.success && result.data.type).toBe(PostType.IMAGE);
    });

    it('omits raw platform data unless explicitly requested', async () => {
      const { service, platform } = createService();
      platform.publish.mockResolvedValue(createPlatformResult());

      const result = await service.publish(createPostRequest());

      expect(result.success && result.data.raw).toBeUndefined();
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
      }
    });

    it('reports a network failure the platform classified', async () => {
      const { service, platform } = createService();
      platform.publish.mockRejectedValue(
        new PlatformError('connection reset', ErrorCode.NETWORK_ERROR, { retryable: true }),
      );

      const result = await service.publish(createPostRequest());

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCode.NETWORK_ERROR);
        expect(result.error.retryable).toBe(true);
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

  describe('error contract', () => {
    it('passes the platform classification through untouched', async () => {
      const { service, platform } = createService();
      platform.publish.mockRejectedValue(
        new PlatformError('Too Many Requests', ErrorCode.RATE_LIMIT_ERROR, {
          retryable: true,
          retryAfterMs: 30_000,
          httpStatus: 429,
          platformCode: '429',
        }),
      );

      const result = await service.publish(createPostRequest());

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toMatchObject({
          code: ErrorCode.RATE_LIMIT_ERROR,
          retryable: true,
          retryAfterMs: 30_000,
          httpStatus: 429,
          platformCode: '429',
        });
      }
    });

    it('reports an unclassified error as non-retryable', async () => {
      const { service, platform } = createService();
      platform.publish.mockRejectedValue(new Error('who knows'));

      const result = await service.publish(createPostRequest());

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCode.INTERNAL_ERROR);
        expect(result.error.retryable).toBe(false);
      }
    });

    it('marks a validation error as non-retryable', async () => {
      const { service } = createService();

      const result = await service.publish(createPostRequest({ platform: 'vk' }));

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.retryable).toBe(false);
      }
    });
  });

  describe('resumable operations', () => {
    const handle: ResumeHandle = {
      platform: 'telegram',
      step: 'upload',
      state: { uploadId: 'u-1', offset: 1024 },
    };

    it('surfaces the resume handle a failed attempt left behind', async () => {
      const { service, platform } = createService();
      platform.publish.mockRejectedValue(
        new PlatformError('upload interrupted', ErrorCode.NETWORK_ERROR, {
          retryable: true,
          resumeHandle: handle,
        }),
      );

      const result = await service.publish(createPostRequest());

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.resumeHandle).toEqual(handle);
        // The handle must survive the host storing it in a JSON job record.
        expect(JSON.parse(JSON.stringify(result.error.resumeHandle))).toEqual(handle);
      }
    });

    it('hands a resume handle back to the platform', async () => {
      const { service, platform } = createService();
      platform.publish.mockResolvedValue(createPlatformResult());

      await service.publish(createPostRequest(), { resume: handle });

      expect(platform.publish).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ resume: handle }),
      );
    });

    it('refuses a handle from another platform', async () => {
      const { service, platform } = createService();

      const result = await service.publish(createPostRequest(), {
        resume: { ...handle, platform: 'vk' },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('belongs to platform "vk"');
      }
      expect(platform.publish).not.toHaveBeenCalled();
    });
  });

  describe('deferred results', () => {
    it('reports a processing publication with a follow-up handle', async () => {
      const { service, platform } = createService();
      const handle: ResumeHandle = {
        platform: 'telegram',
        step: 'moderation',
        state: { id: 'p1' },
      };
      platform.publish.mockResolvedValue({
        status: 'processing',
        handle,
        checkAfterMs: 15_000,
      });

      const result = await service.publish(createPostRequest());

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('processing');
        expect(result.data.handle).toEqual(handle);
        expect(result.data.checkAfterMs).toBe(15_000);
        expect(result.data.postId).toBeUndefined();
      }
    });

    it('checks the status of a processing publication', async () => {
      const { service, platform } = createService();
      const handle: ResumeHandle = {
        platform: 'telegram',
        step: 'moderation',
        state: { id: 'p1' },
      };
      const checkStatus = vi.fn().mockResolvedValue({
        status: 'published',
        postId: '42',
        url: 'https://t.me/test/42',
      });
      (platform as unknown as { checkStatus: unknown }).checkStatus = checkStatus;

      const status = await service.checkStatus(
        { platform: 'telegram', account: 'test-channel' },
        handle,
      );

      expect(status).toMatchObject({ status: 'published', postId: '42' });
      expect(checkStatus).toHaveBeenCalledWith(
        handle,
        expect.objectContaining({ source: 'account' }),
        expect.any(AbortSignal),
      );
      delete (platform as unknown as { checkStatus?: unknown }).checkStatus;
    });

    it('rejects a status check on a platform that publishes synchronously', async () => {
      const { service } = createService();

      await expect(
        service.checkStatus(
          { platform: 'telegram', account: 'test-channel' },
          {
            platform: 'telegram',
            step: 'x',
            state: {},
          },
        ),
      ).rejects.toThrow(/publishes synchronously/);
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

      const result = await service.publish(createPostRequest(), { signal: controller.signal });

      expect(result.success).toBe(false);
      expect(platform.publish).not.toHaveBeenCalled();
    });

    it('passes an abort signal down to the platform', async () => {
      const { service, platform } = createService();
      let receivedSignal: AbortSignal | undefined;
      platform.publish.mockImplementation((_request, _account, options) => {
        receivedSignal = options?.signal;
        return Promise.resolve(createPlatformResult());
      });

      await service.publish(createPostRequest());

      expect(receivedSignal).toBeInstanceOf(AbortSignal);
      expect(receivedSignal?.aborted).toBe(false);
    });
  });
});
