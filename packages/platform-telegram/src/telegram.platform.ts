import {
  MediaInputHelper,
  PostType,
  ValidationError,
  validateMediaUrl,
} from '@bozonx/social-posting';
import type {
  AccountConfig,
  ILogger,
  IPlatform,
  MediaInput,
  PlatformPublishResponse,
  PostRequest,
  PreviewResult,
  PublishOptions,
} from '@bozonx/social-posting';
import { TelegramTypeDetector } from './telegram-type-detector.js';
import { toTelegramInput } from './telegram-media.js';
import { toPlatformError } from './telegram-error.js';
import { TelegramApi } from './telegram-api.js';
import { MAX_MEDIA_GROUP_SIZE, telegramCapabilities } from './capabilities.js';

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
  /** Whether to disable notifications for this account by default */
  disableNotification?: boolean;
  /** API request timeout in seconds (passed to grammY client as timeoutSeconds) */
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
    _options?: PublishOptions,
  ): Promise<PlatformPublishResponse> {
    const { errors, warnings, actualType } = this.validateRequest(request);

    if (errors.length > 0) {
      throw new ValidationError(errors);
    }

    if (warnings.length > 0) {
      this.logger.warn(
        `Warnings during publish (type: ${actualType}): ${warnings.join('; ')}`,
        LOG_CONTEXT,
      );
    }

    const api = new TelegramApi(accountConfig.auth.apiKey, accountConfig.apiTimeoutSeconds);
    const signal = _options?.signal;
    const chatId = this.resolveChatId(request, accountConfig);

    const { processedBody, parseMode, disableNotification, options } = this.prepareMessageData(
      request,
      accountConfig,
    );

    this.logger.debug(
      `Sending to Telegram chat ${chatId} (type: ${actualType}, silent: ${disableNotification})`,
      LOG_CONTEXT,
    );

    const startTime = Date.now();
    let result: any;

    try {
      switch (actualType) {
        case PostType.POST:
          result = await this.sendMessage(
            api,
            chatId,
            processedBody!, // Validated in validateRequest
            parseMode,
            disableNotification,
            options,
            signal,
          );
          break;

        case PostType.IMAGE:
          result = await this.sendPhoto(
            api,
            chatId,
            request.cover!,
            processedBody,
            parseMode,
            disableNotification,
            options,
            signal,
          );
          break;

        case PostType.VIDEO:
          result = await this.sendVideo(
            api,
            chatId,
            request.video!,
            processedBody,
            parseMode,
            disableNotification,
            options,
            signal,
          );
          break;

        case PostType.AUDIO:
          result = await this.sendAudio(
            api,
            chatId,
            request.audio!,
            processedBody,
            parseMode,
            disableNotification,
            options,
            signal,
          );
          break;

        case PostType.DOCUMENT:
          result = await this.sendDocument(
            api,
            chatId,
            request.document!,
            processedBody,
            parseMode,
            disableNotification,
            options,
            signal,
          );
          break;

        case PostType.ALBUM:
          result = await this.sendMediaGroup(
            api,
            chatId,
            request.media!,
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

    return {
      status: 'published',
      postId: String(result.message_id || result[0]?.message_id),
      url: this.buildPostUrl(chatId, result.message_id || result[0]?.message_id),
      raw: { ok: true, result },
    };
  }

  async preview(
    request: PostRequest,
    accountConfig: TelegramAccountConfig,
  ): Promise<PreviewResult> {
    const { errors, warnings, actualType } = this.validateRequest(request);

    if (errors.length > 0) {
      return {
        success: false,
        data: {
          valid: false,
          errors,
          warnings,
        },
      };
    }

    const { processedBody, targetFormat } = this.prepareMessageData(request, accountConfig);

    return {
      success: true,
      data: {
        valid: true,
        detectedType: actualType,
        convertedBody: processedBody,
        targetFormat: targetFormat as string,
        convertedBodyLength: processedBody?.length,
        warnings,
      },
    };
  }

  private validateRequest(request: PostRequest) {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Detect Type
    const actualType = this.typeDetector.detectType(request);

    if (!this.capabilities.supportedTypes.includes(actualType)) {
      errors.push(`Post type '${actualType}' is not supported for Telegram`);
    }

    // Required Fields
    errors.push(...this.getRequiredFieldsErrors(request, actualType));

    // Media URLs
    errors.push(...this.getMediaUrlErrors(request));

    // Ignored Fields
    warnings.push(...this.getIgnoredFieldsWarnings(request));
    warnings.push(...this.getIgnoredMediaWarnings(request, actualType));

    return { errors, warnings, actualType };
  }

  /**
   * Prepares message data for sending to Telegram.
   * Maps bodyFormat to parse_mode without converting the body content.
   * Body is sent as-is to Telegram API.
   *
   * Standard formats (text, html, md) are mapped to Telegram parse_mode.
   * Custom values (e.g., MarkdownV2) are passed as-is.
   * If parse_mode is specified in options, it overrides bodyFormat mapping.
   */
  private prepareMessageData(request: PostRequest, accountConfig: TelegramAccountConfig) {
    const processedBody = request.body;

    // Map bodyFormat to Telegram parse_mode
    let parseMode: string | undefined;
    const bodyFormat = request.bodyFormat || 'text';

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
    const options = request.options || {};

    // If parse_mode is specified in options, it overrides our mapping
    if (options.parse_mode !== undefined) {
      parseMode = String(options.parse_mode);
    }

    return { processedBody, targetFormat: bodyFormat, parseMode, disableNotification, options };
  }

  /**
   * Resolve Telegram chat identifier from request and account configuration.
   *
   * Priority:
   * 1. request.channelId
   * 2. accountConfig.channelId (from config.yaml)
   * 3. accountConfig.auth.chatId (legacy, for backward compatibility)
   */
  private resolveChatId(
    request: PostRequest,
    accountConfig: TelegramAccountConfig,
  ): string | number {
    const requestChannelId = request.channelId;
    const configChannelId = (accountConfig as any).channelId;
    const legacyChatId = (accountConfig.auth as any)?.chatId;

    const finalId = requestChannelId ?? configChannelId ?? legacyChatId;

    if (finalId === undefined || finalId === null || finalId === '') {
      throw new ValidationError(
        'Field "channelId" is required for Telegram (provide via request.channelId, account config channelId, or legacy auth.chatId)',
      );
    }

    if (typeof finalId !== 'string' && typeof finalId !== 'number') {
      throw new ValidationError('Field "channelId" must be a string or number');
    }

    return finalId;
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

  private getRequiredFieldsErrors(request: PostRequest, type: PostType): string[] {
    const errors: string[] = [];

    switch (type) {
      case PostType.POST:
        if (request.body === undefined || request.body === null || request.body.trim() === '') {
          errors.push("Field 'body' is required for type 'post'");
        }
        if (
          MediaInputHelper.isDefined(request.cover) ||
          MediaInputHelper.isDefined(request.video) ||
          MediaInputHelper.isDefined(request.audio) ||
          MediaInputHelper.isDefined(request.document) ||
          MediaInputHelper.isNotEmpty(request.media)
        ) {
          errors.push("For type 'post', media fields must not be provided");
        }
        break;

      case PostType.IMAGE:
        if (!MediaInputHelper.isDefined(request.cover)) {
          errors.push("Field 'cover' is required for type 'image'");
        }
        break;

      case PostType.VIDEO:
        if (!MediaInputHelper.isDefined(request.video)) {
          errors.push("Field 'video' is required for type 'video'");
        }
        break;

      case PostType.AUDIO:
        if (!MediaInputHelper.isDefined(request.audio)) {
          errors.push("Field 'audio' is required for type 'audio'");
        }
        break;

      case PostType.DOCUMENT:
        if (!MediaInputHelper.isDefined(request.document)) {
          errors.push("Field 'document' is required for type 'document'");
        }
        break;

      case PostType.ALBUM:
        if (!MediaInputHelper.isNotEmpty(request.media)) {
          errors.push("Field 'media' is required for type 'album'");
        }
        break;
    }
    return errors;
  }

  private getMediaUrlErrors(request: PostRequest): string[] {
    const errors: string[] = [];
    const validateIfUrl = (media: any) => {
      const url = MediaInputHelper.getUrl(media);
      if (url) {
        try {
          validateMediaUrl(url);
        } catch (e: any) {
          errors.push(e.message);
        }
      }
    };

    if (request.cover) validateIfUrl(request.cover);
    if (request.video) validateIfUrl(request.video);
    if (request.audio) validateIfUrl(request.audio);
    if (request.document) validateIfUrl(request.document);
    if (request.media) {
      request.media.forEach(validateIfUrl);
    }
    return errors;
  }

  private getIgnoredFieldsWarnings(request: PostRequest): string[] {
    const warnings: string[] = [];
    const ignoredFields: string[] = [];

    if (request.title) ignoredFields.push('title');
    if (request.description) ignoredFields.push('description');
    if (request.postLanguage) ignoredFields.push('postLanguage');
    if (request.tags) ignoredFields.push('tags');
    if (request.mode) ignoredFields.push('mode');
    if (request.scheduledAt) ignoredFields.push('scheduledAt');

    if (ignoredFields.length > 0) {
      warnings.push(
        `Fields ${ignoredFields.join(', ')} are not used by Telegram and will be ignored`,
      );
    }
    return warnings;
  }

  private getIgnoredMediaWarnings(request: PostRequest, type: PostType): string[] {
    const warnings: string[] = [];
    const ignoredFields: string[] = [];

    const checkField = (field: string, value: any, isArray = false) => {
      if (isArray ? MediaInputHelper.isNotEmpty(value) : MediaInputHelper.isDefined(value)) {
        ignoredFields.push(field);
      }
    };

    switch (type) {
      case PostType.IMAGE:
        checkField('media', request.media, true);
        checkField('video', request.video);
        checkField('audio', request.audio);
        checkField('document', request.document);
        break;

      case PostType.VIDEO:
        checkField('media', request.media, true);
        checkField('cover', request.cover);
        checkField('audio', request.audio);
        checkField('document', request.document);
        break;

      case PostType.AUDIO:
        checkField('media', request.media, true);
        checkField('cover', request.cover);
        checkField('video', request.video);
        checkField('document', request.document);
        break;

      case PostType.DOCUMENT:
        checkField('media', request.media, true);
        checkField('cover', request.cover);
        checkField('video', request.video);
        checkField('audio', request.audio);
        break;

      case PostType.ALBUM:
        checkField('cover', request.cover);
        checkField('video', request.video);
        checkField('audio', request.audio);
        checkField('document', request.document);
        break;
    }

    if (ignoredFields.length > 0) {
      warnings.push(`Fields ${ignoredFields.join(', ')} will be ignored for type '${type}'`);
    }
    return warnings;
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

/** The parts of a Bot API `Message` this platform reads. */
interface TelegramMessage {
  message_id: number;
  [key: string]: unknown;
}
