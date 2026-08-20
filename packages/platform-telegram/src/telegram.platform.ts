import { ErrorCode, PlatformError, PostType, ValidationError } from '@bozonx/social-posting';
import type {
  AccountConfig,
  ILogger,
  MediaInput,
  ThumbnailInput,
  PostRequest,
  PostPart,
  PostRef,
  Issue,
} from '@bozonx/social-posting';
import {
  validateAgainstCapabilities,
  renderBody,
  resolveBodyTargetFormat,
} from '@bozonx/social-posting/platform';
import type {
  IPlatform,
  PlatformPublishResponse,
  PublishOptions,
  DeleteOptions,
  DeleteOutcome,
  DeletePartResult,
  CapabilityValidationOptions,
} from '@bozonx/social-posting/platform';
import { toTelegramInput } from './telegram-media.js';
import { toPlatformError } from './telegram-error.js';
import { TelegramApi } from './telegram-api.js';
import { MAX_CAPTION_LENGTH, MAX_MEDIA_GROUP_SIZE, telegramCapabilities } from './capabilities.js';

/**
 * Collaborators the Telegram platform needs.
 */
export interface TelegramPlatformDeps {
  /** Logger the platform writes to. */
  logger: ILogger;
  /** Custom fetch implementation for tests, regional endpoints or proxies. */
  fetch?: typeof fetch;
}

/**
 * Account configuration understood by the Telegram platform.
 */
export interface TelegramAccountConfig extends AccountConfig {
  /** Bot token. */
  auth: AccountConfig['auth'] & { apiKey?: string };
  /** Whether to disable notifications for this account by default */
  silent?: boolean;
  /** API request timeout in seconds. */
  apiTimeoutSeconds?: number;
}

const LOG_CONTEXT = 'TelegramPlatform';

export class TelegramPlatform implements IPlatform {
  readonly name = 'telegram';
  readonly capabilities = telegramCapabilities;

  private readonly logger: ILogger;
  private readonly fetch?: typeof fetch;

  constructor(deps: TelegramPlatformDeps) {
    this.logger = deps.logger;
    this.fetch = deps.fetch;
  }

