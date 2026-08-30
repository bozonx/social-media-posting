import {
  ErrorCode,
  PlatformError,
  ValidationError,
  type AccountConfig,
  type ILogger,
  type MediaInput,
  type PostRequest,
  type ResolvedAccountConfig,
} from '@bozonx/social-posting';
import {
  buildMultipartFormData,
  renderBody,
  toMediaSource,
  validateAgainstCapabilities,
} from '@bozonx/social-posting/platform';
import type {
  IPlatform,
  PlatformPublishResponse,
  PublishOptions,
  RuntimeCapabilities,
} from '@bozonx/social-posting/platform';
import { mastodonCapabilities } from './capabilities.js';

type Json = Record<string, unknown>;
export interface MastodonAccountConfig extends AccountConfig {
  auth: AccountConfig['auth'] & { accessToken?: string };
}
export interface MastodonPlatformDeps {
  logger: ILogger;
  fetch?: typeof fetch;
}

export class MastodonPlatform implements IPlatform {
  readonly name = 'mastodon';
  readonly capabilities = mastodonCapabilities;
  constructor(private readonly deps: MastodonPlatformDeps) {}

  async publish(
    request: PostRequest,
    account: MastodonAccountConfig & ResolvedAccountConfig,
    options?: PublishOptions,
  ): Promise<PlatformPublishResponse> {
    if (options?.signal?.aborted)
      throw new PlatformError('Request aborted before publishing', ErrorCode.NETWORK_ERROR, {
        retryable: false,
      });
    const capabilities = options?.capabilities ?? this.capabilities;
    const checked = validateAgainstCapabilities(request, capabilities, { target: account.target });
    if (checked.issues.length) throw new ValidationError(checked.issues);
    const token = tokenOf(account),
      base = baseOf(account);
    let replyTo = request.inReplyTo?.id;
    let last: Json | undefined;
    const segments = [
      { body: request.body, media: request.media, poll: request.poll },
      ...(request.thread ?? []),
    ];
    for (const [index, segment] of segments.entries()) {
      const mediaIds: string[] = [];
      for (const item of segment.media ?? [])
        mediaIds.push(await this.uploadMedia(base, token, item, capabilities, options?.signal));
      const body: Json = {
        status: renderBody(
          {
            ...request,
            body: segment.body,
            media: segment.media,
            poll: segment.poll,
            thread: undefined,
          },
          capabilities,
        ),
        media_ids: mediaIds,
        in_reply_to_id: replyTo,
        visibility: request.visibility,
        sensitive: request.sensitive,
        spoiler_text: request.contentWarning,
        language: request.language,
      };
      if (segment.poll)
        body.poll = {
          options: segment.poll.options,
          expires_in: segment.poll.durationSecs,
          multiple: segment.poll.multiple ?? false,
        };
      last = await this.call(base, '/api/v1/statuses', token, {
        method: 'POST',
        json: compact(body),
        signal: options?.signal,
        idempotencyKey:
          index === 0
            ? request.idempotencyKey
            : request.idempotencyKey
              ? `${request.idempotencyKey}-${index}`
              : undefined,
      });
      replyTo = stringOf(last.id, 'status id');
    }
    const id = stringOf(last?.id, 'status id');
    return {
      status: 'published',
      postId: id,
      url: optionalString(last?.url),
      ref: { postId: id },
      raw: last,
    };
  }

  async resolveCapabilities(
    account: MastodonAccountConfig & ResolvedAccountConfig,
    signal?: AbortSignal,
  ): Promise<RuntimeCapabilities> {
    const base = baseOf(account),
      token = tokenOf(account);
    const instance = await this.call(base, '/api/v2/instance', token, { method: 'GET', signal });
    const configuration = objectOf(instance.configuration),
      statuses = objectOf(configuration.statuses),
      media = objectOf(configuration.media_attachments),
      polls = objectOf(configuration.polls);
    const maxCharacters = numberOf(statuses.max_characters),
      maxMedia = numberOf(statuses.max_media_attachments);
    return {
      fetchedAt: new Date().toISOString(),
      cacheableForSecs: 3600,
      capabilities: {
        ...(maxCharacters ? { maxBodyLength: maxCharacters } : {}),
        postTypes: maxMedia ? mediaCountOverrides(this.capabilities, maxMedia) : {},
        media: runtimeMedia(this.capabilities, media),
        poll: compact({
          minOptions: numberOf(polls.min_options),
          maxOptions: numberOf(polls.max_options),
          maxOptionLength: numberOf(polls.max_characters_per_option),
          minDurationSecs: numberOf(polls.min_expiration),
          maxDurationSecs: numberOf(polls.max_expiration),
        }),
      },
    };
  }

