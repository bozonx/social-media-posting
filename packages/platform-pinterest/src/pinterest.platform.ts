import { ErrorCode, PlatformError, PostType, ValidationError } from '@bozonx/social-posting';
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
  toMediaSource,
  validateAgainstCapabilities,
} from '@bozonx/social-posting/platform';
import type {
  IPlatform,
  PlatformPublishResponse,
  PlatformStatusResponse,
  PublishOptions,
} from '@bozonx/social-posting/platform';
import type { ResumeHandle } from '@bozonx/social-posting';
import { pinterestCapabilities } from './capabilities.js';
export const DEFAULT_API_BASE_URL = 'https://api.pinterest.com/v5';
export interface PinterestExtra extends Record<string, unknown> {
  link?: string;
  altText?: string;
}
export interface PinterestPlatformDeps {
  logger: ILogger;
  fetch?: typeof fetch;
}
export class PinterestPlatform implements IPlatform {
  readonly name = 'pinterest';
  readonly capabilities = pinterestCapabilities;
  constructor(private readonly deps: PinterestPlatformDeps) {}
  async publish(
    request: PostRequest<PinterestExtra>,
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
    const board = account.target?.id;
    if (!board) throw new ValidationError('Pinterest requires a board id target');
    const media = request.media?.[0];
    if (!media) throw new ValidationError('Pinterest requires one media item');
    let media_source: Record<string, unknown>;
    if (request.type === PostType.VIDEO || request.type === PostType.SHORT_VIDEO) {
      const mediaId =
        media.source.kind === 'platformRef'
          ? media.source.ref
          : await this.uploadVideo(media, account, options?.signal);
      media_source = {
        source_type: 'video_id',
        media_id: mediaId,
        cover_image_url: thumbnailUrl(request.thumbnail),
      };
    } else {
      if (media.source.kind !== 'url') throw new ValidationError('Pinterest image requires a URL');
      media_source = { source_type: 'image_url', url: media.source.url };
    }
    const payload = {
      board_id: board,
      board_section_id:
        typeof account.target?.sectionId === 'string' ? account.target.sectionId : undefined,
      title: request.title,
      description: request.description ?? request.body,
      link: request.extra?.link,
      alt_text: request.extra?.altText ?? media.altText,
      media_source,
    };
    const token = account.auth.accessToken;
    if (typeof token !== 'string' || !token)
      throw new ValidationError('Pinterest accessToken is required');
    if (request.type === PostType.VIDEO || request.type === PostType.SHORT_VIDEO) {
      const mediaId = str(media_source.media_id);
      if (!mediaId) throw new ValidationError('Pinterest video upload returned no media id');
      const status = await this.mediaStatus(mediaId, account, options?.signal);
      if (status.status !== 'succeeded') {
        return {
          status: 'processing',
          checkAfterMs: 5000,
          handle: {
            version: 1,
            platform: 'pinterest',
            step: 'mediaProcessing',
            state: { mediaId, pinPayload: payload as never },
          },
          raw: status.raw,
        };
      }
    }
    return this.createPin(payload, account, options?.signal);
  }

  async checkStatus(
    handle: ResumeHandle,
    account: AccountConfig & ResolvedAccountConfig,
    signal?: AbortSignal,
  ): Promise<PlatformStatusResponse> {
    if (handle.platform !== 'pinterest' || handle.step !== 'mediaProcessing') {
      throw new ValidationError('Invalid Pinterest media processing handle');
    }
    const mediaId = str(handle.state.mediaId);
    const payload = obj(handle.state.pinPayload);
    if (!mediaId) throw new ValidationError('Pinterest status handle has no media id');
    const status = await this.mediaStatus(mediaId, account, signal);
    if (status.status === 'failed') {
      return {
        status: 'failed',
        raw: status.raw as never,
        error: new PlatformError('Pinterest media processing failed', ErrorCode.CONTENT_REJECTED, {
          retryable: false,
          raw: status.raw,
        }),
      };
    }
    if (status.status !== 'succeeded') {
      return { status: 'processing', checkAfterMs: 5000, raw: status.raw as never };
    }
    const published = await this.createPin(payload, account, signal);
    return { ...published, status: 'published', raw: published.raw as never };
  }

