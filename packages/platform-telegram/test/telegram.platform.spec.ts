import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PostType } from '@bozonx/social-posting';
import type { ILogger, PostRequest } from '@bozonx/social-posting';

// Bot API calls are the boundary under test; grammY is mocked so nothing leaves the process.
const mockApi = {
  sendMessage: vi.fn(),
  sendPhoto: vi.fn(),
  sendVideo: vi.fn(),
  sendAudio: vi.fn(),
  sendMediaGroup: vi.fn(),
  sendDocument: vi.fn(),
};

vi.mock('grammy', () => ({
  Bot: vi.fn(function (this: { api: typeof mockApi }) {
    this.api = mockApi;
  }),
  InputFile: vi.fn(),
}));

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
      chatId: 'test-chat-id',
    },
    disableNotification: false,
  };

  beforeEach(() => {
    platform = new TelegramPlatform({
      logger: silentLogger,
      typeDetector: {
        detectType: vi.fn((request: PostRequest) => request.type ?? PostType.POST),
      } as never,
    });

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('platform metadata', () => {
    it('should have correct name', () => {
      expect(platform.name).toBe('telegram');
    });

    it('should support correct post types', () => {
      expect(platform.supportedTypes).toEqual([
        PostType.AUTO,
        PostType.POST,
        PostType.IMAGE,
        PostType.VIDEO,
        PostType.ALBUM,
        PostType.AUDIO,
        PostType.DOCUMENT,
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

      mockApi.sendMessage.mockResolvedValue({
        message_id: 12345,
        chat: { id: 'test-chat-id' },
      });

      const result = await platform.publish(request, mockAccountConfig);

      expect(result).toEqual({
        postId: '12345',
        url: undefined,
        raw: {
          ok: true,
          result: {
            message_id: 12345,
            chat: { id: 'test-chat-id' },
          },
        },
      });

      expect(mockApi.sendMessage).toHaveBeenCalledWith('test-chat-id', 'Test message', {
        disable_notification: false,
      });
    });

    it('should allow long text messages and delegate length validation to Telegram', async () => {
      const longBody = 'a'.repeat(5000);
      const request: PostRequest = {
        platform: 'telegram',
        body: longBody,
        type: PostType.POST,
      };

      mockApi.sendMessage.mockResolvedValue({ message_id: 12345 });

      const result = await platform.publish(request, mockAccountConfig);

      expect(result.postId).toBe('12345');
      expect(mockApi.sendMessage).toHaveBeenCalledWith(
        'test-chat-id',
        longBody,
        expect.objectContaining({ disable_notification: false }),
      );
    });

    it('should send body as-is without conversion and map bodyFormat to parse_mode', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: '**Markdown** text',
        bodyFormat: 'md',
        type: PostType.POST,
      };

      mockApi.sendMessage.mockResolvedValue({ message_id: 12345 });

      await platform.publish(request, mockAccountConfig);

      // Body should not be converted

      // parse_mode should be Markdown
      expect(mockApi.sendMessage).toHaveBeenCalledWith(
        'test-chat-id',
        '**Markdown** text',
        expect.objectContaining({ parse_mode: 'Markdown' }),
      );
    });

    it('should send HTML body as-is and set parse_mode to HTML', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: '<b>HTML</b> text',
        bodyFormat: 'html',
        type: PostType.POST,
      };

      mockApi.sendMessage.mockResolvedValue({ message_id: 12345 });

      await platform.publish(request, mockAccountConfig);

      expect(mockApi.sendMessage).toHaveBeenCalledWith(
        'test-chat-id',
        '<b>HTML</b> text',
        expect.objectContaining({ parse_mode: 'HTML' }),
      );
    });

    it('should support MarkdownV2 format directly via bodyFormat', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: '*Hello* _world_\\!',
        bodyFormat: 'MarkdownV2',
        type: PostType.POST,
      };

      mockApi.sendMessage.mockResolvedValue({ message_id: 12345 });

      await platform.publish(request, mockAccountConfig);

      expect(mockApi.sendMessage).toHaveBeenCalledWith(
        'test-chat-id',
        '*Hello* _world_\\!',
        expect.objectContaining({ parse_mode: 'MarkdownV2' }),
      );
    });

    it('should allow options.parse_mode to override bodyFormat', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: '*Hello* _world_\\!',
        bodyFormat: 'html',
        type: PostType.POST,
        options: {
          parse_mode: 'MarkdownV2',
        },
      };

      mockApi.sendMessage.mockResolvedValue({ message_id: 12345 });

      await platform.publish(request, mockAccountConfig);

      // options.parse_mode should override bodyFormat
      expect(mockApi.sendMessage).toHaveBeenCalledWith(
        'test-chat-id',
        '*Hello* _world_\\!',
        expect.objectContaining({ parse_mode: 'MarkdownV2' }),
      );
    });

    it('should use platform-specific parameters', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Test message',
        type: PostType.POST,
        options: {
          parse_mode: 'Markdown',
          disable_notification: true,
          link_preview_options: { is_disabled: true },
          reply_to_message_id: 999,
          protect_content: true,
          reply_markup: {
            inline_keyboard: [[{ text: 'Button', url: 'https://example.com' }]],
          },
        },
      };

      mockApi.sendMessage.mockResolvedValue({ message_id: 12345 });

      await platform.publish(request, mockAccountConfig);

      expect(mockApi.sendMessage).toHaveBeenCalledWith('test-chat-id', 'Test message', {
        disable_notification: false,
        // All options from request.options are spread here and override defaults
        ...request.options,
      });
    });

    it('should use disableNotification from request to override config', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Test message',
        type: PostType.POST,
        disableNotification: true,
      };

      mockApi.sendMessage.mockResolvedValue({ message_id: 12345 });

      // Config has disableNotification: false
      await platform.publish(request, mockAccountConfig);

      expect(mockApi.sendMessage).toHaveBeenCalledWith('test-chat-id', 'Test message', {
        disable_notification: true,
      });
    });

    it('should build URL for public channels', async () => {
      const publicAccountConfig: TelegramAccountConfig = {
        platform: 'telegram',
        auth: {
          apiKey: 'test-token',
          chatId: '@publicchannel',
        },
      };

      const request: PostRequest = {
        platform: 'telegram',
        body: 'Test message',
        type: PostType.POST,
      };

      mockApi.sendMessage.mockResolvedValue({ message_id: 12345 });

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
        cover: { src: 'https://example.com/image.jpg' },
        type: PostType.IMAGE,
      };

      mockApi.sendPhoto.mockResolvedValue({ message_id: 12345 });

      const result = await platform.publish(request, mockAccountConfig);

      expect(result.postId).toBe('12345');
      expect(mockApi.sendPhoto).toHaveBeenCalledWith(
        'test-chat-id',
        'https://example.com/image.jpg',
        expect.objectContaining({
          caption: 'Image caption',
          parse_mode: 'HTML',
          disable_notification: false,
          has_spoiler: false,
        }),
      );
    });

    it('should throw error if cover is missing for IMAGE type', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Image caption',
        type: PostType.IMAGE,
      };

      await expect(platform.publish(request, mockAccountConfig)).rejects.toThrow(
        "Field 'cover' is required for type 'image'",
      );
    });
  });

  describe('publish - VIDEO type', () => {
    it('should publish video with caption', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Video caption',
        bodyFormat: 'html',
        video: { src: 'https://example.com/video.mp4' },
        type: PostType.VIDEO,
      };

      mockApi.sendVideo.mockResolvedValue({ message_id: 12345 });

      const result = await platform.publish(request, mockAccountConfig);

      expect(result.postId).toBe('12345');
      expect(mockApi.sendVideo).toHaveBeenCalledWith(
        'test-chat-id',
        'https://example.com/video.mp4',
        expect.objectContaining({
          caption: 'Video caption',
          parse_mode: 'HTML',
          disable_notification: false,
          has_spoiler: false,
        }),
      );
    });

    it('should throw error if video is missing for VIDEO type', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Video caption',
        type: PostType.VIDEO,
      };

      await expect(platform.publish(request, mockAccountConfig)).rejects.toThrow(
        "Field 'video' is required for type 'video'",
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
          { src: 'https://example.com/image1.jpg' },
          { src: 'https://example.com/image2.jpg' },
          { src: 'https://example.com/video.mp4' },
        ],
        type: PostType.ALBUM,
      };

      mockApi.sendMediaGroup.mockResolvedValue([
        { message_id: 12345 },
        { message_id: 12346 },
        { message_id: 12347 },
      ]);

      const result = await platform.publish(request, mockAccountConfig);

      expect(result.postId).toBe('12345');
      expect(mockApi.sendMediaGroup).toHaveBeenCalledWith(
        'test-chat-id',
        [
          {
            type: 'photo',
            media: 'https://example.com/image1.jpg',
            caption: 'Album caption',
            parse_mode: 'HTML',
            has_spoiler: false,
          },
          {
            type: 'photo',
            media: 'https://example.com/image2.jpg',
            caption: undefined,
            has_spoiler: false,
          },
          {
            type: 'video',
            media: 'https://example.com/video.mp4',
            caption: undefined,
            has_spoiler: false,
          },
        ],
        { disable_notification: false },
      );
    });

    it('should throw error when using Telegram file_id in album without explicit type', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Album caption',
        bodyFormat: 'html',
        media: [{ src: 'BAACAgIAAxkBAAIC...' }],
        type: PostType.ALBUM,
      };

      await expect(platform.publish(request, mockAccountConfig)).rejects.toThrow(
        "Media item at index 0 must specify 'type' when using Telegram file_id in albums",
      );

      expect(mockApi.sendMediaGroup).not.toHaveBeenCalled();
    });

    it('should respect explicit media type for album items', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Album with explicit types',
        bodyFormat: 'html',
        media: [
          { src: 'https://example.com/file1', type: 'image' },
          { src: 'https://example.com/file2', type: 'video' },
          { src: 'https://example.com/file3' },
        ] as any,
        type: PostType.ALBUM,
      };

      mockApi.sendMediaGroup.mockResolvedValue([
        { message_id: 12345 },
        { message_id: 12346 },
        { message_id: 12347 },
      ]);

      await platform.publish(request, mockAccountConfig);

      expect(mockApi.sendMediaGroup).toHaveBeenCalledWith(
        'test-chat-id',
        [
          expect.objectContaining({ type: 'photo', media: 'https://example.com/file1' }),
          expect.objectContaining({ type: 'video', media: 'https://example.com/file2' }),
          // No explicit type and no extension -> falls back to photo
          expect.objectContaining({ type: 'photo', media: 'https://example.com/file3' }),
        ],
        { disable_notification: false },
      );
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
        document: { src: 'https://example.com/document.pdf' },
        type: PostType.DOCUMENT,
      };

      mockApi.sendDocument.mockResolvedValue({ message_id: 12345 });

      const result = await platform.publish(request, mockAccountConfig);

      expect(result.postId).toBe('12345');
      expect(mockApi.sendDocument).toHaveBeenCalledWith(
        'test-chat-id',
        'https://example.com/document.pdf',
        expect.objectContaining({
          caption: 'Document caption',
          parse_mode: 'HTML',
          disable_notification: false,
        }),
      );
    });

    it('should throw error if no document URL is provided', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Document caption',
        type: PostType.DOCUMENT,
      };

      await expect(platform.publish(request, mockAccountConfig)).rejects.toThrow(
        "Field 'document' is required for type 'document'",
      );
    });
  });

  describe('publish - AUDIO type', () => {
    it('should publish audio with caption', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Audio caption',
        bodyFormat: 'html',
        audio: { src: 'https://example.com/audio.mp3' },
        type: PostType.AUDIO,
      };

      mockApi.sendAudio.mockResolvedValue({ message_id: 12345 });

      const result = await platform.publish(request, mockAccountConfig);

      expect(result.postId).toBe('12345');
      expect(mockApi.sendAudio).toHaveBeenCalledWith(
        'test-chat-id',
        'https://example.com/audio.mp3',
        expect.objectContaining({
          caption: 'Audio caption',
          parse_mode: 'HTML',
          disable_notification: false,
        }),
      );
    });

    it('should throw error if audio is missing for AUDIO type', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Audio caption',
        type: PostType.AUDIO,
      };

      await expect(platform.publish(request, mockAccountConfig)).rejects.toThrow(
        "Field 'audio' is required for type 'audio'",
      );
    });
  });

  describe('publish - MediaInput object support', () => {
    it('should use fileId when provided instead of URL', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Image caption',
        cover: { src: 'AgACAgIAAxkBAAIC...' },
        type: PostType.IMAGE,
      };

      mockApi.sendPhoto.mockResolvedValue({ message_id: 12345 });

      await platform.publish(request, mockAccountConfig);

      expect(mockApi.sendPhoto).toHaveBeenCalledWith(
        'test-chat-id',
        'AgACAgIAAxkBAAIC...',
        expect.any(Object),
      );
    });

    it('should send photo with hasSpoiler flag', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Spoiler image',
        cover: { src: 'https://example.com/image.jpg', hasSpoiler: true },
        type: PostType.IMAGE,
      };

      mockApi.sendPhoto.mockResolvedValue({ message_id: 12345 });

      await platform.publish(request, mockAccountConfig);

      expect(mockApi.sendPhoto).toHaveBeenCalledWith(
        'test-chat-id',
        'https://example.com/image.jpg',
        expect.objectContaining({
          has_spoiler: true,
        }),
      );
    });

    it('should send video with hasSpoiler flag', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Spoiler video',
        video: { src: 'https://example.com/video.mp4', hasSpoiler: true },
        type: PostType.VIDEO,
      };

      mockApi.sendVideo.mockResolvedValue({ message_id: 12345 });

      await platform.publish(request, mockAccountConfig);

      expect(mockApi.sendVideo).toHaveBeenCalledWith(
        'test-chat-id',
        'https://example.com/video.mp4',
        expect.objectContaining({
          has_spoiler: true,
        }),
      );
    });

    it('should treat non-URL src as fileId', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Document caption',
        document: { src: 'BQACAgIAAxkBAAIC...' },
        type: PostType.DOCUMENT,
      };

      mockApi.sendDocument.mockResolvedValue({ message_id: 12345 });

      await platform.publish(request, mockAccountConfig);

      expect(mockApi.sendDocument).toHaveBeenCalledWith(
        'test-chat-id',
        'BQACAgIAAxkBAAIC...',
        expect.any(Object),
      );
    });
  });

  describe('publish - validation errors', () => {
    it('should throw error for POST type with media fields', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Test message',
        cover: { src: 'https://example.com/image.jpg' },
        type: PostType.POST,
      };

      await expect(platform.publish(request, mockAccountConfig)).rejects.toThrow(
        "For type 'post', media fields must not be provided",
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

    it('should handle numeric chatId for public channels', () => {
      // This is an edge case - numeric chatId won't start with '@'
      // but we ensure it doesn't throw an error
      const url = (platform as any).buildPostUrl(456361709, 12345);
      expect(url).toBeUndefined();
    });
  });

  describe('preview', () => {
    it('should return invalid preview result when validation fails', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Test message',
        type: PostType.ARTICLE,
      };

      const result = await platform.preview(request, mockAccountConfig as any);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.data.valid).toBe(false);
        expect(result.data.errors).toContain("Post type 'article' is not supported for Telegram");
        expect(Array.isArray(result.data.warnings)).toBe(true);
      }
    });

    it('should return valid preview result with converted body', async () => {
      const request: PostRequest = {
        platform: 'telegram',
        body: 'Test message',
        type: PostType.POST,
      };

      const result = await platform.preview(request, mockAccountConfig);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.valid).toBe(true);
        expect(result.data.detectedType).toBe(PostType.POST);
        expect(result.data.convertedBody).toBe('Test message');
        expect(result.data.convertedBodyLength).toBe(12);
      }
    });
  });
});
