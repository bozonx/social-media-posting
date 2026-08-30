import { ErrorCode, PlatformError, PostType, ValidationError } from '@bozonx/social-posting';
import type {
  AccountConfig,
  ILogger,
  Issue,
  MediaInput,
  PlatformTarget,
  PostPart,
  PostRef,
  PostRequest,
} from '@bozonx/social-posting';
import {
  MediaFetcher,
  buildMultipartFormData,
  normalizeTarget,
  renderBody,
  resolveBodyTargetFormat,
  validateAgainstCapabilities,
} from '@bozonx/social-posting/platform';
import type {
  CapabilityValidationOptions,
  DeleteOptions,
  DeleteOutcome,
  DeletePartResult,
  IPlatform,
  MultipartPart,
  PlatformPublishResponse,
  PublishOptions,
  RuntimeCapabilities,
} from '@bozonx/social-posting/platform';
import { DiscordApi } from './discord-api.js';
import type { DiscordAuthorization, DiscordMessage } from './discord-api.js';
import { authModeOf, parseWebhookUrl } from './discord-auth.validator.js';
import type { DiscordAuthMode } from './discord-auth.validator.js';
import {
  ATTACHMENT_BYTES_BY_BOOST_TIER,
  DEFAULT_MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  MAX_MESSAGE_LENGTH,
  discordCapabilities,
} from './capabilities.js';

/** Collaborators this platform needs, passed explicitly. */
export interface DiscordPlatformDeps {
  logger: ILogger;
  fetch?: typeof fetch;
}

/** Account configuration understood by the Discord platform. */
export interface DiscordAccountConfig extends AccountConfig {
  auth: AccountConfig['auth'] & {
    /** Webhook URL: credential and destination in one secret. */
    webhookUrl?: string;
    /** Bot token, for an account that posts as a bot. */
    botToken?: string;
  };
  /** Default channel, already normalized by the core. */
  target?: PlatformTarget;
  /** API request timeout in seconds. */
  apiTimeoutSeconds?: number;
}

/** Platform-specific options a caller may pass in `request.extra`. */
export interface DiscordExtra {
  embeds?: unknown[];
  tts?: boolean;
  flags?: number;
  allowed_mentions?: Record<string, unknown>;
  components?: unknown[];
  /** Webhook only. */
  username?: string;
  /** Webhook only. */
  avatar_url?: string;
}

const LOG_CONTEXT = 'DiscordPlatform';
/** Discord's own poll default, in hours. */
const DEFAULT_POLL_DURATION_HOURS = 24;
const SECS_PER_HOUR = 3_600;

/**
 * Discord, over both of its access models.
 *
 * A webhook URL and a bot token are not two ways of saying the same thing: a
 * webhook cannot reply to a message and posts under its own name, while a bot
 * needs channel permissions and can delete what it wrote. The adapter picks by
 * what the account carries and refuses what the chosen model cannot do, rather
 * than pretending the difference away.
 */
export class DiscordPlatform implements IPlatform {
  readonly name = 'discord';
  readonly capabilities = discordCapabilities;

  private readonly logger: ILogger;
  private readonly fetch?: typeof fetch;
  private readonly media: MediaFetcher;

  constructor(deps: DiscordPlatformDeps) {
    this.logger = deps.logger;
    this.fetch = deps.fetch;
    this.media = new MediaFetcher();
  }

