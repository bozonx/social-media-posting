import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PostType } from '@bozonx/social-posting';
import type { ILogger, PostRequest, Issue } from '@bozonx/social-posting';
import { previewFromCapabilities } from '@bozonx/social-posting/platform';

type BotApiCall = { method: string; payload: Record<string, unknown> };

function createBotApiDouble() {
  const calls: BotApiCall[] = [];
  const replies = new Map<string, unknown>();
  const failures = new Map<string, { error_code: number; description: string }>();

  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = url.slice(url.lastIndexOf('/') + 1);
    calls.push({ method, payload: JSON.parse(String(init?.body ?? '{}')) });

    const failure = failures.get(method);
    if (failure) {
      return new Response(JSON.stringify({ ok: false, ...failure }), {
        status: failure.error_code,
      });
    }

    return new Response(JSON.stringify({ ok: true, result: replies.get(method) ?? {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  return {
    install(): void {
      globalThis.fetch = fetchStub as unknown as typeof fetch;
    },
    reset(): void {
      calls.length = 0;
      replies.clear();
      failures.clear();
      fetchStub.mockClear();
    },
    reply(method: string, result: unknown): void {
      replies.set(method, result);
    },
    fail(method: string, failure: { error_code: number; description: string }): void {
      failures.set(method, failure);
    },
    called(method: string): boolean {
      return calls.some(call => call.method === method);
    },
    lastPayload(method: string): Record<string, unknown> | undefined {
      return calls.filter(call => call.method === method).at(-1)?.payload;
    },
    lastUrl(): string | undefined {
      return fetchStub.mock.calls.at(-1)?.[0] as string | undefined;
    },
  };
}

const botApi = createBotApiDouble();

const { TelegramPlatform } = await import('../src/telegram.platform.js');
type TelegramPlatformInstance = InstanceType<typeof TelegramPlatform>;
type TelegramAccountConfig = import('../src/telegram.platform.js').TelegramAccountConfig;

const silentLogger: ILogger = { debug: () => {}, log: () => {}, warn: () => {}, error: () => {} };

describe('TelegramPlatform', () => {
  let platform: TelegramPlatformInstance;

  const mockAccountConfig: TelegramAccountConfig = {
    platform: 'telegram',
    auth: {
      apiKey: 'test-token',
    },
    target: 'test-chat-id',
    silent: false,
  };

  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    platform = new TelegramPlatform({ logger: silentLogger });

    botApi.reset();
    botApi.install();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  describe('platform metadata', () => {
    it('should have correct name', () => {
      expect(platform.name).toBe('telegram');
    });

    it('should support correct post types', () => {
      expect(Object.keys(platform.capabilities.postTypes)).toEqual([
        PostType.POST,
        PostType.IMAGE,
        PostType.VIDEO,
        PostType.AUDIO,
        PostType.DOCUMENT,
        PostType.ALBUM,
        PostType.POLL,
      ]);
    });
  });

  describe('publish - POST type', () => {
    it('should publish text message successfully', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Test message',
        type: PostType.POST,
      };

      botApi.reply('sendMessage', {
        message_id: 12345,
        chat: { id: 'test-chat-id' },
      });

      const result = await platform.publish(request, mockAccountConfig);

      expect(result.status).toBe('published');
      expect(result.postId).toBe('12345');
      expect(result.parts).toMatchObject([{ id: '12345' }]);
      expect(result.ref).toMatchObject({ postId: '12345' });
      expect(result.raw).toEqual({
        ok: true,
        result: {
          message_id: 12345,
          chat: { id: 'test-chat-id' },
        },
      });

      expect(botApi.lastPayload('sendMessage')).toEqual({
        chat_id: 'test-chat-id',
        text: 'Test message',
        parse_mode: 'HTML',
        disable_notification: false,
      });
    });

    it('sends a body right up to the documented limit', async () => {
      const body = 'a'.repeat(4096);
      const request: PostRequest = { platform: 'telegram', body, type: PostType.POST };

      botApi.reply('sendMessage', { message_id: 12345 });

      const result = await platform.publish(request, mockAccountConfig);

      expect(result.postId).toBe('12345');
      expect(botApi.lastPayload('sendMessage')).toEqual({
        chat_id: 'test-chat-id',
        text: body,
        parse_mode: 'HTML',
        disable_notification: false,
      });
    });

    it('rejects an over-long body without a round trip to Telegram', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'a'.repeat(5000),
        type: PostType.POST,
      };

      await expect(platform.publish(request, mockAccountConfig)).rejects.toThrow(
        /exceeds the 4096 characters/,
      );
      expect(botApi.called('sendMessage')).toBe(false);
    });

    it('converts Markdown to the same HTML shown by preview', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: '**Markdown** text',
        bodyFormat: 'md',
        type: PostType.POST,
      };

      botApi.reply('sendMessage', { message_id: 12345 });

      await platform.publish(request, mockAccountConfig);

      expect(botApi.lastPayload('sendMessage')).toEqual({
        chat_id: 'test-chat-id',
        text: '<b>Markdown</b> text',
        parse_mode: 'HTML',
        disable_notification: false,
      });
    });

    it('should send HTML body as-is and set parse_mode to HTML', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: '<b>HTML</b> text',
        bodyFormat: 'html',
        type: PostType.POST,
      };

      botApi.reply('sendMessage', { message_id: 12345 });

      await platform.publish(request, mockAccountConfig);

      expect(botApi.lastPayload('sendMessage')).toEqual({
        chat_id: 'test-chat-id',
        text: '<b>HTML</b> text',
        parse_mode: 'HTML',
        disable_notification: false,
      });
    });

    it('should use platform-specific parameters from extra', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Test message',
        type: PostType.POST,
        extra: {
          parse_mode: 'Markdown',
          link_preview_options: { is_disabled: true },
          reply_parameters: { message_id: 999 },
          protect_content: true,
          reply_markup: {
            inline_keyboard: [[{ text: 'Button', url: 'https://example.com' }]],
          },
        },
      };

      botApi.reply('sendMessage', { message_id: 12345 });

      await platform.publish(request, mockAccountConfig);

      expect(botApi.lastPayload('sendMessage')).toEqual({
        chat_id: 'test-chat-id',
        text: 'Test message',
        disable_notification: false,
        ...request.extra,
      });
    });

    it('rejects extra options that could replace validated destination or content', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Test message',
        type: PostType.POST,
        extra: { chat_id: '@other', text: 'replacement' },
      };

      await expect(platform.publish(request, mockAccountConfig)).rejects.toThrow(
        /protected Telegram option.*chat_id, text/,
      );
      expect(botApi.called('sendMessage')).toBe(false);
    });

    it('should use silent from request to override config', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Test message',
        type: PostType.POST,
        silent: true,
      };

      botApi.reply('sendMessage', { message_id: 12345 });

      await platform.publish(request, mockAccountConfig);

      expect(botApi.lastPayload('sendMessage')).toEqual({
        chat_id: 'test-chat-id',
        text: 'Test message',
        parse_mode: 'HTML',
        disable_notification: true,
      });
    });

    it('should build URL for public channels', async () => {
      const publicAccountConfig: TelegramAccountConfig = {
        platform: 'telegram',
        auth: {
          apiKey: 'test-token',
        },
        target: '@publicchannel',
      };

      const request: PostRequest = {
        platform: 'telegram',
        body: 'Test message',
        type: PostType.POST,
      };

      botApi.reply('sendMessage', { message_id: 12345 });

      const result = await platform.publish(request, publicAccountConfig);

      expect(result.url).toBe('https://t.me/publicchannel/12345');
    });
  });

  describe('publish - IMAGE type', () => {
    it('should publish image with caption', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Image caption',
        bodyFormat: 'html',
        media: [{ source: { kind: 'url', url: 'https://example.com/image.jpg' } }],
        type: PostType.IMAGE,
      };

      botApi.reply('sendPhoto', { message_id: 12345 });

      const result = await platform.publish(request, mockAccountConfig);

      expect(result.postId).toBe('12345');
      expect(botApi.lastPayload('sendPhoto')).toEqual({
        chat_id: 'test-chat-id',
        photo: 'https://example.com/image.jpg',
        caption: 'Image caption',
        parse_mode: 'HTML',
        disable_notification: false,
        has_spoiler: false,
      });
    });

    it('should throw error if media is missing for IMAGE type', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Image caption',
        type: PostType.IMAGE,
      };

      await expect(platform.publish(request, mockAccountConfig)).rejects.toThrow(
        "Field 'media' is required for type 'image'",
      );
    });
  });

  describe('publish - VIDEO type', () => {
    it('should publish video with caption', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Video caption',
        bodyFormat: 'html',
        media: [{ source: { kind: 'url', url: 'https://example.com/video.mp4' } }],
        type: PostType.VIDEO,
      };

      botApi.reply('sendVideo', { message_id: 12345 });

      const result = await platform.publish(request, mockAccountConfig);

      expect(result.postId).toBe('12345');
      expect(botApi.lastPayload('sendVideo')).toEqual({
        chat_id: 'test-chat-id',
        video: 'https://example.com/video.mp4',
        caption: 'Video caption',
        parse_mode: 'HTML',
        disable_notification: false,
        has_spoiler: false,
      });
    });

    it('should throw error if media is missing for VIDEO type', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Video caption',
        type: PostType.VIDEO,
      };

      await expect(platform.publish(request, mockAccountConfig)).rejects.toThrow(
        "Field 'media' is required for type 'video'",
      );
    });
  });

  describe('publish - ALBUM type', () => {
    it('should publish album with media group', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Album caption',
        bodyFormat: 'html',
        media: [
          { source: { kind: 'url', url: 'https://example.com/image1.jpg' } },
          { source: { kind: 'url', url: 'https://example.com/image2.jpg' } },
          { source: { kind: 'url', url: 'https://example.com/video.mp4' } },
        ],
        type: PostType.ALBUM,
      };

      botApi.reply('sendMediaGroup', [
        { message_id: 12345 },
        { message_id: 12346 },
        { message_id: 12347 },
      ]);

      const result = await platform.publish(request, mockAccountConfig);

      expect(result.postId).toBe('12345');
      expect(result.parts).toMatchObject([{ id: '12345' }, { id: '12346' }, { id: '12347' }]);

      expect(botApi.lastPayload('sendMediaGroup')).toEqual({
        chat_id: 'test-chat-id',
        media: [
          {
            type: 'photo',
            media: 'https://example.com/image1.jpg',
            caption: 'Album caption',
            parse_mode: 'HTML',
          },
          {
            type: 'photo',
            media: 'https://example.com/image2.jpg',
          },
          {
            type: 'video',
            media: 'https://example.com/video.mp4',
          },
        ],
        disable_notification: false,
      });
    });

    it('should throw error when using Telegram file_id in album without explicit type', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Album caption',
        bodyFormat: 'html',
        media: [{ source: { kind: 'platformRef', ref: 'BAACAgIAAxkBAAIC...' } }],
        type: PostType.ALBUM,
      };

      await expect(platform.publish(request, mockAccountConfig)).rejects.toThrow(
        "Media item at index 0 must specify 'type' when using Telegram file_id in albums",
      );

      expect(botApi.called('sendMediaGroup')).toBe(false);
    });

    it('should respect explicit media type for album items', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Album with explicit types',
        bodyFormat: 'html',
        media: [
          { source: { kind: 'url', url: 'https://example.com/file1' }, type: 'image' },
          { source: { kind: 'url', url: 'https://example.com/file2' }, type: 'video' },
          { source: { kind: 'url', url: 'https://example.com/file3' } },
        ],
        type: PostType.ALBUM,
      };

      botApi.reply('sendMediaGroup', [
        { message_id: 12345 },
        { message_id: 12346 },
        { message_id: 12347 },
      ]);

      await platform.publish(request, mockAccountConfig);

      expect(botApi.lastPayload('sendMediaGroup')).toEqual({
        chat_id: 'test-chat-id',
        media: [
          expect.objectContaining({ type: 'photo', media: 'https://example.com/file1' }),
          expect.objectContaining({ type: 'video', media: 'https://example.com/file2' }),
          expect.objectContaining({ type: 'photo', media: 'https://example.com/file3' }),
        ],
        disable_notification: false,
      });
    });

    it('should throw error if media array is empty for ALBUM type', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Album caption',
        media: [],
        type: PostType.ALBUM,
      };

      await expect(platform.publish(request, mockAccountConfig)).rejects.toThrow(
        "Field 'media' is required for type 'album'",
      );
    });
  });

  describe('publish - DOCUMENT type', () => {
    it('should publish document with caption', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Document caption',
        bodyFormat: 'html',
        media: [{ source: { kind: 'url', url: 'https://example.com/document.pdf' } }],
        type: PostType.DOCUMENT,
      };

      botApi.reply('sendDocument', { message_id: 12345 });

      const result = await platform.publish(request, mockAccountConfig);

      expect(result.postId).toBe('12345');
      expect(botApi.lastPayload('sendDocument')).toEqual({
        chat_id: 'test-chat-id',
        document: 'https://example.com/document.pdf',
        caption: 'Document caption',
        parse_mode: 'HTML',
        disable_notification: false,
      });
    });

    it('should throw error if no document media is provided', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Document caption',
        type: PostType.DOCUMENT,
      };

      await expect(platform.publish(request, mockAccountConfig)).rejects.toThrow(
        "Field 'media' is required for type 'document'",
      );
    });
  });

  describe('publish - AUDIO type', () => {
    it('should publish audio with caption', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Audio caption',
        bodyFormat: 'html',
        media: [{ source: { kind: 'url', url: 'https://example.com/audio.mp3' } }],
        type: PostType.AUDIO,
      };

      botApi.reply('sendAudio', { message_id: 12345 });

      const result = await platform.publish(request, mockAccountConfig);

      expect(result.postId).toBe('12345');
      expect(botApi.lastPayload('sendAudio')).toEqual({
        chat_id: 'test-chat-id',
        audio: 'https://example.com/audio.mp3',
        caption: 'Audio caption',
        parse_mode: 'HTML',
        disable_notification: false,
      });
    });

    it('should throw error if media is missing for AUDIO type', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Audio caption',
        type: PostType.AUDIO,
      };

      await expect(platform.publish(request, mockAccountConfig)).rejects.toThrow(
        "Field 'media' is required for type 'audio'",
      );
    });
  });

  describe('publish - POLL type', () => {
    it('should publish poll successfully', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'What is your favorite color?',
        poll: {
          options: ['Red', 'Green', 'Blue'],
          multiple: false,
          anonymous: true,
        },
        type: PostType.POLL,
      };

      botApi.reply('sendPoll', { message_id: 12345 });

      const result = await platform.publish(request, mockAccountConfig);

      expect(result.postId).toBe('12345');
      expect(botApi.lastPayload('sendPoll')).toEqual({
        chat_id: 'test-chat-id',
        question: 'What is your favorite color?',
        options: ['Red', 'Green', 'Blue'],
        is_anonymous: true,
        allows_multiple_answers: false,
        disable_notification: false,
      });
    });
  });

  describe('publish - MediaInput object support', () => {
    it('should use fileId when provided instead of URL', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Image caption',
        media: [{ source: { kind: 'platformRef', ref: 'AgACAgIAAxkBAAIC...' } }],
        type: PostType.IMAGE,
      };

      botApi.reply('sendPhoto', { message_id: 12345 });

      await platform.publish(request, mockAccountConfig);

      expect(botApi.lastPayload('sendPhoto')).toEqual({
        chat_id: 'test-chat-id',
        photo: 'AgACAgIAAxkBAAIC...',
        caption: 'Image caption',
        parse_mode: 'HTML',
        has_spoiler: false,
        disable_notification: false,
      });
    });

    it('should send photo with sensitive (has_spoiler) flag', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Spoiler image',
        media: [
          {
            source: { kind: 'url', url: 'https://example.com/image.jpg' },
            sensitive: true,
          },
        ],
        type: PostType.IMAGE,
      };

      botApi.reply('sendPhoto', { message_id: 12345 });

      await platform.publish(request, mockAccountConfig);

      expect(botApi.lastPayload('sendPhoto')).toEqual({
        chat_id: 'test-chat-id',
        photo: 'https://example.com/image.jpg',
        caption: 'Spoiler image',
        parse_mode: 'HTML',
        has_spoiler: true,
        disable_notification: false,
      });
    });

    it('should send video with sensitive flag', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Spoiler video',
        media: [
          {
            source: { kind: 'url', url: 'https://example.com/video.mp4' },
            sensitive: true,
          },
        ],
        type: PostType.VIDEO,
      };

      botApi.reply('sendVideo', { message_id: 12345 });

      await platform.publish(request, mockAccountConfig);

      expect(botApi.lastPayload('sendVideo')).toEqual({
        chat_id: 'test-chat-id',
        video: 'https://example.com/video.mp4',
        caption: 'Spoiler video',
        parse_mode: 'HTML',
        has_spoiler: true,
        disable_notification: false,
      });
    });

    it('should treat non-URL platformRef as fileId', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Document caption',
        media: [{ source: { kind: 'platformRef', ref: 'BQACAgIAAxkBAAIC...' } }],
        type: PostType.DOCUMENT,
      };

      botApi.reply('sendDocument', { message_id: 12345 });

      await platform.publish(request, mockAccountConfig);

      expect(botApi.lastPayload('sendDocument')).toEqual({
        chat_id: 'test-chat-id',
        document: 'BQACAgIAAxkBAAIC...',
        caption: 'Document caption',
        parse_mode: 'HTML',
        disable_notification: false,
      });
    });
  });

  describe('publish - validation errors', () => {
    it('should throw error for POST type with media fields', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Test message',
        media: [{ source: { kind: 'url', url: 'https://example.com/image.jpg' } }],
        type: PostType.POST,
      };

      await expect(platform.publish(request, mockAccountConfig)).rejects.toThrow(
        "For type 'post', field 'media' must not be provided",
      );
    });

    it('should throw error for unsupported post type', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Test message',
        type: PostType.ARTICLE,
      };

      await expect(platform.publish(request, mockAccountConfig)).rejects.toThrow(
        "Post type 'article' is not supported for Telegram",
      );
    });
  });

  describe('buildPostUrl', () => {
    it('should build URL for public channels', () => {
      const url = (platform as any).buildPostUrl('@publicchannel', 12345);
      expect(url).toBe('https://t.me/publicchannel/12345');
    });

    it('should return undefined for private chats', () => {
      const url = (platform as any).buildPostUrl('123456789', 12345);
      expect(url).toBeUndefined();
    });

    it('should return undefined for negative chat IDs', () => {
      const url = (platform as any).buildPostUrl('-100123456789', 12345);
      expect(url).toBeUndefined();
    });

    it('should handle numeric chatId', () => {
      const url = (platform as any).buildPostUrl(123456789, 12345);
      expect(url).toBeUndefined();
    });
  });

  describe('preview', () => {
    const preview = (request: PostRequest) =>
      previewFromCapabilities(request, platform.capabilities, {
        validateExtra: (r: PostRequest, type: PostType) =>
          platform.validateExtra(r, mockAccountConfig, type),
      });

    it('should return invalid preview result when validation fails', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Test message',
        type: PostType.ARTICLE,
      };

      const result = preview(request);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.valid).toBe(false);
        expect(result.data.issues.some((i: Issue) => i.code === 'POST_TYPE_UNSUPPORTED')).toBe(
          true,
        );
      }
    });

    it('should return valid preview result with converted body', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Test message',
        type: PostType.POST,
      };

      const result = preview(request);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.valid).toBe(true);
        expect(result.data.detectedType).toBe(PostType.POST);
        expect(result.data.convertedBody).toBe('Test message');
        expect(result.data.convertedBodyLength).toBe(12);
      }
    });
  });

  describe('delete', () => {
    it('deletes a single message by postId', async () => {
      botApi.reply('deleteMessage', true);

      const result = await platform.delete({ postId: '12345' }, mockAccountConfig);

      expect(result).toEqual({
        status: 'deleted',
        parts: [{ id: '12345', status: 'deleted' }],
      });
      expect(botApi.lastPayload('deleteMessage')).toEqual({
        chat_id: 'test-chat-id',
        message_id: 12345,
      });
    });

    it('deletes all parts of a multi-part post', async () => {
      botApi.reply('deleteMessage', true);

      const result = await platform.delete(
        { postId: '12345', parts: [{ id: '12345' }, { id: '12346' }] },
        mockAccountConfig,
      );

      expect(result).toEqual({
        status: 'deleted',
        parts: [
          { id: '12345', status: 'deleted' },
          { id: '12346', status: 'deleted' },
        ],
      });
    });
  });

  describe('edge cases in publish', () => {
    it('throws non-retryable PlatformError when signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const request: PostRequest = {
        platform: 'telegram',
        body: 'Hello',
        type: PostType.POST,
      };

      await expect(
        platform.publish(request, mockAccountConfig, { signal: controller.signal }),
      ).rejects.toMatchObject({
        message: 'Request aborted before publishing',
        retryable: false,
      });
    });

    it('throws ValidationError when target is completely missing from both request and account', async () => {
      const accountWithoutTarget = { ...mockAccountConfig, target: '' };
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Hello',
        type: PostType.POST,
      };

      await expect(platform.publish(request, accountWithoutTarget)).rejects.toThrow(
        /Field "target" is required for Telegram/,
      );
    });

    it('logs warnings when request contains ignored fields', async () => {
      const warnSpy = vi.fn();
      const platformWithLogging = new TelegramPlatform({
        logger: { ...silentLogger, warn: warnSpy },
      });
      botApi.reply('sendMessage', { message_id: 100, chat: { id: 100 } });

      const request: PostRequest = {
        platform: 'telegram',
        body: 'Hello',
        title: 'Ignored Title',
        type: PostType.POST,
      };

      await platformWithLogging.publish(request, mockAccountConfig);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Warnings during publish'),
        'TelegramPlatform',
      );
    });
  });
});
