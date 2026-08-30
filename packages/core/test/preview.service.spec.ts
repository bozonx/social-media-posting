import { describe, expect, it, vi } from 'vitest';
import { PreviewService } from '../src/services/preview.service.js';
import { PostingConfig } from '../src/config/posting-config.js';
import { PlatformRegistry } from '../src/platforms/platform-registry.js';
import { AuthValidatorRegistry } from '../src/platforms/auth-validator-registry.js';
import { PostType } from '../src/types/post-type.js';
import type { ILogger } from '../src/logger/logger.js';
import type { IPlatform } from '../src/platforms/platform.interface.js';
import type { PostRequest } from '../src/types/post-request.js';

const telegramAccount = {
  platform: 'telegram',
  auth: { apiKey: '123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11', chatId: 'test-chat-id' },
};

const silentLogger: ILogger = { debug: () => {}, log: () => {}, warn: () => {}, error: () => {} };

function createService(
  accounts: Record<string, unknown> = { 'test-channel': telegramAccount },
  platformOverrides: Partial<IPlatform> = {},
) {
  const platform = {
    name: 'telegram',
    capabilities: {
      name: 'telegram',
      postTypes: {
        [PostType.POST]: {
          requiredFields: ['body'],
          forbiddenFields: ['media'],
        },
        [PostType.IMAGE]: {
          requiredFields: ['media'],
        },
      },
      maxBodyLength: 4096,
      targetBodyFormat: 'html',
    },
    publish: vi.fn(),
    ...platformOverrides,
  } satisfies IPlatform;

  const platformRegistry = new PlatformRegistry();
  platformRegistry.register(platform);

  const warnSpy = vi.fn();
  const logger: ILogger = { ...silentLogger, warn: warnSpy };

  const service = new PreviewService({
    config: new PostingConfig({ accounts: accounts as never }),
    platformRegistry,
    authValidatorRegistry: new AuthValidatorRegistry(),
    logger,
  });

  return { service, platform, warnSpy };
}

describe('PreviewService', () => {
  describe('validation', () => {
    it('reports a missing platform as invalid preview data', async () => {
      const { service } = createService();

      const result = await service.preview({ body: 'Test message' } as PostRequest);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.valid).toBe(false);
        expect(result.data.issues.some(i => i.field === 'platform')).toBe(true);
      }
    });

    it('reports an unregistered platform', async () => {
      const { service } = createService();

      const result = await service.preview({
        platform: 'unsupported',
        body: 'Test message',
        account: 'test-channel',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('Platform "unsupported" is not supported');
      }
    });

    it('reports a request with neither account nor auth', async () => {
      const { service } = createService();

      const result = await service.preview({ platform: 'telegram', body: 'Test message' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('Either "account" or "auth" must be provided');
      }
    });

    it('reports an unknown account', async () => {
      const { service } = createService();

      const result = await service.preview({
        platform: 'telegram',
        body: 'Test message',
        account: 'non-existent',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('Account "non-existent" is not in configuration');
      }
    });

    it('reports an account belonging to another platform', async () => {
      const { service } = createService({
        'vk-channel': { platform: 'vk', auth: { apiKey: 'x' } },
      });

      const result = await service.preview({
        platform: 'telegram',
        body: 'Test message',
        account: 'vk-channel',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain(
          'Account platform "vk" does not match requested platform "telegram"',
        );
      }
    });

    it('reports a request with no content before reaching the platform', async () => {
      const { service, platform } = createService();

      const result = await service.preview({ platform: 'telegram', account: 'test-channel' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.valid).toBe(false);
        expect(result.data.issues.some(i => i.code === 'EMPTY_POST_REQUEST')).toBe(true);
      }
      expect(platform.publish).not.toHaveBeenCalled();
    });
  });

  describe('capability preview', () => {
    it('passes resolved capabilities and account configuration through the shared preview path', async () => {
      const validateExtra = vi.fn().mockReturnValue([]);
      const { service, platform } = createService(undefined, { validateExtra });
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Test message',
        account: 'test-channel',
      };

      const result = await service.preview(request);

      expect(result.success).toBe(true);
      expect(validateExtra).toHaveBeenCalledWith(
        expect.objectContaining({ target: undefined }),
        expect.objectContaining({ source: 'account' }),
        PostType.POST,
      );
      expect(platform.publish).not.toHaveBeenCalled();
    });

    it('uses capability preview for every platform', async () => {
      const validateExtra = vi.fn().mockReturnValue([]);
      const { service } = createService(
        { 'test-channel': { ...telegramAccount } },
        {
          validateExtra,
        },
      );

      const request: PostRequest = {
        platform: 'telegram',
        body: 'Hello world',
        account: 'test-channel',
      };

      const result = await service.preview(request);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.valid).toBe(true);
        expect(result.data.detectedType).toBe(PostType.POST);
        expect(result.data.targetFormat).toBe('html');
        expect(result.data.convertedBody).toBe('Hello world');
      }
      expect(validateExtra).toHaveBeenCalled();
    });

    it('logs a warning when preview validation throws an unexpected error', async () => {
      const { service, warnSpy } = createService();

      const result = await service.preview({
        platform: 'telegram',
        body: 'Test message',
        account: 'non-existent',
      });

      expect(result.success).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Preview validation failed for telegram'),
        'PreviewService',
      );
    });
  });
});
