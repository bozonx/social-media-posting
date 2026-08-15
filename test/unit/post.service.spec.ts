import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException, Logger } from '@nestjs/common';
import { PostService } from '@/modules/post/post.service.js';
import { AppConfigService } from '@/modules/app-config/app-config.service.js';
import { IdempotencyService } from '@/modules/post/idempotency.service.js';
import { PlatformRegistry } from '@/modules/platforms/base/platform-registry.service.js';
import { AuthValidatorRegistry } from '@/modules/platforms/base/auth-validator-registry.service.js';
import { ShutdownService } from '@/common/services/shutdown.service.js';
import type { PostRequestDto, PostResponseDto } from '@/modules/post/dto/index.js';
import { PostType } from '@/common/enums/index.js';

// =============================================================================
// Mock Factories
// =============================================================================

interface AccountConfig {
  platform: string;

  auth: { apiKey: string; chatId: string };
}

interface CommonConfig {
  retryAttempts: number;
  retryDelayMs: number;
  requestTimeoutSecs?: number;
}

interface PlatformResult {
  postId: string;
  url: string;
  raw: Record<string, unknown>;
}

const createAccountConfig = (overrides: Partial<AccountConfig> = {}): AccountConfig => ({
  platform: 'telegram',

  auth: {
    apiKey: '123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
    chatId: 'test-chat-id',
  },
  ...overrides,
});

const createCommonConfig = (overrides: Partial<CommonConfig> = {}): CommonConfig => ({
  retryAttempts: 3,
  retryDelayMs: 1000,
  ...overrides,
});

const createPlatformResult = (overrides: Partial<PlatformResult> = {}): PlatformResult => ({
  postId: '12345',
  url: 'https://t.me/test/12345',
  raw: { message_id: 12345 },
  ...overrides,
});

const createPostRequest = (overrides: Partial<PostRequestDto> = {}): PostRequestDto => ({
  platform: 'telegram',
  account: 'test-channel',
  body: 'Test message',
  type: PostType.POST,
  ...overrides,
});

const createMockAppConfigService = (accountConfig: AccountConfig, commonConfig: CommonConfig) => ({
  getAccount: jest.fn().mockReturnValue(accountConfig),
  get requestTimeoutSecs() {
    return commonConfig.requestTimeoutSecs;
  },
  get retryAttempts() {
    return commonConfig.retryAttempts;
  },
  get retryDelayMs() {
    return commonConfig.retryDelayMs;
  },
});

const createMockTelegramPlatform = () => ({
  name: 'telegram',
  supportedTypes: [
    PostType.AUTO,
    PostType.POST,
    PostType.IMAGE,
    PostType.VIDEO,
    PostType.ALBUM,
    PostType.DOCUMENT,
  ],
  publish: jest.fn(),
});

const createMockIdempotencyService = () => ({
  buildKey: jest.fn().mockReturnValue(null),
  acquireLock: jest.fn(),
  getRecord: jest.fn(),
  setProcessing: jest.fn(),
  setCompleted: jest.fn(),
});

const createMockPlatformRegistry = (mockTelegramPlatform: any) => ({
  get: jest.fn().mockImplementation((platformName: string) => {
    if (platformName.toLowerCase() === 'telegram') {
      return mockTelegramPlatform;
    }
    throw new BadRequestException(`Platform "${platformName}" is not supported`);
  }),
  has: jest
    .fn()
    .mockImplementation((platformName: string) => platformName.toLowerCase() === 'telegram'),
});

const createMockAuthValidatorRegistry = () => ({
  validate: jest.fn(),
});

const createMockShutdownService = () => ({
  shuttingDown: false,
  trackRequest: jest.fn(),
  untrackRequest: jest.fn(),
  getInFlightRequestsCount: jest.fn().mockReturnValue(0),
});

// =============================================================================
// Test Suite
// =============================================================================