  async publish(
    request: PostRequest,
    accountConfig: DiscordAccountConfig,
    options?: PublishOptions,
  ): Promise<PlatformPublishResponse> {
    const signal = options?.signal;

    if (signal?.aborted) {
      throw new PlatformError('Request aborted before publishing', ErrorCode.NETWORK_ERROR, {
        retryable: false,
      });
    }

    const capabilities = options?.capabilities ?? this.capabilities;
    const { issues, warnings, detectedType } = validateAgainstCapabilities(
      request,
      capabilities,
      this.validationHooks(accountConfig, request),
    );

    if (issues.length > 0) {
      throw new ValidationError(issues);
    }

    if (warnings.length > 0) {
      this.logger.warn(
        `Warnings during publish (type: ${detectedType}): ${warnings.map(w => w.message).join('; ')}`,
        LOG_CONTEXT,
      );
    }

    const mode = requireAuthMode(accountConfig);
    const api = this.apiFor(accountConfig);
    const payload = this.buildPayload(request, capabilities, mode);
    const attachments = await this.openAttachments(request.media ?? [], capabilities, signal);

    const url = this.publishUrl(api, request, accountConfig, mode);
    const body = attachments.length > 0 ? toMultipart(payload, attachments) : payload;

    this.logger.debug(
      `Sending to Discord via ${mode} (type: ${detectedType}, attachments: ${attachments.length})`,
      LOG_CONTEXT,
    );

    const message = await api.call<DiscordMessage>({
      url,
      method: 'POST',
      authorization: authorizationFor(accountConfig, mode),
      body,
      signal,
    });

    if (!message?.id) {
      // A webhook executed without `wait=true` answers 204 and reveals nothing.
      // We always ask for the message, so an empty body here means the call
      // succeeded but the outcome cannot be addressed — which is not a post we
      // can hand back a reference to.
      throw new PlatformError(
        'Discord accepted the message but returned no message object',
        ErrorCode.UNKNOWN_OUTCOME,
        { retryable: false },
      );
    }

    const target = resolveTarget(request, accountConfig);
    const guildId = message.guild_id ?? guildIdOf(target);
    const postUrl = buildMessageUrl(guildId, message.channel_id, message.id);
    const part: PostPart = { id: message.id, url: postUrl };

    return {
      status: 'published',
      postId: message.id,
      url: postUrl,
      parts: [part],
      ref: {
        postId: message.id,
        parts: [part],
        // The channel from the response, not from the request: a webhook knows
        // its own channel and the request may never have named one.
        target: { id: message.channel_id, ...(guildId ? { guildId } : {}) },
      },
      raw: message,
    };
  }