  private async uploadVideo(
    media: NonNullable<PostRequest['media']>[number],
    account: AccountConfig & ResolvedAccountConfig,
    signal?: AbortSignal,
  ): Promise<string> {
    const token = accessToken(account);
    const registration = await httpRequest(`${DEFAULT_API_BASE_URL}/media`, {
      method: 'POST',
      headers: { ...bearer(token), 'content-type': 'application/json' },
      body: JSON.stringify({ media_type: 'video' }),
      signal,
      fetch: this.deps.fetch,
    });
    if (!registration.ok) throw await pinError(registration);
    const registered = await safeJson(registration);
    const mediaId = str(registered.media_id);
    const uploadUrl = str(registered.upload_url);
    const parameters = obj(registered.upload_parameters);
    if (!mediaId || !uploadUrl) {
      throw new PlatformError(
        'Pinterest media registration returned no upload target',
        ErrorCode.PLATFORM_ERROR,
        { retryable: false },
      );
    }
    const opened = await new MediaFetcher().open(toMediaSource(media), this.capabilities, signal);
    const content = await new Response(opened.stream).blob();
    const form = buildMultipartFormData([
      ...Object.entries(parameters).map(([name, value]) => ({ name, value: String(value) })),
      { name: 'file', content, fileName: media.fileName ?? 'video' },
    ]);
    const uploaded = await httpRequest(uploadUrl, {
      method: 'POST',
      body: form,
      replayableBody: false,
      signal,
      fetch: this.deps.fetch,
    });
    if (!uploaded.ok) {
      throw new PlatformError(
        `Pinterest storage upload failed with ${uploaded.status}`,
        ErrorCode.PLATFORM_ERROR,
        { retryable: true, httpStatus: uploaded.status },
      );
    }
    return mediaId;
  }

  private async mediaStatus(
    mediaId: string,
    account: AccountConfig & ResolvedAccountConfig,
    signal?: AbortSignal,
  ) {
    const response = await httpRequest(
      `${DEFAULT_API_BASE_URL}/media/${encodeURIComponent(mediaId)}`,
      { headers: bearer(accessToken(account)), signal, fetch: this.deps.fetch },
    );
    if (!response.ok) throw await pinError(response);
    const raw = await safeJson(response);
    return { status: str(raw.status)?.toLowerCase(), raw };
  }

  private async createPin(
    payload: Json,
    account: AccountConfig & ResolvedAccountConfig,
    signal?: AbortSignal,
  ): Promise<PlatformPublishResponse> {
    const r = await httpRequest(`${DEFAULT_API_BASE_URL}/pins`, {
      method: 'POST',
      headers: { ...bearer(accessToken(account)), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
      fetch: this.deps.fetch,
    });
    if (!r.ok) throw await pinError(r);
    const raw = await safeJson(r),
      id = str(raw.id);
    if (!id)
      throw new PlatformError('Pinterest returned no Pin id', ErrorCode.UNKNOWN_OUTCOME, {
        retryable: false,
      });
    const url = str(raw.link) ?? `https://www.pinterest.com/pin/${id}/`;
    return {
      status: 'published',
      postId: id,
      url,
      parts: [{ id, url }],
      ref: { postId: id, target: account.target },
      raw,
    };
  }
}
type Json = Record<string, unknown>;
const obj = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
function accessToken(account: AccountConfig & ResolvedAccountConfig): string {
  const token = account.auth.accessToken;
  if (typeof token !== 'string' || !token)
    throw new ValidationError('Pinterest accessToken is required');
  return token;
}
function thumbnailUrl(thumbnail: PostRequest['thumbnail']): string {
  if (thumbnail?.source.kind !== 'url')
    throw new ValidationError('Pinterest video cover requires a URL source');
  return thumbnail.source.url;
}
async function safeJson(r: Response): Promise<Json> {
  try {
    return (await r.json()) as Json;
  } catch {
    return {};
  }
}
async function pinError(r: Response) {
  const b = await r.text(),
    n = Number(r.headers.get('retry-after'));
  if (r.status === 429)
    return new PlatformError(`Pinterest rate limited: ${b}`, ErrorCode.RATE_LIMIT_ERROR, {
      retryable: true,
      retryAfterMs: Number.isFinite(n) ? n * 1000 : undefined,
      httpStatus: r.status,
    });
  if (r.status === 401 || r.status === 403)
    return new PlatformError(
      `Pinterest rejected credentials: ${b}`,
      ErrorCode.AUTH_REFRESH_REQUIRED,
      { retryable: false, httpStatus: r.status },
    );
  return new PlatformError(
    `Pinterest responded with ${r.status}: ${b}`,
    r.status >= 500 ? ErrorCode.PLATFORM_ERROR : ErrorCode.CONTENT_REJECTED,
    { retryable: r.status >= 500, httpStatus: r.status },
  );
}
