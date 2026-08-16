import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorCode, PlatformError, PostType } from '@bozonx/social-posting';
import { createTestApp, postJson } from '../helpers/create-test-app.js';
import { fakePlatform } from '../helpers/fake-platform.js';
import type { FakePlatform } from '../helpers/fake-platform.js';
import type { CreatedApp } from '../../src/app.js';

const accounts = {
  test_account: {
    platform: 'telegram',
    auth: { apiKey: '123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11', chatId: 'account-chat-id' },
  },
};

describe('POST /api/v1/post', () => {
  let app: CreatedApp['app'];
  let platform: FakePlatform;

  beforeEach(() => {
    const fake = fakePlatform();
    platform = fake.platform;
    app = createTestApp({ platforms: [fake.platformModule], config: { accounts } }).app;
  });

  it('rejects a malformed body with 400 and says what is wrong', async () => {
    const { status, body } = await postJson(app, '/api/v1/post', {});

    expect(status).toBe(400);
    expect(body.message).toBe('Validation failed');
    expect(body.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'platform' })]),
    );
  });

  it('publishes with inline credentials', async () => {
    platform.publish.mockResolvedValue({
      status: 'published',
      postId: '100',
      url: 'https://t.me/test/100',
      raw: { message_id: 100 },
    });

    const { status, body } = await postJson(app, '/api/v1/post', {
      platform: 'telegram',
      body: 'Hello World',
      type: PostType.POST,
      auth: { apiKey: 'mock-token', chatId: '123456' },
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      platform: 'telegram',
      type: PostType.POST,
      status: 'published',
      postId: '100',
      url: 'https://t.me/test/100',
    });
  });

  it('publishes with a configured account', async () => {
    platform.publish.mockResolvedValue({ status: 'published', postId: '200' });

    const { body } = await postJson(app, '/api/v1/post', {
      platform: 'telegram',
      account: 'test_account',
      body: 'Message via account',
      type: PostType.POST,
    });

    expect(body.data.postId).toBe('200');
    expect(platform.publish).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: 'account', auth: accounts.test_account.auth }),
      expect.anything(),
    );
  });

  it('reports an unknown platform as a result, not an HTTP error', async () => {
    const { status, body } = await postJson(app, '/api/v1/post', {
      platform: 'twitter',
      body: 'Hello World',
      auth: { apiKey: 'mock-token' },
    });

    // Publishing failures are results: a caller reads `success` in one place.
    expect(status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(body.error.message).toMatch(/Platform "twitter" is not supported/i);
  });

  it('reports an unsupported post type', async () => {
    platform.capabilities.supportedTypes = [];

    const { body } = await postJson(app, '/api/v1/post', {
      platform: 'telegram',
      body: 'Hello World',
      type: PostType.POST,
      auth: { apiKey: 'mock-token' },
    });

    expect(body.success).toBe(false);
    expect(body.error.message).toMatch(/Post type "post" is not supported/i);
  });

  it('hands the caller everything its own backoff needs', async () => {
    platform.publish.mockRejectedValue(
      new PlatformError('Too Many Requests', ErrorCode.RATE_LIMIT_ERROR, {
        retryable: true,
        retryAfterMs: 30_000,
        httpStatus: 429,
        platformCode: '429',
        resumeHandle: { platform: 'telegram', step: 'upload', state: { offsetBytes: 2048 } },
      }),
    );

    const { status, body } = await postJson(app, '/api/v1/post', {
      platform: 'telegram',
      body: 'Error test',
      auth: { apiKey: 't', chatId: 'c' },
    });

    expect(status).toBe(200);
    expect(body.error).toMatchObject({
      code: ErrorCode.RATE_LIMIT_ERROR,
      retryable: true,
      retryAfterMs: 30_000,
      httpStatus: 429,
      platformCode: '429',
      resumeHandle: { platform: 'telegram', step: 'upload', state: { offsetBytes: 2048 } },
    });
  });

  it('passes a resume handle back to the platform', async () => {
    const resume = { platform: 'telegram', step: 'upload', state: { offsetBytes: 4096 } };

    await postJson(app, '/api/v1/post', {
      platform: 'telegram',
      body: 'resumed',
      auth: { apiKey: 't', chatId: 'c' },
      resume,
    });

    expect(platform.publish).toHaveBeenCalledWith(
      expect.not.objectContaining({ resume: expect.anything() }),
      expect.anything(),
      expect.objectContaining({ resume }),
    );
  });

  it('reports a publication the platform is still processing', async () => {
    const handle = { platform: 'telegram', step: 'moderation', state: { id: 'p1' } };
    platform.publish.mockResolvedValue({ status: 'processing', handle, checkAfterMs: 15_000 });

    const { body } = await postJson(app, '/api/v1/post', {
      platform: 'telegram',
      body: 'pending',
      auth: { apiKey: 't', chatId: 'c' },
    });

    expect(body.data).toMatchObject({ status: 'processing', handle, checkAfterMs: 15_000 });
  });
});

describe('POST /api/v1/preview', () => {
  it('returns the platform preview', async () => {
    const { platform, platformModule } = fakePlatform();
    const previewData = {
      valid: true as const,
      detectedType: PostType.POST,
      convertedBody: '<b>Bold text</b>',
      targetFormat: 'html',
      convertedBodyLength: 16,
      warnings: [],
    };
    platform.preview.mockResolvedValue({ success: true, data: previewData });

    const { app } = createTestApp({ platforms: [platformModule], config: { accounts } });

    const { status, body } = await postJson(app, '/api/v1/preview', {
      platform: 'telegram',
      body: '**Bold text**',
      bodyFormat: 'md',
      account: 'test_account',
    });

    expect(status).toBe(200);
    expect(body).toEqual({ success: true, data: previewData });
  });
});

describe('POST /api/v1/status', () => {
  it('asks the platform about a processing publication', async () => {
    const { platform, platformModule } = fakePlatform();
    platform.checkStatus.mockResolvedValue({
      status: 'published',
      postId: '42',
      url: 'https://t.me/test/42',
    });

    const { app } = createTestApp({ platforms: [platformModule], config: { accounts } });
    const handle = { platform: 'telegram', step: 'moderation', state: { id: 'p1' } };

    const { status, body } = await postJson(app, '/api/v1/status', {
      platform: 'telegram',
      account: 'test_account',
      handle,
    });

    expect(status).toBe(200);
    expect(body).toMatchObject({ status: 'published', postId: '42' });
    expect(platform.checkStatus).toHaveBeenCalledWith(
      handle,
      expect.objectContaining({ source: 'account' }),
      expect.anything(),
    );
  });
});
