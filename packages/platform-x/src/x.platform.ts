import { ErrorCode, PlatformError, ValidationError } from '@bozonx/social-posting';
import type {
  AccountConfig,
  ILogger,
  PostRequest,
  ResolvedAccountConfig,
} from '@bozonx/social-posting';
import {
  buildMultipartFormData,
  httpRequest,
  MediaFetcher,
  readResumePosition,
  runChunkedUpload,
  toMediaSource,
  validateAgainstCapabilities,
} from '@bozonx/social-posting/platform';
import type {
  IPlatform,
  PlatformStatusResponse,
  PlatformPublishResponse,
  PublishOptions,
} from '@bozonx/social-posting/platform';
import type { MediaInput, ResumeHandle } from '@bozonx/social-posting';
import { xCapabilities } from './capabilities.js';
export const DEFAULT_API_BASE_URL = 'https://api.x.com/2';
export interface XExtra extends Record<string, unknown> {
  replySettings?: 'following' | 'mentionedUsers' | 'subscribers' | 'verified';
  communityId?: string;
}
export interface XPlatformDeps {
  logger: ILogger;
  fetch?: typeof fetch;
}
export class XPlatform implements IPlatform {
  readonly name = 'x';
  readonly capabilities = xCapabilities;
  constructor(private readonly deps: XPlatformDeps) {}
  async publish(
    request: PostRequest<XExtra>,
    account: AccountConfig & ResolvedAccountConfig,
    options?: PublishOptions,
  ): Promise<PlatformPublishResponse> {
    if (options?.signal?.aborted)
      throw new PlatformError('Request aborted before publishing', ErrorCode.NETWORK_ERROR, {
        retryable: false,
      });
    const checked = validateAgainstCapabilities(
      request,
      options?.capabilities ?? this.capabilities,
      { target: account.target },
    );
    if (checked.issues.length) throw new ValidationError(checked.issues);
    const payload: Record<string, unknown> = { text: request.body ?? '' };
    const uploaded = await this.uploadMedia(request.media ?? [], account, options);
    const refs = uploaded.refs;
    if (refs.length) payload.media = { media_ids: refs, tagged_user_ids: [] };
    if (request.inReplyTo) payload.reply = { in_reply_to_tweet_id: request.inReplyTo.id };
    if (request.repostOf) payload.quote_tweet_id = request.repostOf.id;
    if (request.poll)
      payload.poll = {
        options: request.poll.options,
        duration_minutes: Math.max(5, Math.round((request.poll.durationSecs ?? 86400) / 60)),
      };
    if (request.extra?.replySettings) payload.reply_settings = request.extra.replySettings;
    if (request.extra?.communityId) payload.community_id = request.extra.communityId;
    if (uploaded.pendingMediaId) {
      return {
        status: 'processing',
        checkAfterMs: uploaded.checkAfterMs ?? 5000,
        handle: {
          version: 1,
          platform: 'x',
          step: 'mediaProcessing',
          state: { mediaId: uploaded.pendingMediaId, payload: payload as never },
        },
      };
    }
    const token = accessToken(account);
    const r = await httpRequest(`${DEFAULT_API_BASE_URL}/tweets`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: options?.signal,
      fetch: this.deps.fetch,
    });
    if (!r.ok) throw await xError(r);
    const raw = await safeJson(r),
      data = obj(raw.data),
      id = str(data.id) ?? str(raw.id);
    if (!id)
      throw new PlatformError('X returned no post id', ErrorCode.UNKNOWN_OUTCOME, {
        retryable: false,
      });
    return {
      status: 'published',
      postId: id,
      url: `https://x.com/i/status/${id}`,
      parts: [{ id, url: `https://x.com/i/status/${id}` }],
      ref: { postId: id },
      raw,
    };
  }

  async checkStatus(
    handle: ResumeHandle,
    account: AccountConfig & ResolvedAccountConfig,
    signal?: AbortSignal,
  ): Promise<PlatformStatusResponse> {
    if (handle.platform !== 'x' || handle.step !== 'mediaProcessing') {
      throw new ValidationError('Invalid X media processing handle');
    }
    const mediaId = str(handle.state.mediaId);
    const payload = obj(handle.state.payload);
    if (!mediaId) throw new ValidationError('X media processing handle has no media id');
    const response = await httpRequest(
      `${DEFAULT_API_BASE_URL}/media/upload?command=STATUS&media_id=${encodeURIComponent(mediaId)}`,
      { headers: bearer(accessToken(account)), signal, fetch: this.deps.fetch },
    );
    if (!response.ok) throw await xError(response);
    const raw = await safeJson(response);
    const processing = obj(obj(raw.data).processing_info);
    const state = str(processing.state);
    if (state === 'failed') {
      return {
        status: 'failed',
        raw: raw as never,
        error: new PlatformError('X media processing failed', ErrorCode.CONTENT_REJECTED, {
          retryable: false,
          raw,
        }),
      };
    }
    if (state !== 'succeeded') {
      return {
        status: 'processing',
        checkAfterMs: number(processing.check_after_secs, 5) * 1000,
        raw: raw as never,
      };
    }
    const published = await this.createPost(payload, account, signal);
    return { status: 'published', ...published, raw: published.raw as never };
  }

  private async uploadMedia(
    media: MediaInput[],
    account: AccountConfig & ResolvedAccountConfig,
    options?: PublishOptions,
  ): Promise<{ refs: string[]; pendingMediaId?: string; checkAfterMs?: number }> {
    const refs: string[] = [];
    const token = accessToken(account);
    for (let index = 0; index < media.length; index += 1) {
      const item = media[index];
      if (!item) continue;
      if (item.source.kind === 'platformRef') {
        refs.push(item.source.ref);
        continue;
      }
      const source = toMediaSource(item);
      const resume = options?.resume;
      const position = readResumePosition(resume, 'x');
      const fetcher = new MediaFetcher();
      const opened = position
        ? {
            ...(await fetcher.probe(source, options?.signal)),
            stream: await fetcher.openAt(source, position.offsetBytes, options?.signal),
          }
        : await fetcher.open(source, options?.capabilities ?? this.capabilities, options?.signal);
      if (opened.sizeBytes === undefined) {
        throw new ValidationError('X upload requires a media source with a known size');
      }
      const result = await runChunkedUpload(
        opened.stream,
        {
          init: async signal => {
            const response = await httpRequest(`${DEFAULT_API_BASE_URL}/media/upload/initialize`, {
              method: 'POST',
              headers: { ...bearer(token), 'content-type': 'application/json' },
              body: JSON.stringify({
                media_type: opened.mimeType ?? item.mimeType ?? 'application/octet-stream',
                media_category: item.type === 'video' ? 'tweet_video' : 'tweet_image',
                total_bytes: opened.sizeBytes,
              }),
              signal,
              fetch: this.deps.fetch,
            });
            if (!response.ok) throw await xError(response);
            const raw = await safeJson(response);
            const id = str(obj(raw.data).id);
            if (!id)
              throw new PlatformError(
                'X media initialize returned no id',
                ErrorCode.PLATFORM_ERROR,
                { retryable: false },
              );
            return { mediaId: id };
          },
          sendChunk: async context => {
            const response = await httpRequest(
              `${DEFAULT_API_BASE_URL}/media/upload/${context.session.mediaId}/append`,
              {
                method: 'POST',
                headers: bearer(token),
                body: buildMultipartFormData([
                  {
                    name: 'segment_index',
                    value: String(Math.floor(context.offsetBytes / (4 * 1024 * 1024))),
                  },
                  { name: 'media', content: context.chunk, fileName: item.fileName ?? 'upload' },
                ]),
                signal: context.signal,
                fetch: this.deps.fetch,
              },
            );
            if (!response.ok) throw await xError(response);
          },
          finalize: async (session, _total, signal) => {
            const response = await httpRequest(
              `${DEFAULT_API_BASE_URL}/media/upload/${session.mediaId}/finalize`,
              { method: 'POST', headers: bearer(token), signal, fetch: this.deps.fetch },
            );
            if (!response.ok) throw await xError(response);
            return { mediaId: session.mediaId, raw: await safeJson(response) };
          },
          serializeSession: session => ({ mediaId: session.mediaId }),
          deserializeSession: state => ({ mediaId: str(state.mediaId) ?? '' }),
        },
        { platform: 'x', totalBytes: opened.sizeBytes, resume, signal: options?.signal },
      );
      const state = str(obj(obj(result.raw).processing_info).state);
      if (state && state !== 'succeeded') {
        return {
          refs: [...refs, result.mediaId],
          pendingMediaId: result.mediaId,
          checkAfterMs: number(obj(obj(result.raw).processing_info).check_after_secs, 5) * 1000,
        };
      }
      refs.push(result.mediaId);
    }
    return { refs };
  }

  private async createPost(
    payload: Json,
    account: AccountConfig & ResolvedAccountConfig,
    signal?: AbortSignal,
  ) {
    const response = await httpRequest(`${DEFAULT_API_BASE_URL}/tweets`, {
      method: 'POST',
      headers: { ...bearer(accessToken(account)), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
      fetch: this.deps.fetch,
    });
    if (!response.ok) throw await xError(response);
    const raw = await safeJson(response),
      data = obj(raw.data),
      id = str(data.id) ?? str(raw.id);
    if (!id)
      throw new PlatformError('X returned no post id', ErrorCode.UNKNOWN_OUTCOME, {
        retryable: false,
      });
    return { postId: id, url: `https://x.com/i/status/${id}`, ref: { postId: id }, raw };
  }
}
type Json = Record<string, unknown>;
const obj = (v: unknown): Json =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const number = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
function accessToken(account: AccountConfig & ResolvedAccountConfig): string {
  const token = account.auth.accessToken;
  if (typeof token !== 'string' || !token) throw new ValidationError('X accessToken is required');
  return token;
}
async function safeJson(r: Response): Promise<Json> {
  try {
    return (await r.json()) as Json;
  } catch {
    return {};
  }
}
async function xError(r: Response) {
  const body = await r.text(),
    retry = Number(r.headers.get('retry-after'));
  if (r.status === 429)
    return new PlatformError(`X rate limited: ${body}`, ErrorCode.RATE_LIMIT_ERROR, {
      retryable: true,
      retryAfterMs: Number.isFinite(retry) ? retry * 1000 : undefined,
      httpStatus: r.status,
    });
  if (r.status === 401 || r.status === 403)
    return new PlatformError(`X rejected credentials: ${body}`, ErrorCode.AUTH_REFRESH_REQUIRED, {
      retryable: false,
      httpStatus: r.status,
    });
  return new PlatformError(
    `X responded with ${r.status}: ${body}`,
    r.status >= 500 ? ErrorCode.PLATFORM_ERROR : ErrorCode.CONTENT_REJECTED,
    { retryable: r.status >= 500, httpStatus: r.status },
  );
}