  private async uploadMedia(
    base: string,
    token: string,
    media: MediaInput,
    capabilities: typeof mastodonCapabilities,
    signal?: AbortSignal,
  ): Promise<string> {
    if (media.source.kind === 'platformRef') return media.source.ref;
    const source = toMediaSource(media);
    let content: Blob;
    if (source.kind === 'blob') content = source.blob;
    else if (source.kind === 'bytes')
      content = new Blob([source.bytes as unknown as BlobPart], { type: source.mimeType });
    else {
      if (source.kind === 'platformRef')
        throw new ValidationError('Invalid Mastodon media reference');
      const response =
        source.kind === 'url'
          ? await (this.deps.fetch ?? fetch)(source.url, { signal })
          : new Response(await source.open({ signal }));
      if (!response.ok)
        throw new PlatformError('Could not read media', ErrorCode.NETWORK_ERROR, {
          retryable: true,
          httpStatus: response.status,
        });
      content = await response.blob();
    }
    const form = buildMultipartFormData([
      { name: 'file', content, fileName: media.fileName ?? 'upload' },
      ...(media.altText ? [{ name: 'description', value: media.altText } as const] : []),
    ]);
    const result = await this.call(base, '/api/v2/media', token, {
      method: 'POST',
      body: form,
      signal,
    });
    return stringOf(result.id, 'media id');
  }

  private async call(
    base: string,
    path: string,
    token: string,
    init: {
      method: string;
      json?: Json;
      body?: BodyInit;
      signal?: AbortSignal;
      idempotencyKey?: string;
    },
  ): Promise<Json> {
    let response: Response;
    try {
      response = await (this.deps.fetch ?? fetch)(`${base}${path}`, {
        method: init.method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(init.json ? { 'content-type': 'application/json' } : {}),
          ...(init.idempotencyKey ? { 'idempotency-key': init.idempotencyKey } : {}),
        },
        body: init.json ? JSON.stringify(init.json) : init.body,
        signal: init.signal,
      });
    } catch (cause) {
      throw new PlatformError('Mastodon request failed', ErrorCode.NETWORK_ERROR, {
        retryable: true,
        cause,
      });
    }
    const raw = (await response.json().catch(() => ({}))) as Json;
    if (!response.ok) {
      const retry = Number(response.headers.get('retry-after'));
      throw new PlatformError(
        optionalString(raw.error) ?? `Mastodon API returned ${response.status}`,
        response.status === 401 || response.status === 403
          ? ErrorCode.AUTH_REFRESH_REQUIRED
          : response.status === 429
            ? ErrorCode.RATE_LIMIT_ERROR
            : ErrorCode.PLATFORM_ERROR,
        {
          httpStatus: response.status,
          retryable: response.status === 429 || response.status >= 500,
          retryAfterMs: Number.isFinite(retry) ? retry * 1000 : undefined,
        },
      );
    }
    return raw;
  }
}

function baseOf(account: ResolvedAccountConfig): string {
  if (!account.apiBaseUrl) throw new ValidationError('Mastodon requires apiBaseUrl');
  return account.apiBaseUrl.replace(/\/+$/, '');
}
function tokenOf(account: MastodonAccountConfig): string {
  const value = account.auth.accessToken;
  if (!value) throw new ValidationError('Mastodon requires an access token');
  return value;
}
function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}
function stringOf(value: unknown, label: string): string {
  const found = optionalString(value);
  if (!found)
    throw new PlatformError(`Mastodon returned no ${label}`, ErrorCode.UNKNOWN_OUTCOME, {
      retryable: false,
    });
  return found;
}
function objectOf(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
}
function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function compact<T extends Json>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
function mediaCountOverrides(
  base: typeof mastodonCapabilities,
  max: number,
): typeof base.postTypes {
  return Object.fromEntries(
    Object.entries(base.postTypes).map(([key, value]) => [
      key,
      value?.maxMediaCount === undefined ? value : { ...value, maxMediaCount: max },
    ]),
  );
}
function runtimeMedia(base: typeof mastodonCapabilities, config: Json): typeof base.media {
  const image = numberOf(config.image_size_limit),
    video = numberOf(config.video_size_limit);
  const imageRules = base.media?.image,
    videoRules = base.media?.video,
    audioRules = base.media?.audio;
  return {
    ...base.media,
    ...(image && imageRules ? { image: { ...imageRules, maxBytes: image } } : {}),
    ...(video
      ? {
          ...(videoRules ? { video: { ...videoRules, maxBytes: video } } : {}),
          ...(audioRules ? { audio: { ...audioRules, maxBytes: video } } : {}),
        }
      : {}),
  };
}