  async publish(
    request: PostRequest,
    accountConfig: TelegramAccountConfig,
    options?: PublishOptions,
  ): Promise<PlatformPublishResponse> {
    const signal = options?.signal;

    if (signal?.aborted) {
      throw new PlatformError('Request aborted before publishing', ErrorCode.NETWORK_ERROR, {
        retryable: false,
      });
    }

    const {
      issues,
      warnings,
      detectedType: actualType,
    } = validateAgainstCapabilities(
      request,
      this.capabilities,
      this.validationHooks(accountConfig),
    );

    if (issues.length > 0) {
      throw new ValidationError(issues);
    }

    if (warnings.length > 0) {
      this.logger.warn(
        `Warnings during publish (type: ${actualType}): ${warnings.map((w: Issue) => w.message).join('; ')}`,
        LOG_CONTEXT,
      );
    }

    const api = new TelegramApi(
      accountConfig.auth.apiKey as string,
      accountConfig.apiTimeoutSeconds,
      this.fetch,
    );
    const chatId = requireChatId(request, accountConfig);

    const { processedBody, parseMode, silent, extra } = this.prepareMessageData(
      request,
      accountConfig,
      actualType,
    );

    if (request.inReplyTo?.id) {
      extra.reply_parameters = { message_id: Number(request.inReplyTo.id) };
    }

    this.logger.debug(
      `Sending to Telegram chat ${chatId} (type: ${actualType}, silent: ${silent})`,
      LOG_CONTEXT,
    );

    const startTime = Date.now();
    let result: TelegramMessage | TelegramMessage[];

    try {
      switch (actualType) {
        case PostType.POST:
          if (request.repostOf?.id) {
            const fromChatId = request.repostOf.target ?? chatId;
            const messageId = Number(request.repostOf.id);
            if (processedBody) {
              result = await api.call<TelegramMessage>(
                'copyMessage',
                {
                  chat_id: chatId,
                  from_chat_id: fromChatId,
                  message_id: messageId,
                  caption: processedBody,
                  parse_mode: parseMode,
                  disable_notification: silent,
                  ...extra,
                },
                signal,
              );
            } else {
              result = await api.call<TelegramMessage>(
                'forwardMessage',
                {
                  chat_id: chatId,
                  from_chat_id: fromChatId,
                  message_id: messageId,
                  disable_notification: silent,
                  ...extra,
                },
                signal,
              );
            }
          } else if (request.location) {
            if (request.location.name) {
              result = await api.call<TelegramMessage>(
                'sendVenue',
                {
                  chat_id: chatId,
                  latitude: request.location.latitude,
                  longitude: request.location.longitude,
                  title: request.location.name,
                  address: request.location.name,
                  disable_notification: silent,
                  ...extra,
                },
                signal,
              );
            } else {
              result = await api.call<TelegramMessage>(
                'sendLocation',
                {
                  chat_id: chatId,
                  latitude: request.location.latitude,
                  longitude: request.location.longitude,
                  disable_notification: silent,
                  ...extra,
                },
                signal,
              );
            }
          } else {
            result = await this.sendMessage(
              api,
              chatId,
              requireValue(processedBody, 'body'),
              parseMode,
              silent,
              extra,
              signal,
            );
          }
          break;

        case PostType.IMAGE: {
          const singleMedia = requireValue(request.media?.[0], 'media[0]');
          result = await this.sendPhoto(
            api,
            chatId,
            singleMedia,
            processedBody,
            parseMode,
            silent,
            request.sensitive ?? singleMedia.sensitive,
            extra,
            signal,
          );
          break;
        }

        case PostType.VIDEO: {
          const singleMedia = requireValue(request.media?.[0], 'media[0]');
          result = await this.sendVideo(
            api,
            chatId,
            singleMedia,
            request.thumbnail ?? singleMedia.thumbnail,
            processedBody,
            parseMode,
            silent,
            request.sensitive ?? singleMedia.sensitive,
            extra,
            signal,
          );
          break;
        }

        case PostType.AUDIO: {
          const singleMedia = requireValue(request.media?.[0], 'media[0]');
          result = await this.sendAudio(
            api,
            chatId,
            singleMedia,
            request.thumbnail ?? singleMedia.thumbnail,
            processedBody,
            parseMode,
            silent,
            extra,
            signal,
          );
          break;
        }

        case PostType.DOCUMENT: {
          const singleMedia = requireValue(request.media?.[0], 'media[0]');
          result = await this.sendDocument(
            api,
            chatId,
            singleMedia,
            request.thumbnail ?? singleMedia.thumbnail,
            processedBody,
            parseMode,
            silent,
            extra,
            signal,
          );
          break;
        }

        case PostType.ALBUM: {
          result = await this.sendMediaGroup(
            api,
            chatId,
            requireValue(request.media, 'media'),
            processedBody,
            parseMode,
            silent,
            request.sensitive,
            extra,
            signal,
          );
          break;
        }

        case PostType.POLL: {
          const poll = requireValue(request.poll, 'poll');
          const question =
            (processedBody && processedBody.length > 0 ? processedBody : request.title) ?? 'Poll';
          result = await api.call<TelegramMessage>(
            'sendPoll',
            {
              chat_id: chatId,
              question,
              options: poll.options,
              is_anonymous: poll.anonymous ?? extra.is_anonymous,
              allows_multiple_answers: poll.multiple ?? extra.allows_multiple_answers,
              open_period: poll.durationSecs ?? extra.open_period,
              disable_notification: silent,
              ...extra,
            },
            signal,
          );

          break;
        }

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

    const parts: PostPart[] = Array.isArray(result)
      ? result.map(m => ({
          id: String(m.message_id),
          target: chatId,
          url: this.buildPostUrl(chatId, m.message_id),
        }))
      : [
          {
            id: String(messageId),
            target: chatId,
            url: this.buildPostUrl(chatId, messageId),
          },
        ];

    const ref: PostRef = {
      postId: String(messageId),
      target: chatId,
      parts,
      extra: { chatId },
    };

    return {
      status: 'published',
      postId: String(messageId),
      url: this.buildPostUrl(chatId, messageId),
      parts,
      ref,
      raw: { ok: true, result },
    };
  }

  /**
   * Delete a published message or album by reference.
   */
  async delete(
    ref: PostRef,
    accountConfig: TelegramAccountConfig,
    options?: DeleteOptions,
  ): Promise<DeleteOutcome> {
    const api = new TelegramApi(
      accountConfig.auth.apiKey as string,
      accountConfig.apiTimeoutSeconds,
      this.fetch,
    );

    const chatId = ref.target ?? accountConfig.target;
    if (chatId === undefined) {
      throw new ValidationError('Field "target" is required for deleting a Telegram post');
    }

    const messageIds: string[] = [];
    if (ref.parts && ref.parts.length > 0) {
      messageIds.push(...ref.parts.map(p => p.id));
    } else if (ref.postId) {
      messageIds.push(ref.postId);
    } else {
      throw new ValidationError('PostRef must contain postId or parts to delete');
    }

    const results: DeletePartResult[] = [];

    for (const id of messageIds) {
      try {
        await api.call(
          'deleteMessage',
          { chat_id: chatId, message_id: Number(id) },
          options?.signal,
        );
        results.push({ id, status: 'deleted' });
      } catch (error) {
        const platformError = toPlatformError(error);
        if (
          platformError.message.includes('message to delete not found') ||
          platformError.message.includes('MESSAGE_ID_INVALID')
        ) {
          results.push({ id, status: 'alreadyGone' });
        } else {
          results.push({
            id,
            status: 'failed',
            error: {
              code: platformError.code,
              message: platformError.message,
              retryable: platformError.retryable,
              retryAfterMs: platformError.retryAfterMs,
              httpStatus: platformError.httpStatus,
              platformCode: platformError.platformCode,
              requestId: crypto.randomUUID(),
            },
          });
        }
      }
    }

    const allDeleted = results.every(r => r.status === 'deleted' || r.status === 'alreadyGone');

    return {
      status: allDeleted ? 'deleted' : 'partial',
      parts: results,
    };
  }

  /**
   * Telegram-specific checks.
   */
  validateExtra(
    request: PostRequest,
    accountConfig: TelegramAccountConfig,
    type: PostType,
  ): Issue[] {
    const issues: Issue[] = [];

    if (resolveChatId(request, accountConfig) === undefined) {
      issues.push({
        code: 'TARGET_REQUIRED',
        field: 'target',
        message:
          'Field "target" is required for Telegram (provide via request.target or account config target)',
      });
    }

    if (request.extra) {
      const protectedFields = [
        'chat_id',
        'text',
        'caption',
        'photo',
        'video',
        'audio',
        'document',
        'media',
        'question',
        'options',
        'from_chat_id',
        'message_id',
      ];
      const forbidden = Object.keys(request.extra).filter(k => protectedFields.includes(k));
      if (forbidden.length > 0) {
        issues.push({
          code: 'PROTECTED_EXTRA_FIELD',
          field: 'extra',
          message: `Cannot pass protected Telegram option(s) in extra: ${forbidden.join(', ')}`,
        });
      }
    }

    const bodyLimit = type === PostType.POST ? this.capabilities.maxBodyLength : MAX_CAPTION_LENGTH;
    const rendered = renderBody(
      request,
      { ...this.capabilities, maxBodyLength: bodyLimit },
      resolveBodyTargetFormat(request, this.capabilities),
    );
    if (rendered && rendered.length > (bodyLimit ?? Number.POSITIVE_INFINITY)) {
      issues.push({
        code: 'CAPTION_TOO_LONG',
        field: 'body',
        message: `Media captions are limited to ${MAX_CAPTION_LENGTH} characters for Telegram, got ${rendered.length}`,
      });
    }

    if (type === PostType.ALBUM) {
      request.media?.forEach((item, index) => {
        const isRef = item.source.kind === 'platformRef';
        if (isRef && !item.type) {
          issues.push({
            code: 'ALBUM_MEDIA_TYPE_REQUIRED',
            field: `media[${index}].type`,
            message: `Media item at index ${index} must specify 'type' when using Telegram file_id in albums`,
          });
        }
      });
    }

    return issues;
  }

  /** The hooks bundled the way the generic validator wants them. */
  private validationHooks(accountConfig: TelegramAccountConfig): CapabilityValidationOptions {
    return {
      validateExtra: (request: PostRequest, type: PostType) =>
        this.validateExtra(request, accountConfig, type),
    };
  }

  private prepareMessageData(
    request: PostRequest,
    accountConfig: TelegramAccountConfig,
    type: PostType,
  ) {
    const targetFormat = resolveBodyTargetFormat(request, this.capabilities);
    const processedBody = renderBody(
      request,
      { ...this.capabilities, maxBodyLength: type === PostType.POST ? 4096 : MAX_CAPTION_LENGTH },
      targetFormat,
    );

    let parseMode: string | undefined;
    const bodyFormat = targetFormat;

    if (bodyFormat === 'html') {
      parseMode = 'HTML';
    } else if (bodyFormat === 'md') {
      parseMode = 'Markdown';
    } else if (bodyFormat === 'text') {
      parseMode = undefined;
    } else {
      parseMode = bodyFormat;
    }

    const silent = request.silent ?? accountConfig.silent ?? false;
    const extra: Record<string, unknown> = { ...(request.extra ?? {}) };

    if (typeof extra.parse_mode === 'string') {
      parseMode = extra.parse_mode;
    }

    return { processedBody, targetFormat: bodyFormat, parseMode, silent, extra };
  }

  private async sendMessage(
    api: TelegramApi,
    chatId: string | number,
    text: string,
    parseMode: string | undefined,
    silent: boolean,
    extra: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<TelegramMessage> {
    return api.call<TelegramMessage>(
      'sendMessage',
      {
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_notification: silent,
        ...extra,
      },
      signal,
    );
  }

  private async sendPhoto(
    api: TelegramApi,
    chatId: string | number,
    photo: MediaInput,
    caption: string | undefined,
    parseMode: string | undefined,
    silent: boolean,
    hasSpoiler: boolean | undefined,
    extra: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<TelegramMessage> {
    return api.call<TelegramMessage>(
      'sendPhoto',
      {
        chat_id: chatId,
        photo: toTelegramInput(photo),
        caption,
        parse_mode: parseMode,
        disable_notification: silent,
        has_spoiler: hasSpoiler ?? photo.sensitive ?? false,
        ...extra,
      },
      signal,
    );
  }

  private async sendVideo(
    api: TelegramApi,
    chatId: string | number,
    video: MediaInput,
    thumbnail: ThumbnailInput | undefined,
    caption: string | undefined,
    parseMode: string | undefined,
    silent: boolean,
    hasSpoiler: boolean | undefined,
    extra: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<TelegramMessage> {
    return api.call<TelegramMessage>(
      'sendVideo',
      {
        chat_id: chatId,
        video: toTelegramInput(video),
        thumbnail: thumbnail ? toTelegramInput(thumbnail) : undefined,
        caption,
        parse_mode: parseMode,
        disable_notification: silent,
        has_spoiler: hasSpoiler ?? video.sensitive ?? false,
        ...extra,
      },
      signal,
    );
  }

  private async sendAudio(
    api: TelegramApi,
    chatId: string | number,
    audio: MediaInput,
    thumbnail: ThumbnailInput | undefined,
    caption: string | undefined,
    parseMode: string | undefined,
    silent: boolean,
    extra: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<TelegramMessage> {
    return api.call<TelegramMessage>(
      'sendAudio',
      {
        chat_id: chatId,
        audio: toTelegramInput(audio),
        thumbnail: thumbnail ? toTelegramInput(thumbnail) : undefined,
        caption,
        parse_mode: parseMode,
        disable_notification: silent,
        ...extra,
      },
      signal,
    );
  }

  private async sendDocument(
    api: TelegramApi,
    chatId: string | number,
    document: MediaInput,
    thumbnail: ThumbnailInput | undefined,
    caption: string | undefined,
    parseMode: string | undefined,
    silent: boolean,
    extra: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<TelegramMessage> {
    return api.call<TelegramMessage>(
      'sendDocument',
      {
        chat_id: chatId,
        document: toTelegramInput(document),
        thumbnail: thumbnail ? toTelegramInput(thumbnail) : undefined,
        caption,
        parse_mode: parseMode,
        disable_notification: silent,
        ...extra,
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
    silent: boolean,
    sensitive: boolean | undefined,
    extra: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<TelegramMessage[]> {
    const mediaGroup = media.slice(0, MAX_MEDIA_GROUP_SIZE).map((item, index) => {
      const mediaInput = toTelegramInput(item);
      const explicitType = item.type;
      const url = item.source.kind === 'url' ? item.source.url : undefined;

      return {
        type: mapMediaTypeToTelegram(explicitType, url),
        media: mediaInput,
        caption: index === 0 ? caption : undefined,
        parse_mode: parseMode && index === 0 ? parseMode : undefined,
        has_spoiler: sensitive ?? item.sensitive,
      };
    });

    return api.call<TelegramMessage[]>(
      'sendMediaGroup',
      {
        chat_id: chatId,
        media: mediaGroup,
        disable_notification: silent,
        ...extra,
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

function resolveChatId(
  request: PostRequest,
  accountConfig: TelegramAccountConfig,
): string | number | undefined {
  const finalId = request.target ?? accountConfig.target;

  if (finalId === undefined || finalId === '') {
    return undefined;
  }
  if (typeof finalId !== 'string' && typeof finalId !== 'number') {
    return undefined;
  }
  return finalId;
}

function requireChatId(
  request: PostRequest,
  accountConfig: TelegramAccountConfig,
): string | number {
  const chatId = resolveChatId(request, accountConfig);
  if (chatId === undefined) {
    throw new ValidationError(
      'Field "target" is required for Telegram (provide via request.target or account config target)',
    );
  }
  return chatId;
}
