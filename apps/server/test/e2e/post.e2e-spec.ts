import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ErrorCode, PlatformError, PostType } from '@bozonx/social-posting';
import type { IPlatform } from '@bozonx/social-posting';
import { createTestApp } from './test-app.factory.js';

describe('PostController (e2e)', () => {
  let app: NestFastifyApplication;

  const mockTelegramPlatform = {
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

  beforeAll(async () => {
    app = await createTestApp({
      platforms: [mockTelegramPlatform],
      accounts: {
        test_account: {
          platform: 'telegram',
          auth: {
            apiKey: '123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
            chatId: 'account-chat-id',
          },
        },
      },
      globalPrefix: 'api/v1',
    });
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/v1/post', () => {
    const endpoint = '/api/v1/post';

    it('should reject invalid request body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: endpoint,
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('platform must be a string');
      expect(body.message).toContain('Post must have either body text or at least one media field');
    });

    it('should publish post with inline auth', async () => {
      const payload = {
        platform: 'telegram',
        body: 'Hello World',
        type: PostType.POST,
        auth: {
          apiKey: 'mock-token',
          chatId: '123456',
        },
      };

      const mockResult = {
        status: 'published' as const,
        postId: '100',
        url: 'https://t.me/test/100',
        raw: { message_id: 100 },
      };

      mockTelegramPlatform.publish.mockResolvedValue(mockResult);

      const response = await app.inject({
        method: 'POST',
        url: endpoint,
        payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toMatchObject({
        platform: 'telegram',
        type: PostType.POST,
        postId: mockResult.postId,
        url: mockResult.url,
      });

      expect(mockTelegramPlatform.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: 'telegram',
          body: 'Hello World',
        }),
        expect.objectContaining({
          platform: 'telegram',
          auth: payload.auth,
        }),
        expect.anything(),
      );
    });

    it('should fail when platform does not match provider', async () => {
      const payload = {
        platform: 'twitter', // Mismatch
        body: 'Hello World',
        auth: {
          apiKey: 'mock-token',
          chatId: '123456',
        },
      };

      const response = await app.inject({
        method: 'POST',
        url: endpoint,
        payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toMatch(/Platform "twitter" is not supported/i);
    });

    it('should fail when post type is not supported', async () => {
      const originalSupportedTypes = [...mockTelegramPlatform.supportedTypes];
      mockTelegramPlatform.supportedTypes = []; // Empty list

      const payload = {
        platform: 'telegram',
        body: 'Hello World',
        type: PostType.POST,
        auth: {
          apiKey: 'mock-token',
          chatId: '123456',
        },
      };

      const response = await app.inject({
        method: 'POST',
        url: endpoint,
        payload,
      });

      mockTelegramPlatform.supportedTypes = originalSupportedTypes;

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toMatch(/Post type "post" is not supported by telegram/i);
    });

    it('should publish using account config', async () => {
      const payload = {
        platform: 'telegram',
        account: 'test_account',
        body: 'Message via account',
        type: PostType.POST,
      };

      const mockResult = {
        status: 'published' as const,
        postId: '200',
        url: 'https://t.me/test/200',
        raw: { message_id: 200 },
      };

      mockTelegramPlatform.publish.mockResolvedValue(mockResult);

      const response = await app.inject({
        method: 'POST',
        url: endpoint,
        payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.postId).toBe('200');

      expect(mockTelegramPlatform.publish).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          platform: 'telegram',
          auth: {
            apiKey: '123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
            chatId: 'account-chat-id',
          },
          source: 'account',
        }),
        expect.anything(),
      );
    });

    it('should handle platform errors gracefully', async () => {
      const payload = {
        platform: 'telegram',
        body: 'Error test',
        type: PostType.POST,
        auth: { apiKey: 't', chatId: 'c' },
      };

      mockTelegramPlatform.publish.mockRejectedValue(
        new PlatformError('Telegram API Error', ErrorCode.PLATFORM_ERROR, {
          retryable: true,
          httpStatus: 500,
        }),
      );

      const response = await app.inject({
        method: 'POST',
        url: endpoint,
        payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('PLATFORM_ERROR');
      expect(body.error.message).toBe('Telegram API Error');
      // The shell hands the caller everything it needs for its own backoff.
      expect(body.error.retryable).toBe(true);
      expect(body.error.httpStatus).toBe(500);
    });
  });

  describe('POST /api/v1/preview', () => {
    const endpoint = '/api/v1/preview';

    it('should return preview data', async () => {
      const payload = {
        platform: 'telegram',
        body: '**Bold text**',
        bodyFormat: 'md',
        account: 'test_account',
      };

      const mockPreviewData = {
        valid: true as const,
        detectedType: PostType.POST,
        convertedBody: '<b>Bold text</b>',
        targetFormat: 'html',
        convertedBodyLength: 16,
        warnings: [],
      };

      // PreviewService returns platform.preview() result directly
      mockTelegramPlatform.preview.mockResolvedValue({
        success: true,
        data: mockPreviewData,
      });

      const response = await app.inject({
        method: 'POST',
        url: endpoint,
        payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toEqual(mockPreviewData);
    });
  });
});
