import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { IdempotencyService } from '@/modules/post/idempotency.service.js';
import { AppConfigService } from '@/modules/app-config/app-config.service.js';
import type {
  PostRequestDto,
  PostResponseDto,
  ErrorResponseDto,
} from '@/modules/post/dto/index.js';

describe('IdempotencyService', () => {
  let service: IdempotencyService;
  let cache: { get: jest.Mock; set: jest.Mock };
  let appConfigService: AppConfigService;

  beforeEach(async () => {
    cache = {
      get: jest.fn(),
      set: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyService,
        {
          provide: CACHE_MANAGER,
          useValue: cache,
        },
        {
          provide: AppConfigService,
          useValue: {
            get idempotencyTtlMinutes() {
              return 10;
            },
          },
        },
      ],
    }).compile();

    service = module.get(IdempotencyService);
    appConfigService = module.get(AppConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('buildKey', () => {
    it('should return null when idempotencyKey is not provided', () => {
      const request: Partial<PostRequestDto> = {
        platform: 'telegram',
        body: 'test',
      };

      const key = service.buildKey(request as PostRequestDto);

      expect(key).toBeNull();
    });

    it('should build deterministic key with prefix and hash', () => {
      const request: PostRequestDto = {
        platform: 'telegram',
        account: 'test',
        body: 'test-body',
        idempotencyKey: 'idem-1',
      } as PostRequestDto;

      const key1 = service.buildKey(request);
      const key2 = service.buildKey(request);

      expect(key1).toBeDefined();
      expect(key1).toEqual(key2);
      expect(key1).toMatch(/^idempotency:idem-1:/);
    });

    it('should produce different keys for different payloads', () => {
      const base: Omit<PostRequestDto, 'body'> = {
        platform: 'telegram',
        account: 'test',
        idempotencyKey: 'idem-1',
      } as any;

      const key1 = service.buildKey({ ...base, body: 'a' } as PostRequestDto);
      const key2 = service.buildKey({ ...base, body: 'b' } as PostRequestDto);

      expect(key1).not.toEqual(key2);
    });
  });

  describe('cache operations', () => {
    it('should return undefined when record is not in cache', async () => {
      cache.get.mockResolvedValue(null);

      const result = await service.getRecord('key');

      expect(result).toBeUndefined();
      expect(cache.get).toHaveBeenCalledWith('key');
    });

    it('should return record from cache', async () => {
      const record = { status: 'completed', response: { success: true } as PostResponseDto };
      cache.get.mockResolvedValue(record);

      const result = await service.getRecord('key');

      expect(result).toEqual(record);
    });

    it('should set processing record with TTL from config', async () => {
      jest.spyOn(appConfigService, 'idempotencyTtlMinutes', 'get').mockReturnValue(5);

      await service.setProcessing('key');

      expect(cache.set).toHaveBeenCalledWith('key', { status: 'processing' }, 5 * 60_000);
    });

    it('should set completed record with response and TTL', async () => {
      const response: PostResponseDto | ErrorResponseDto = {
        success: true,
        data: {
          postId: '1',
          url: 'url',
          platform: 'telegram',
          type: undefined as any,
          publishedAt: 'now',
          requestId: 'req',
          raw: {},
        },
      };

      await service.setCompleted('key', response);

      expect(cache.set).toHaveBeenCalledWith('key', { status: 'completed', response }, 10 * 60_000);
    });

    it('should use default TTL when config does not define idempotencyTtlMinutes', async () => {
      jest
        .spyOn(appConfigService, 'idempotencyTtlMinutes', 'get')
        .mockReturnValue(undefined as any);

      await service.setProcessing('default-key');

      expect(cache.set).toHaveBeenCalledWith('default-key', { status: 'processing' }, 10 * 60_000);
    });

    it('should not throw when cache.set fails in setCompleted', async () => {
      const response: PostResponseDto | ErrorResponseDto = {
        success: true,
        data: {
          postId: '1',
          url: 'url',
          platform: 'telegram',
          type: undefined as any,
          publishedAt: 'now',
          requestId: 'req',
          raw: {},
        },
      } as any;

      cache.set.mockRejectedValue(new Error('store.set is not a function'));

      await expect(service.setCompleted('key', response)).resolves.toBeUndefined();
    });
  });
});
