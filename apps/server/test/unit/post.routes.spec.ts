import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { PostType } from '@bozonx/social-posting';
import type { StatusResult } from '@bozonx/social-posting';
import type { PostService, PreviewService } from '@bozonx/social-posting/platform';
import { postRoutes } from '../../src/routes/post.routes.js';
import { errorHandler } from '../../src/middleware/errors.js';

describe('postRoutes', () => {
  const silentLogger = {
    debug: () => {},
    log: () => {},
    warn: () => {},
    error: () => {},
  };

  const createMockServices = () => ({
    postService: {
      publish: vi.fn().mockResolvedValue({
        success: true,
        data: {
          status: 'published',
          postId: '12345',
          platform: 'telegram',
          type: PostType.POST,
        },
      }),
      delete: vi.fn().mockResolvedValue({
        success: true,
        data: {
          status: 'deleted',
          parts: [{ id: '12345', status: 'deleted' }],
        },
      }),
      checkStatus: vi.fn().mockResolvedValue({
        success: true,
        data: {
          status: 'published',
          postId: '12345',
          raw: { telegram_id: 123 },
        },
      } as StatusResult),
    } as unknown as PostService,
    previewService: {
      preview: vi.fn().mockResolvedValue({
        success: true,
        data: {
          valid: true,
          detectedType: 'post',
          convertedBody: 'Hello',
          targetFormat: 'text',
        },
      }),
    } as unknown as PreviewService,
  });

  describe('POST /post', () => {
    it('publishes a post successfully with configured account', async () => {
      const { postService, previewService } = createMockServices();
      const app = new Hono();
      app.onError(errorHandler(silentLogger));
      app.route(
        '/',
        postRoutes({
          postService,
          previewService,
          allowInlineAuth: false,
          includeRawResponses: false,
        }),
      );

      const res = await app.request('/post', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          platform: 'telegram',
          account: 'main',
          body: 'Hello world',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toMatchObject({
        success: true,
        data: { postId: '12345' },
      });
      expect(postService.publish).toHaveBeenCalledWith(
        expect.objectContaining({ platform: 'telegram', account: 'main', body: 'Hello world' }),
        expect.objectContaining({ includeRaw: false }),
      );
    });

    it('rejects inline credentials when allowInlineAuth is false', async () => {
      const { postService, previewService } = createMockServices();
      const app = new Hono();
      app.onError(errorHandler(silentLogger));
      app.route(
        '/',
        postRoutes({
          postService,
          previewService,
          allowInlineAuth: false,
          includeRawResponses: false,
        }),
      );

      const res = await app.request('/post', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          platform: 'telegram',
          auth: { apiKey: '123:ABC' },
          body: 'Hello world',
        }),
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.message).toContain('Inline credentials are disabled');
    });

    it('allows inline credentials when allowInlineAuth is true', async () => {
      const { postService, previewService } = createMockServices();
      const app = new Hono();
      app.onError(errorHandler(silentLogger));
      app.route(
        '/',
        postRoutes({
          postService,
          previewService,
          allowInlineAuth: true,
          includeRawResponses: true,
        }),
      );

      const res = await app.request('/post', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          platform: 'telegram',
          auth: { apiKey: '123:ABC' },
          body: 'Hello world',
        }),
      });

      expect(res.status).toBe(200);
      expect(postService.publish).toHaveBeenCalledWith(
        expect.objectContaining({ auth: { apiKey: '123:ABC' } }),
        expect.objectContaining({ includeRaw: true }),
      );
    });
  });

  describe('POST /preview', () => {
    it('returns preview result for a post request', async () => {
      const { postService, previewService } = createMockServices();
      const app = new Hono();
      app.onError(errorHandler(silentLogger));
      app.route(
        '/',
        postRoutes({
          postService,
          previewService,
          allowInlineAuth: true,
          includeRawResponses: false,
        }),
      );

      const res = await app.request('/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          platform: 'telegram',
          account: 'main',
          body: 'Hello world',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toMatchObject({
        success: true,
        data: { valid: true, convertedBody: 'Hello' },
      });
    });

    it('rejects inline credentials in preview when disabled', async () => {
      const { postService, previewService } = createMockServices();
      const app = new Hono();
      app.onError(errorHandler(silentLogger));
      app.route(
        '/',
        postRoutes({
          postService,
          previewService,
          allowInlineAuth: false,
          includeRawResponses: false,
        }),
      );

      const res = await app.request('/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          platform: 'telegram',
          auth: { apiKey: 'token' },
          body: 'Hello world',
        }),
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.message).toContain('Inline credentials are disabled');
    });
  });

  describe('POST /status', () => {
    it('checks status and strips raw payload when includeRawResponses is false', async () => {
      const { postService, previewService } = createMockServices();
      const app = new Hono();
      app.onError(errorHandler(silentLogger));
      app.route(
        '/',
        postRoutes({
          postService,
          previewService,
          allowInlineAuth: false,
          includeRawResponses: false,
        }),
      );

      const res = await app.request('/status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          platform: 'telegram',
          account: 'main',
          handle: { platform: 'telegram', step: 'upload', state: {} },
        }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        success: boolean;
        data: { status: string; postId: string; raw?: unknown };
      };
      expect(data.success).toBe(true);
      expect(data.data.status).toBe('published');
      expect(data.data.postId).toBe('12345');
      expect(data.data.raw).toBeUndefined();
    });

    it('retains raw status payload when includeRawResponses is true', async () => {
      const { postService, previewService } = createMockServices();
      const app = new Hono();
      app.onError(errorHandler(silentLogger));
      app.route(
        '/',
        postRoutes({
          postService,
          previewService,
          allowInlineAuth: false,
          includeRawResponses: true,
        }),
      );

      const res = await app.request('/status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          platform: 'telegram',
          account: 'main',
          handle: { platform: 'telegram', step: 'upload', state: {} },
        }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as { success: boolean; data: { raw?: unknown } };
      expect(data.success).toBe(true);
      expect(data.data.raw).toEqual({ telegram_id: 123 });
    });
  });

  describe('POST /delete', () => {
    it('deletes a post by reference', async () => {
      const { postService, previewService } = createMockServices();
      const app = new Hono();
      app.onError(errorHandler(silentLogger));
      app.route(
        '/',
        postRoutes({
          postService,
          previewService,
          allowInlineAuth: false,
          includeRawResponses: false,
        }),
      );

      const res = await app.request('/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          platform: 'telegram',
          account: 'main',
          ref: { postId: '12345' },
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toMatchObject({
        success: true,
        data: { status: 'deleted' },
      });
      expect(postService.delete).toHaveBeenCalledWith(
        { platform: 'telegram', account: 'main', auth: undefined },
        { postId: '12345' },
        expect.objectContaining({ includeRaw: false }),
      );
    });
  });
});
