import {
  ErrorCode,
  MediaInputHelper,
  PlatformError,
  PostType,
  ValidationError,
  validateAgainstCapabilities,
  renderBody,
  resolveBodyTargetFormat,
} from '@bozonx/social-posting';
import type {
  AccountConfig,
  ILogger,
  IPlatform,
  MediaInput,
  PlatformPublishResponse,
  PostRequest,
  PublishOptions,
  CapabilityValidationOptions,
} from '@bozonx/social-posting';
import { TelegramTypeDetector } from './telegram-type-detector.js';
import { toTelegramInput } from './telegram-media.js';
import { toPlatformError } from './telegram-error.js';
import { TelegramApi } from './telegram-api.js';
import { MAX_CAPTION_LENGTH, MAX_MEDIA_GROUP_SIZE, telegramCapabilities } from './capabilities.js';

/**
 * Collaborators the Telegram platform needs. Passed explicitly — the package
 * carries no container and reads no ambient state.
 */
export interface TelegramPlatformDeps {
  /** Logger the platform writes to. */
  logger: ILogger;
  /** Overridable type detector; the default one is used when omitted. */
  typeDetector?: TelegramTypeDetector;
}

/**
 * Account configuration understood by the Telegram platform.
 */
export interface TelegramAccountConfig extends AccountConfig {
  /** Bot token, plus the legacy `chatId` some configurations still carry. */
  auth: AccountConfig['auth'] & { apiKey?: string; chatId?: string | number };
  /** Whether to disable notifications for this account by default */
  disableNotification?: boolean;
  /** API request timeout in seconds. */
  apiTimeoutSeconds?: number;
}

const LOG_CONTEXT = 'TelegramPlatform';

export class TelegramPlatform implements IPlatform {
  readonly name = 'telegram';
  readonly capabilities = telegramCapabilities;

  private readonly logger: ILogger;
  private readonly typeDetector: TelegramTypeDetector;

  constructor(deps: TelegramPlatformDeps) {
    this.logger = deps.logger;
    this.typeDetector = deps.typeDetector ?? new TelegramTypeDetector();
  }