describe('PostService', () => {
  let service: PostService;
  let appConfigService: jest.Mocked<AppConfigService>;
  let platformRegistry: jest.Mocked<PlatformRegistry>;
  let idempotencyService: jest.Mocked<IdempotencyService>;
  let mockTelegramPlatform: ReturnType<typeof createMockTelegramPlatform>;

  const accountConfig = createAccountConfig();
  const commonConfig = createCommonConfig();

  beforeEach(async () => {
    const mockAppConfig = createMockAppConfigService(accountConfig, commonConfig);
    mockTelegramPlatform = createMockTelegramPlatform();
    const mockIdempotency = createMockIdempotencyService();
    const mockPlatformReg = createMockPlatformRegistry(mockTelegramPlatform);
    const mockAuthValidatorReg = createMockAuthValidatorRegistry();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostService,
        { provide: AppConfigService, useValue: mockAppConfig },
        { provide: PlatformRegistry, useValue: mockPlatformReg },
        { provide: AuthValidatorRegistry, useValue: mockAuthValidatorReg },
        { provide: IdempotencyService, useValue: mockIdempotency },
        { provide: ShutdownService, useValue: createMockShutdownService() },
      ],
    }).compile();

    service = module.get<PostService>(PostService);
    appConfigService = module.get(AppConfigService);
    platformRegistry = module.get(PlatformRegistry);
    idempotencyService = module.get(IdempotencyService);

    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ===========================================================================
  // publish()
  // ===========================================================================

  describe('publish', () => {
    describe('successful publishing', () => {
      it('should publish using channel config', async () => {
        const request = createPostRequest();
        const platformResult = createPlatformResult();

        mockTelegramPlatform.publish.mockResolvedValue(platformResult);

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
        expect((result as PostResponseDto).data?.requestId).toBeDefined();
        expect((result as PostResponseDto).data?.publishedAt).toBeDefined();
        expect(appConfigService.getAccount).toHaveBeenCalledWith('test-channel');
        expect(mockTelegramPlatform.publish).toHaveBeenCalledWith(
          request,
          {
            ...accountConfig,
            source: 'account',
          },
          expect.any(AbortSignal),
        );
      });

      it('should publish using inline auth', async () => {
        const request = createPostRequest({
          account: undefined,
          auth: { apiKey: 'inline-token', chatId: 'inline-chat-id' },
        });
        const platformResult = createPlatformResult();

        mockTelegramPlatform.publish.mockResolvedValue(platformResult);

        const result = await service.publish(request);

        expect(result.success).toBe(true);
        expect(appConfigService.getAccount).not.toHaveBeenCalled();
        expect(mockTelegramPlatform.publish).toHaveBeenCalled();
      });
    });

    describe('validation errors', () => {
      it('should fail when neither account nor auth is provided', async () => {
        const request = createPostRequest({ account: undefined });

        const result = await service.publish(request);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('VALIDATION_ERROR');
          expect(result.error.message).toContain('Either "account" or "auth" must be provided');
        }
      });

      it('should fail when platform is not supported', async () => {
        const request = createPostRequest({ platform: 'vk' });

        const result = await service.publish(request);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('VALIDATION_ERROR');
          expect(result.error.message).toContain('Platform "vk" is not supported');
        }
      });

      it('should fail when post type is not supported', async () => {
        const request = createPostRequest({ type: 'UNSUPPORTED_TYPE' as PostType });

        const result = await service.publish(request);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('VALIDATION_ERROR');
          expect(result.error.message).toContain('is not supported');
        }
      });
    });

    describe('error handling', () => {
      it('should return error response on publish failure', async () => {
        const request = createPostRequest();
        const error = new Error('Publishing failed');

        mockTelegramPlatform.publish.mockRejectedValue(error);

        const result = await service.publish(request);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toBeDefined();
          expect(result.error.message).toBe('Publishing failed');
          expect(result.error.requestId).toBeDefined();
        }
      });
    });

    describe('retry behavior', () => {
      beforeEach(() => {
        jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);
      });

      it('should retry on transient failures', async () => {
        const request = createPostRequest();
        const platformResult = createPlatformResult();

        mockTelegramPlatform.publish
          .mockRejectedValueOnce({ response: { status: 500 } })
          .mockResolvedValue(platformResult);

        const result = await service.publish(request);

        expect(result.success).toBe(true);
        expect(mockTelegramPlatform.publish).toHaveBeenCalledTimes(2);
      });

      it('should not retry on validation errors', async () => {
        const request = createPostRequest();
        const error = new BadRequestException('Validation error');

        mockTelegramPlatform.publish.mockRejectedValue(error);

        const result = await service.publish(request);

        expect(result.success).toBe(false);
        expect(mockTelegramPlatform.publish).toHaveBeenCalledTimes(1);
      });
    });

    describe('timeout behavior', () => {
      it('should respect global request timeout from config', async () => {
        jest.useFakeTimers();

        const request = createPostRequest();
        mockTelegramPlatform.publish.mockImplementation(
          () => new Promise<PlatformResult>(() => {}),
        );
        jest.spyOn(appConfigService, 'requestTimeoutSecs', 'get').mockReturnValue(1);

        const publishPromise = service.publish(request);

        jest.advanceTimersByTime(1000);

        const result = await publishPromise;

        jest.useRealTimers();

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('TIMEOUT_ERROR');
        }
      });

      it('should fail when request timeout exceeds maximum allowed value', async () => {
        const request = createPostRequest();
        mockTelegramPlatform.publish.mockImplementation(
          () => new Promise<PlatformResult>(() => {}),
        );
        jest.spyOn(appConfigService, 'requestTimeoutSecs', 'get').mockReturnValue(1000);

        const result = await service.publish(request);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('PLATFORM_ERROR');
        }
      });
    });

    describe('idempotency', () => {
      const idempotentRequest = createPostRequest({ idempotencyKey: 'idem-1' } as any);

      it('should return cached response when record is completed', async () => {
        const cachedResponse: PostResponseDto = {
          success: true,
          data: {
            postId: 'cached',
            url: 'https://t.me/test/cached',
            platform: 'telegram',
            type: PostType.POST,
            publishedAt: new Date().toISOString(),
            requestId: 'cached-req',
            raw: {},
          },
        };

        idempotencyService.buildKey.mockReturnValue('idem-key');
        idempotencyService.acquireLock.mockReturnValue({
          acquired: false,
          status: 'completed',
          response: cachedResponse,
        } as any);

        const result = await service.publish(idempotentRequest);

        expect(result).toEqual(cachedResponse);
        expect(idempotencyService.acquireLock).toHaveBeenCalledWith('idem-key');
        expect(mockTelegramPlatform.publish).not.toHaveBeenCalled();
        expect(idempotencyService.setCompleted).not.toHaveBeenCalled();
      });

      it('should mark processing and save response for new request', async () => {
        const platformResult = createPlatformResult();

        idempotencyService.buildKey.mockReturnValue('idem-key');
        idempotencyService.acquireLock.mockReturnValue({
          acquired: true,
          status: 'processing',
        } as any);
        mockTelegramPlatform.publish.mockResolvedValue(platformResult);

        const result = await service.publish(idempotentRequest);

        expect(result.success).toBe(true);
        expect(idempotencyService.acquireLock).toHaveBeenCalledWith('idem-key');
        expect(idempotencyService.setCompleted).toHaveBeenCalledWith('idem-key', result);
        expect(mockTelegramPlatform.publish).toHaveBeenCalledTimes(1);
      });

      it('should return error response when record is processing', async () => {
        idempotencyService.buildKey.mockReturnValue('idem-key');
        idempotencyService.acquireLock.mockReturnValue({
          acquired: false,
          status: 'processing',
        } as any);

        const result = await service.publish(idempotentRequest);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe('VALIDATION_ERROR');
          expect(result.error.message).toBe(
            'Request with the same idempotencyKey is already being processed',
          );
        }
        expect(idempotencyService.acquireLock).toHaveBeenCalledWith('idem-key');
        expect(mockTelegramPlatform.publish).not.toHaveBeenCalled();
        expect(idempotencyService.setCompleted).not.toHaveBeenCalled();
      });
    });
  });

  // ===========================================================================
  // getPlatform()
  // ===========================================================================

  describe('getPlatform', () => {
    it('should return telegram platform for telegram platform name', () => {
      const platform = (service as any).getPlatform('telegram');
      expect(platform).toBe(mockTelegramPlatform);
    });

    it('should throw error for unsupported platform', () => {
      expect(() => (service as any).getPlatform('unsupported')).toThrow(
        'Platform "unsupported" is not supported',
      );
    });
  });

  // ===========================================================================
  // getErrorCode()
  // ===========================================================================

  describe('getErrorCode', () => {
    const getErrorCode = (error: unknown): string => (service as any).getErrorCode(error);

    it.each([
      [new BadRequestException('test'), 'VALIDATION_ERROR'],
      [{ code: 'ETIMEDOUT' }, 'TIMEOUT_ERROR'],
      [{ code: 'ENOTFOUND' }, 'NETWORK_ERROR'],
      [{ code: 'ECONNREFUSED' }, 'NETWORK_ERROR'],
      [{ code: 'EAI_AGAIN' }, 'NETWORK_ERROR'],
      [{ response: { status: 429 } }, 'RATE_LIMIT_ERROR'],
      [{ response: { status: 503 } }, 'PLATFORM_ERROR'],
      [{ response: { status: 401 } }, 'AUTH_ERROR'],
      [{ response: { status: 403 } }, 'AUTH_ERROR'],
      [new Error('Unknown error'), 'PLATFORM_ERROR'],
    ])('should return correct error code for %p', (error: any, expectedCode: string) => {
      expect(getErrorCode(error)).toBe(expectedCode);
    });
  });

  // ===========================================================================
  // shouldRetry()
  // ===========================================================================

  describe('shouldRetry', () => {
    const shouldRetry = (error: unknown): boolean => (service as any).shouldRetry(error);

    describe('retryable errors', () => {
      it.each([
        [{ code: 'ETIMEDOUT' }, 'network timeout'],
        [{ code: 'ENOTFOUND' }, 'DNS error'],
        [{ response: { status: 503 } }, '5xx server error'],
        [{ response: { status: 429 } }, 'rate limit error'],
      ])('should return true for %p (%s)', (error: any, _description: string) => {
        expect(shouldRetry(error)).toBe(true);
      });
    });

    describe('non-retryable errors', () => {
      it.each([
        [{ response: { status: 400 } }, '4xx client error'],
        [new Error('Unknown error'), 'unknown error'],
      ])('should return false for %p (%s)', (error: any, _description: string) => {
        expect(shouldRetry(error)).toBe(false);
      });
    });
  });

  // ===========================================================================
  // retryWithJitter()
  // ===========================================================================

  describe('retryWithJitter', () => {
    const retryWithJitter = <T>(fn: () => Promise<T>, maxAttempts = 3, baseDelayMs = 100) =>
      (service as any).retryWithJitter(fn, maxAttempts, baseDelayMs);

    beforeEach(() => {
      jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);
    });

    it('should succeed on first attempt', async () => {
      const fn = jest.fn().mockResolvedValue('success');

      const result = await retryWithJitter(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry and eventually succeed', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce({ response: { status: 500 } })
        .mockRejectedValueOnce({ response: { status: 500 } })
        .mockResolvedValue('success');

      const result = await retryWithJitter(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should throw after max attempts', async () => {
      const serverError = { response: { status: 500 } };
      const fn = jest.fn().mockRejectedValue(serverError);

      await expect(retryWithJitter(fn)).rejects.toEqual(serverError);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    describe('non-retryable errors', () => {
      it('should not retry BadRequestException', async () => {
        const fn = jest.fn().mockRejectedValue(new BadRequestException('test'));

        await expect(retryWithJitter(fn)).rejects.toThrow(BadRequestException);
        expect(fn).toHaveBeenCalledTimes(1);
      });

      it('should not retry 4xx client errors', async () => {
        const clientError = { response: { status: 400 } };
        const fn = jest.fn().mockRejectedValue(clientError);

        await expect(retryWithJitter(fn)).rejects.toEqual(clientError);
        expect(fn).toHaveBeenCalledTimes(1);
      });
    });
  });

  // ===========================================================================
  // sleep()
  // ===========================================================================

  describe('sleep', () => {
    it('should delay execution for specified duration', async () => {
      jest.useFakeTimers();

      const sleepPromise = (service as any).sleep(1000);
      jest.advanceTimersByTime(1000);
      await sleepPromise;

      jest.useRealTimers();
    });
  });
});