  /**
   * Delete a message this account published.
   *
   * Both models can delete their own messages, by different routes: a bot by
   * channel and message id, a webhook through its own token.
   */
  async delete(
    ref: PostRef,
    accountConfig: DiscordAccountConfig,
    options?: DeleteOptions,
  ): Promise<DeleteOutcome> {
    const mode = requireAuthMode(accountConfig);
    const api = this.apiFor(accountConfig);

    const ids =
      ref.parts && ref.parts.length > 0
        ? ref.parts.map(part => part.id)
        : ref.postId
          ? [ref.postId]
          : [];

    if (ids.length === 0) {
      throw new ValidationError('PostRef must contain postId or parts to delete');
    }

    const channelId =
      mode === 'bot' ? (normalizeTarget(ref.target)?.id ?? accountConfig.target?.id) : undefined;

    if (mode === 'bot' && !channelId) {
      throw new ValidationError('Field "target" is required for deleting a Discord message');
    }

    const results: DeletePartResult[] = [];

    for (const id of ids) {
      const url =
        mode === 'bot'
          ? api.endpoint(
              `/channels/${encodeURIComponent(channelId as string)}/messages/${encodeURIComponent(id)}`,
            )
          : api.endpoint(`${webhookPath(accountConfig)}/messages/${encodeURIComponent(id)}`);

      try {
        await api.call({
          url,
          method: 'DELETE',
          authorization: authorizationFor(accountConfig, mode),
          signal: options?.signal,
        });
        results.push({ id, status: 'deleted' });
      } catch (error) {
        const platformError =
          error instanceof PlatformError
            ? error
            : new PlatformError(String(error), ErrorCode.PLATFORM_ERROR, { retryable: true });

        if (platformError.httpStatus === 404) {
          results.push({ id, status: 'alreadyGone' });
          continue;
        }

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

    const settled = results.every(r => r.status === 'deleted' || r.status === 'alreadyGone');
    return { status: settled ? 'deleted' : 'partial', parts: results };
  }

  /**
   * What this server actually allows, asked at publish time.
   *
   * The attachment ceiling is a property of the guild's boost tier, not of
   * Discord: the shipped descriptor states the unboosted floor, and a boosted
   * server would otherwise have uploads refused locally that it would have
   * accepted. Only a bot token can ask — a webhook cannot read the guild — so
   * a webhook account keeps the floor.
   */
  async resolveCapabilities(
    accountConfig: DiscordAccountConfig,
    signal?: AbortSignal,
  ): Promise<RuntimeCapabilities> {
    const fetchedAt = new Date().toISOString();
    const guildId = guildIdOf(accountConfig.target);

    if (authModeOf(accountConfig.auth) !== 'bot' || !guildId) {
      return { capabilities: {}, cacheableForSecs: 3600, fetchedAt };
    }

    const api = this.apiFor(accountConfig);
    const guild = await api.call<{ premium_tier?: number }>({
      url: api.endpoint(`/guilds/${encodeURIComponent(guildId)}`),
      method: 'GET',
      authorization: authorizationFor(accountConfig, 'bot'),
      signal,
    });

    const tier = guild?.premium_tier ?? 0;
    const maxBytes = ATTACHMENT_BYTES_BY_BOOST_TIER[tier] ?? DEFAULT_MAX_ATTACHMENT_BYTES;

    const media: Record<string, { maxBytes: number }> = {};
    for (const kind of Object.keys(this.capabilities.media ?? {})) {
      media[kind] = { maxBytes };
    }

    return {
      // A boost tier changes when a server gains or loses boosts, which is
      // slow: an hour of caching costs nothing and saves a call per publish.
      capabilities: { media },
      cacheableForSecs: 3600,
      fetchedAt,
    };
  }

  /** Rules the capability descriptor cannot express. */
  validateExtra(
    request: PostRequest,
    accountConfig: DiscordAccountConfig,
    type: PostType,
  ): Issue[] {
    const issues: Issue[] = [];
    const mode = authModeOf(accountConfig.auth);

    if (!mode) {
      issues.push({
        code: 'AUTH_MODE_MISSING',
        field: 'auth',
        message: "Discord auth requires either 'webhookUrl' or 'botToken'",
      });
      return issues;
    }

    if (mode === 'bot' && !resolveTarget(request, accountConfig)) {
      issues.push({
        code: 'TARGET_REQUIRED',
        field: 'target',
        message:
          'Field "target" is required for a Discord bot account (provide the channel id via request.target or account config target)',
      });
    }

    if (mode === 'webhook' && request.inReplyTo?.id) {
      issues.push({
        code: 'REPLY_UNSUPPORTED_FOR_WEBHOOK',
        field: 'inReplyTo',
        message: 'A Discord webhook cannot reply to a message; use a bot token account for replies',
      });
    }

    const extra = (request.extra ?? {}) as DiscordExtra & Record<string, unknown>;

    if (mode === 'bot') {
      const webhookOnly = ['username', 'avatar_url'].filter(key => extra[key] !== undefined);
      if (webhookOnly.length > 0) {
        issues.push({
          code: 'WEBHOOK_ONLY_EXTRA_FIELD',
          field: 'extra',
          message: `Option(s) only a webhook accepts: ${webhookOnly.join(', ')}`,
        });
      }
    }

    const protectedFields = ['content', 'attachments', 'files', 'poll', 'message_reference'];
    const forbidden = Object.keys(extra).filter(key => protectedFields.includes(key));
    if (forbidden.length > 0) {
      issues.push({
        code: 'PROTECTED_EXTRA_FIELD',
        field: 'extra',
        message: `Cannot pass protected Discord option(s) in extra: ${forbidden.join(', ')}`,
      });
    }

    if ((request.media?.length ?? 0) > MAX_ATTACHMENTS) {
      issues.push({
        code: 'TOO_MANY_ATTACHMENTS',
        field: 'media',
        message: `Discord accepts at most ${MAX_ATTACHMENTS} attachments per message`,
      });
    }

    if (type === PostType.POLL && request.poll) {
      const seconds = request.poll.durationSecs;
      if (seconds !== undefined && seconds % SECS_PER_HOUR !== 0) {
        issues.push({
          code: 'POLL_DURATION_NOT_WHOLE_HOURS',
          field: 'poll',
          message:
            'Discord poll durations are whole hours; durationSecs must be a multiple of 3600',
        });
      }
      if (request.poll.anonymous) {
        issues.push({
          code: 'POLL_ANONYMOUS_UNSUPPORTED',
          field: 'poll',
          message: 'Discord polls always show who voted; anonymous polls are unsupported',
        });
      }
    }

    return issues;
  }

  private validationHooks(
    accountConfig: DiscordAccountConfig,
    request?: PostRequest,
  ): CapabilityValidationOptions {
    return {
      target: request ? resolveTarget(request, accountConfig) : accountConfig.target,
      validateExtra: (candidate: PostRequest, type: PostType) =>
        this.validateExtra(candidate, accountConfig, type),
    };
  }

  private apiFor(accountConfig: DiscordAccountConfig): DiscordApi {
    return new DiscordApi({
      baseUrl: accountConfig.apiBaseUrl,
      timeoutSeconds: accountConfig.apiTimeoutSeconds,
      fetch: this.fetch,
    });
  }

  /** Where the message goes, which differs entirely between the two models. */
  private publishUrl(
    api: DiscordApi,
    request: PostRequest,
    accountConfig: DiscordAccountConfig,
    mode: DiscordAuthMode,
  ): string {
    const target = resolveTarget(request, accountConfig);
    const threadId = stringField(target, 'threadId');

    if (mode === 'webhook') {
      const url = new URL(api.endpoint(webhookPath(accountConfig)));
      // Without `wait`, Discord answers 204 and we never learn the message id —
      // which would leave the host with a publication it cannot address.
      url.searchParams.set('wait', 'true');
      if (threadId) {
        url.searchParams.set('thread_id', threadId);
      }
      return url.toString();
    }

    // A thread is a channel: posting into one means addressing it directly.
    const channelId = threadId ?? target?.id;
    if (!channelId) {
      throw new ValidationError(
        'Field "target" is required for a Discord bot account (provide the channel id via request.target or account config target)',
      );
    }
    return api.endpoint(`/channels/${encodeURIComponent(channelId)}/messages`);
  }

  private buildPayload(
    request: PostRequest,
    capabilities: typeof discordCapabilities,
    mode: DiscordAuthMode,
  ): Record<string, unknown> {
    const content = renderBody(
      request,
      { ...capabilities, maxBodyLength: capabilities.maxBodyLength ?? MAX_MESSAGE_LENGTH },
      resolveBodyTargetFormat(request, capabilities),
    );

    const extra = { ...(request.extra ?? {}) };
    const payload: Record<string, unknown> = { ...extra };

    if (content) {
      payload.content = content;
    }

    if (request.poll) {
      payload.poll = {
        question: { text: request.title ?? request.body ?? '' },
        answers: request.poll.options.map(text => ({ poll_media: { text } })),
        duration:
          request.poll.durationSecs === undefined
            ? DEFAULT_POLL_DURATION_HOURS
            : Math.round(request.poll.durationSecs / SECS_PER_HOUR),
        allow_multiselect: request.poll.multiple ?? false,
      };
      // The question carries the text; repeating it as content posts it twice.
      delete payload.content;
    }

    if (mode === 'bot' && request.inReplyTo?.id) {
      payload.message_reference = {
        message_id: request.inReplyTo.id,
        // Discord refuses the whole message when the referenced one is gone;
        // a reply losing its thread is better than a publication failing.
        fail_if_not_exists: false,
      };
    }

    return payload;
  }

  /**
   * Read every attachment into a blob, checking it against the declared limits
   * first so an oversized file costs no download.
   */
  private async openAttachments(
    media: MediaInput[],
    capabilities: typeof discordCapabilities,
    signal?: AbortSignal,
  ): Promise<DiscordAttachment[]> {
    const attachments: DiscordAttachment[] = [];

    for (const [index, item] of media.entries()) {
      if (item.source.kind === 'platformRef') {
        throw new ValidationError(
          `Media item at index ${index} references a stored file; Discord has no re-usable file ids`,
        );
      }

      const opened = await this.media.open(item.source, capabilities, signal);
      // FormData needs a discrete part, so the stream is materialized here.
      // The size ceiling was already enforced against the descriptor, which is
      // what keeps this bounded.
      const blob = await new Response(opened.stream).blob();

      attachments.push({
        blob: new Blob([blob], { type: opened.mimeType ?? 'application/octet-stream' }),
        fileName: attachmentFileName(item, opened.fileName, index),
        description: item.altText,
      });
    }

    return attachments;
  }
}

/** One file on its way into a multipart message. */
interface DiscordAttachment {
  blob: Blob;
  fileName: string;
  description?: string;
}

/**
 * Assemble the multipart body Discord's upload format expects: the message as
 * `payload_json`, each file as `files[n]`, and the descriptions matched to the
 * files by index through the `attachments` array.
 */
function toMultipart(payload: Record<string, unknown>, attachments: DiscordAttachment[]): FormData {
  const withAttachments = {
    ...payload,
    attachments: attachments.map((attachment, index) => ({
      id: index,
      filename: attachment.fileName,
      ...(attachment.description ? { description: attachment.description } : {}),
    })),
  };

  const parts: MultipartPart[] = [
    { name: 'payload_json', value: JSON.stringify(withAttachments) },
    ...attachments.map((attachment, index) => ({
      name: `files[${index}]`,
      content: attachment.blob,
      fileName: attachment.fileName,
    })),
  ];

  return buildMultipartFormData(parts);
}

/**
 * The file name Discord shows, with the spoiler convention applied.
 *
 * Discord has no per-attachment spoiler flag: a file is spoilered when its name
 * begins with `SPOILER_`, which is why `sensitive` is honoured here rather than
 * in the payload.
 */
function attachmentFileName(item: MediaInput, sniffed: string | undefined, index: number): string {
  const base = item.fileName ?? sniffed ?? `file-${index}`;
  return item.sensitive && !base.startsWith('SPOILER_') ? `SPOILER_${base}` : base;
}

function resolveTarget(
  request: PostRequest,
  accountConfig: DiscordAccountConfig,
): PlatformTarget | undefined {
  return normalizeTarget(request.target) ?? normalizeTarget(accountConfig.target);
}

function guildIdOf(target: PlatformTarget | undefined): string | undefined {
  return stringField(target, 'guildId');
}

function stringField(target: PlatformTarget | undefined, key: string): string | undefined {
  const value = target?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** The webhook route, derived from the secret rather than from a target. */
function webhookPath(accountConfig: DiscordAccountConfig): string {
  const parsed = parseWebhookUrl(String(accountConfig.auth.webhookUrl ?? ''));
  if (!parsed) {
    throw new ValidationError("Field 'webhookUrl' has invalid format for Discord auth");
  }
  return `/webhooks/${parsed.id}/${parsed.token}`;
}

function authorizationFor(
  accountConfig: DiscordAccountConfig,
  mode: DiscordAuthMode,
): DiscordAuthorization {
  return mode === 'bot'
    ? { kind: 'bot', token: String(accountConfig.auth.botToken) }
    : { kind: 'webhook' };
}

function requireAuthMode(accountConfig: DiscordAccountConfig): DiscordAuthMode {
  const mode = authModeOf(accountConfig.auth);
  if (!mode) {
    throw new ValidationError("Discord auth requires either 'webhookUrl' or 'botToken'");
  }
  return mode;
}

/** A Discord permalink needs the guild; a DM channel has none. */
function buildMessageUrl(
  guildId: string | undefined,
  channelId: string,
  messageId: string,
): string | undefined {
  if (!channelId) {
    return undefined;
  }
  return `https://discord.com/channels/${guildId ?? '@me'}/${channelId}/${messageId}`;
}