  async publish(
    request: PostRequest,
    accountConfig: TelegramAccountConfig,
    // Telegram publishes in a single Bot API call, so there is no partial
    // progress to resume from and no deferred result to check on.
    options?: PublishOptions,
  ): Promise<PlatformPublishResponse> {
    const signal = options?.signal;

    // Cheapest possible check: a caller that already hung up gets no API call.
    if (signal?.aborted) {
      throw new PlatformError('Request aborted before publishing', ErrorCode.NETWORK_ERROR, {
        retryable: false,
      });
    }

    const {
      errors,
      warnings,
      detectedType: actualType,
    } = validateAgainstCapabilities(
      request,
      this.capabilities,
      this.validationHooks(accountConfig),
    );

    if (errors.length > 0) {
      throw new ValidationError(errors);
    }

    if (warnings.length > 0) {
      this.logger.warn(
        `Warnings during publish (type: ${actualType}): ${warnings.join('; ')}`,
        LOG_CONTEXT,
      );
    }

    // The auth validator has already established that this is a well-formed token.
    const api = new TelegramApi(
      accountConfig.auth.apiKey as string,
      accountConfig.apiTimeoutSeconds,
    );
    const chatId = requireChatId(request, accountConfig);

    const {
      processedBody,
      parseMode,
      disableNotification,
      options: platformOptions,
    } = this.prepareMessageData(request, accountConfig);

    this.logger.debug(
      `Sending to Telegram chat ${chatId} (type: ${actualType}, silent: ${disableNotification})`,
      LOG_CONTEXT,
    );

    const startTime = Date.now();
    let result: TelegramMessage | TelegramMessage[];

    try {
      switch (actualType) {
        case PostType.POST:
          result = await this.sendMessage(
            api,
            chatId,
            requireValue(processedBody, 'body'),
            parseMode,
            disableNotification,
            platformOptions,
            signal,
          );
          break;

        case PostType.IMAGE:
          result = await this.sendPhoto(
            api,
            chatId,
            requireValue(request.cover, 'cover'),
            processedBody,
            parseMode,
            disableNotification,
            platformOptions,
            signal,
          );
          break;

        case PostType.VIDEO:
          result = await this.sendVideo(
            api,
            chatId,
            requireValue(request.video, 'video'),
            processedBody,
            parseMode,
            disableNotification,
            platformOptions,
            signal,
          );
          break;

        case PostType.AUDIO:
          result = await this.sendAudio(
            api,
            chatId,
            requireValue(request.audio, 'audio'),
            processedBody,
            parseMode,
            disableNotification,
            platformOptions,
            signal,
          );
          break;

        case PostType.DOCUMENT:
          result = await this.sendDocument(
            api,
            chatId,
            requireValue(request.document, 'document'),
            processedBody,
            parseMode,
            disableNotification,
            platformOptions,
            signal,
          );
          break;

        case PostType.ALBUM:
          result = await this.sendMediaGroup(
            api,
            chatId,
            requireValue(request.media, 'media'),
            processedBody,
            parseMode,
            disableNotification,
            signal,
          );
          break;

        default:
          throw new ValidationError(`Unsupported post type: ${actualType}`);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      const platformError = toPlatformError(error);
      this.logger.error(
        `Telegram API request failed after ${duration}ms (chat: ${chatId}, type: ${actualType}, code: ${platformError.code})`,
        platformError.stack,
        LOG_CONTEXT,
      );
      throw platformError;
    }

    const totalDuration = Date.now() - startTime;
    this.logger.log(
      `Published to Telegram chat ${chatId} in ${totalDuration}ms (type: ${actualType})`,
      LOG_CONTEXT,
    );

    const messageId = Array.isArray(result) ? result[0]?.message_id : result.message_id;
    if (messageId === undefined) {
      throw new PlatformError('Telegram returned no message ID', ErrorCode.PLATFORM_ERROR, {
        retryable: false,
      });
    }

    return {
      status: 'published',
      postId: String(messageId),
      url: this.buildPostUrl(chatId, messageId),
      raw: { ok: true, result },
    };
  }

  /**
   * Telegram's own type priority. The generic rules agree with it today, but
   * the network is free to change its mind about, say, cover-plus-video.
   */
  detectType(request: PostRequest): PostType {
    return this.typeDetector.detectType(request);
  }

  /**
   * Telegram-specific checks: a target chat must be resolvable, captions on
   * media are limited far below the 4096 characters a text message allows, and
   * an album item identified by `file_id` cannot have its kind guessed.
   *
   * There is deliberately no `preview()`: Telegram offers no dry-run, so the
   * client previews from the descriptor and these hooks, which is exactly what
   * `publish()` checks.
   */
  validateExtra(
    request: PostRequest,
    accountConfig: TelegramAccountConfig,
    type: PostType,
  ): string[] {
    const errors: string[] = [];

    if (resolveChatId(request, accountConfig) === undefined) {
      errors.push(
        'Field "channelId" is required for Telegram (provide via request.channelId, account config channelId, or legacy auth.chatId)',
      );
    }

    if (type !== PostType.POST && request.body && request.body.length > MAX_CAPTION_LENGTH) {
      errors.push(
        `Media captions are limited to ${MAX_CAPTION_LENGTH} characters for Telegram, got ${request.body.length}`,
      );
    }

    if (type === PostType.ALBUM) {
      request.media?.forEach((item, index) => {
        const url = MediaInputHelper.getUrl(item);
        const fileId = MediaInputHelper.getPlatformRef(item);
        if (!url && fileId && !MediaInputHelper.getType(item)) {
          errors.push(
            `Media item at index ${index} must specify 'type' when using Telegram file_id in albums`,
          );
        }
      });
    }

    return errors;
  }

  /** The hooks bundled the way the generic validator wants them. */
  private validationHooks(accountConfig: TelegramAccountConfig): CapabilityValidationOptions {
    return {
      detectType: request => this.detectType(request),
      validateExtra: (request, type) => this.validateExtra(request, accountConfig, type),
    };
  }

  private prepareMessageData(request: PostRequest, accountConfig: TelegramAccountConfig) {
    const targetFormat = resolveBodyTargetFormat(request, this.capabilities);
    const processedBody = renderBody(request, this.capabilities, targetFormat);

    // Map bodyFormat to Telegram parse_mode
    let parseMode: string | undefined;
    const bodyFormat = targetFormat;

    // Standard format mappings
    if (bodyFormat === 'html') {
      parseMode = 'HTML';
    } else if (bodyFormat === 'md') {
      parseMode = 'Markdown';
    } else if (bodyFormat === 'text') {
      // Plain text - no parse_mode
      parseMode = undefined;
    } else {
      // Any other value is passed as-is (e.g., 'MarkdownV2' → parse_mode: 'MarkdownV2')
      parseMode = bodyFormat;
    }

    const disableNotification =
      request.disableNotification ?? accountConfig.disableNotification ?? false;

    // Options are passed directly to Telegram API
    const options = telegramOptions(request.options);

    // If parse_mode is specified in options, it overrides our mapping
    if (options.parse_mode !== undefined) {
      parseMode = String(options.parse_mode);
    }

    return { processedBody, targetFormat: bodyFormat, parseMode, disableNotification, options };
  }

  private async sendMessage(
    api: TelegramApi,
    chatId: string | number,
    text: string,
    parseMode: string | undefined,
    disableNotification: boolean,
    options: TelegramOptions,
    signal?: AbortSignal,
  ): Promise<TelegramMessage> {
    return api.call<TelegramMessage>(
      'sendMessage',
      {
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_notification: disableNotification,
        ...options,
      },
      signal,
    );
  }

  private async sendPhoto(
    api: TelegramApi,
    chatId: string | number,
    cover: MediaInput,
    caption: string | undefined,
    parseMode: string | undefined,
    disableNotification: boolean,
    options: TelegramOptions,
    signal?: AbortSignal,
  ): Promise<TelegramMessage> {
    return api.call<TelegramMessage>(
      'sendPhoto',
      {
        chat_id: chatId,
        photo: toTelegramInput(cover),
        caption,
        parse_mode: parseMode,
        disable_notification: disableNotification,
        has_spoiler: MediaInputHelper.getHasSpoiler(cover),
        ...options,
      },
      signal,
    );
  }

  private async sendVideo(
    api: TelegramApi,
    chatId: string | number,
    video: MediaInput,
    caption: string | undefined,
    parseMode: string | undefined,
    disableNotification: boolean,
    options: TelegramOptions,
    signal?: AbortSignal,
  ): Promise<TelegramMessage> {
    return api.call<TelegramMessage>(
      'sendVideo',
      {
        chat_id: chatId,
        video: toTelegramInput(video),
        caption,
        parse_mode: parseMode,
        disable_notification: disableNotification,
        has_spoiler: MediaInputHelper.getHasSpoiler(video),
        ...options,
      },
      signal,
    );
  }

  private async sendAudio(
    api: TelegramApi,
    chatId: string | number,
    audio: MediaInput,
    caption: string | undefined,
    parseMode: string | undefined,
    disableNotification: boolean,
    options: TelegramOptions,
    signal?: AbortSignal,
  ): Promise<TelegramMessage> {
    return api.call<TelegramMessage>(
      'sendAudio',
      {
        chat_id: chatId,
        audio: toTelegramInput(audio),
        caption,
        parse_mode: parseMode,
        disable_notification: disableNotification,
        ...options,
      },
      signal,
    );
  }

  private async sendDocument(
    api: TelegramApi,
    chatId: string | number,
    document: MediaInput,
    caption: string | undefined,
    parseMode: string | undefined,
    disableNotification: boolean,
    options: TelegramOptions,
    signal?: AbortSignal,
  ): Promise<TelegramMessage> {
    return api.call<TelegramMessage>(
      'sendDocument',
      {
        chat_id: chatId,
        document: toTelegramInput(document),
        caption,
        parse_mode: parseMode,
        disable_notification: disableNotification,
        ...options,
      },
      signal,
    );
  }

  private async sendMediaGroup(
    api: TelegramApi,
    chatId: string | number,
    media: MediaInput[],
    caption: string | undefined,
    parseMode: string | undefined,
    disableNotification: boolean,
    signal?: AbortSignal,
  ): Promise<TelegramMessage[]> {
    const mediaGroup = media.slice(0, MAX_MEDIA_GROUP_SIZE).map((item, index) => {
      const url = MediaInputHelper.getUrl(item);
      const fileId = MediaInputHelper.getPlatformRef(item);
      const explicitType = MediaInputHelper.getType(item);
      const mediaInput = fileId || url;

      if (!mediaInput) {
        throw new ValidationError(`Media item at index ${index} must have either url or fileId`);
      }

      if (!url && fileId && !explicitType) {
        throw new ValidationError(
          `Media item at index ${index} must specify 'type' when using Telegram file_id in albums`,
        );
      }

      return {
        type: mapMediaTypeToTelegram(explicitType, url),
        media: mediaInput,
        caption: index === 0 ? caption : undefined,
        parse_mode: parseMode && index === 0 ? parseMode : undefined,
        has_spoiler: MediaInputHelper.getHasSpoiler(item),
      };
    });

    return api.call<TelegramMessage[]>(
      'sendMediaGroup',
      {
        chat_id: chatId,
        media: mediaGroup,
        disable_notification: disableNotification,
      },
      signal,
    );
  }

  private buildPostUrl(chatId: string | number, messageId: number): string | undefined {
    const chatIdStr = String(chatId);
    if (chatIdStr.startsWith('@')) {
      const channelName = chatIdStr.substring(1);
      return `https://t.me/${channelName}/${messageId}`;
    }
    return undefined;
  }
}

/**
 * Media groups accept only `photo` and `video`, so every other kind of media
 * is sent as a photo; when the type is not stated, the URL extension decides.
 */
function mapMediaTypeToTelegram(
  explicitType: string | undefined,
  url: string | undefined,
): 'photo' | 'video' {
  if (explicitType) {
    return explicitType === 'video' ? 'video' : 'photo';
  }

  const isVideo = url ? /\.(mp4|mov|avi|mkv)$/i.test(url) : false;
  return isVideo ? 'video' : 'photo';
}

/** Platform-specific options passed straight through to the Bot API. */
type TelegramOptions = Record<string, unknown>;

/** Parameters callers may safely customize without changing the validated destination/content. */
const ALLOWED_TELEGRAM_OPTIONS = new Set([
  'parse_mode',
  'message_thread_id',
  'protect_content',
  'reply_parameters',
  'reply_markup',
  'link_preview_options',
  'show_caption_above_media',
  'has_spoiler',
]);

function telegramOptions(input: Record<string, unknown> | undefined): TelegramOptions {
  if (!input) return {};
  const rejected = Object.keys(input).filter(key => !ALLOWED_TELEGRAM_OPTIONS.has(key));
  if (rejected.length > 0) {
    throw new ValidationError(
      `Unsupported or protected Telegram option(s): ${rejected.join(', ')}`,
    );
  }
  return { ...input };
}

/** The parts of a Bot API `Message` this platform reads. */
interface TelegramMessage {
  message_id: number;
  [key: string]: unknown;
}

function requireValue<T>(value: T | undefined, field: string): T {
  if (value === undefined) {
    throw new ValidationError(`Field '${field}' is required`);
  }
  return value;
}

/**
 * Resolve the chat to publish to.
 *
 * Priority: `request.channelId`, then the account's `channelId`, then the
 * legacy `auth.chatId`.
 *
 * @returns The chat identifier, or undefined when none is configured.
 */
function resolveChatId(
  request: PostRequest,
  accountConfig: TelegramAccountConfig,
): string | number | undefined {
  const legacyChatId = (accountConfig.auth as Record<string, unknown> | undefined)?.chatId;
  const finalId = request.channelId ?? accountConfig.channelId ?? legacyChatId;

  if (finalId === undefined || finalId === null || finalId === '') {
    return undefined;
  }
  if (typeof finalId !== 'string' && typeof finalId !== 'number') {
    return undefined;
  }
  return finalId;
}

/**
 * The publish path's view of {@link resolveChatId}: validation has already run,
 * so an absent chat here is a programming error rather than a user one.
 */
function requireChatId(
  request: PostRequest,
  accountConfig: TelegramAccountConfig,
): string | number {
  const chatId = resolveChatId(request, accountConfig);
  if (chatId === undefined) {
    throw new ValidationError(
      'Field "channelId" is required for Telegram (provide via request.channelId, account config channelId, or legacy auth.chatId)',
    );
  }
  return chatId;
}
