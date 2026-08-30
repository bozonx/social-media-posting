import { ErrorCode, PlatformError, PostType, ValidationError } from '@bozonx/social-posting';
import type {
  AccountConfig,
  ILogger,
  JsonValue,
  MediaInput,
  PlatformCapabilities,
  PostRequest,
  ResolvedAccountConfig,
  ResumeHandle,
} from '@bozonx/social-posting';
import { httpRequest, validateAgainstCapabilities } from '@bozonx/social-posting/platform';
import type {
  IPlatform,
  PlatformPublishResponse,
  PlatformStatusResponse,
  PublishOptions,
  RuntimeCapabilities,
} from '@bozonx/social-posting/platform';
import { tiktokCapabilities } from './capabilities.js';
export const DEFAULT_API_BASE_URL = 'https://open.tiktokapis.com/v2';
export const STATUS_STEP = 'publish-status';
export interface TikTokExtra extends Record<string, unknown> {
  privacyLevel?: string;
  disableComment?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
  brandContentToggle?: boolean;
  brandOrganicToggle?: boolean;
}
export interface TiktokPlatformDeps {
  logger: ILogger;
  fetch?: typeof fetch;
}
type Json = Record<string, JsonValue>;
export class TiktokPlatform implements IPlatform {
  readonly name = 'tiktok';
  readonly capabilities = tiktokCapabilities;
  constructor(private readonly deps: TiktokPlatformDeps) {}
  async resolveCapabilities(
    account: ResolvedAccountConfig,
    signal?: AbortSignal,
  ): Promise<RuntimeCapabilities> {
    const raw = await this.call('/post/publish/creator_info/query/', account, {
      method: 'POST',
      body: '{}',
      signal,
    });
    const data = obj(raw.data);
    const max = num(data.max_video_post_duration_sec);
    return {
      fetchedAt: new Date().toISOString(),
      cacheableForSecs: 0,
      capabilities: {
        media:
          max && this.capabilities.media?.video
            ? { video: { ...this.capabilities.media.video, maxDurationSecs: max } }
            : {},
      },
    };
  }
  async publish(
    request: PostRequest<TikTokExtra>,
    account: AccountConfig & ResolvedAccountConfig,
    options?: PublishOptions,
  ): Promise<PlatformPublishResponse> {
    if (options?.signal?.aborted)
      throw new PlatformError('Request aborted before publishing', ErrorCode.NETWORK_ERROR, {
        retryable: false,
      });
    if (options?.resume) {
      const resumed = await this.checkStatus(options.resume, account, options.signal);
      if (resumed.status === 'failed')
        throw (
          resumed.error ??
          new PlatformError('TikTok publication failed', ErrorCode.CONTENT_REJECTED, {
            retryable: false,
          })
        );
      if (resumed.status === 'processing')
        return {
          status: 'processing',
          postId: resumed.postId,
          handle: options.resume,
          checkAfterMs: resumed.checkAfterMs,
          raw: resumed.raw,
        };
      return {
        status: 'published',
        postId: resumed.postId,
        url: resumed.url,
        ref: resumed.ref,
        raw: resumed.raw,
      };
    }
    const staticCheck = validateAgainstCapabilities(request, this.capabilities, {
      target: account.target,
    });
    if (staticCheck.issues.length) throw new ValidationError(staticCheck.issues);
    let caps: PlatformCapabilities = options?.capabilities ?? this.capabilities;
    if (!options?.capabilities) {
      const runtime = await this.resolveCapabilities(account, options?.signal);
      caps = {
        ...this.capabilities,
        media: { ...this.capabilities.media, ...runtime.capabilities.media },
      };
    }
    const checked = validateAgainstCapabilities(request, caps, { target: account.target });
    if (checked.issues.length) throw new ValidationError(checked.issues);
    const media = request.media ?? [],
      photo = request.type === PostType.IMAGE || request.type === PostType.ALBUM;
    const firstMedia = media[0];
    if (!firstMedia) throw new ValidationError('TikTok requires media');
    const source_info = photo
      ? { source: 'PULL_FROM_URL', photo_cover_index: 0, photo_images: media.map(m => url(m)) }
      : { source: 'PULL_FROM_URL', video_url: url(firstMedia) };
    const post_info = {
      title: request.body ?? '',
      privacy_level:
        request.extra?.privacyLevel ??
        (request.visibility === 'private' ? 'SELF_ONLY' : 'PUBLIC_TO_EVERYONE'),
      disable_comment: request.extra?.disableComment ?? false,
      disable_duet: request.extra?.disableDuet ?? false,
      disable_stitch: request.extra?.disableStitch ?? false,
      brand_content_toggle: request.extra?.brandContentToggle ?? false,
      brand_organic_toggle: request.extra?.brandOrganicToggle ?? false,
    };
    const raw = await this.call(
      photo ? '/post/publish/content/init/' : '/post/publish/video/init/',
      account,
      { method: 'POST', body: JSON.stringify({ post_info, source_info }), signal: options?.signal },
    );
    const id = str(obj(raw.data).publish_id) ?? str(raw.publish_id) ?? str(raw.id);
    if (!id)
      throw new PlatformError('TikTok returned no publish id', ErrorCode.UNKNOWN_OUTCOME, {
        retryable: false,
      });
    return {
      status: 'processing',
      postId: id,
      handle: { version: 1, platform: 'tiktok', step: STATUS_STEP, state: { publishId: id } },
      checkAfterMs: 5000,
      raw,
    };
  }
  async checkStatus(
    handle: ResumeHandle,
    account: ResolvedAccountConfig,
    signal?: AbortSignal,
  ): Promise<PlatformStatusResponse> {
    if (handle.platform !== 'tiktok' || handle.step !== STATUS_STEP)
      throw new ValidationError('Invalid TikTok status handle');
    const id = str(handle.state.publishId);
    if (!id) throw new ValidationError('TikTok status handle has no publish id');
    const raw = await this.call('/post/publish/status/fetch/', account, {
      method: 'POST',
      body: JSON.stringify({ publish_id: id }),
      signal,
    });
    const data = obj(raw.data),
      status = str(data.status) ?? '',
      safe = raw;
    if (['FAILED', 'PUBLISH_FAILED'].includes(status))
      return {
        status: 'failed',
        postId: id,
        error: new PlatformError('TikTok rejected the publication', ErrorCode.CONTENT_REJECTED, {
          retryable: false,
          platformCode: status,
        }),
        raw: safe,
      };
    if (!['PUBLISH_COMPLETE', 'PUBLISHED'].includes(status))
      return { status: 'processing', postId: id, checkAfterMs: 5000, raw: safe };
    const availableIds = Array.isArray(data.publicly_available_post_id)
      ? data.publicly_available_post_id
      : Array.isArray(data.publicaly_available_post_id)
        ? data.publicaly_available_post_id
        : [];
    const postId = str(availableIds[0]) ?? id;
    return { status: 'published', postId, ref: { postId }, raw: safe };
  }
  private async call(path: string, a: ResolvedAccountConfig, init: RequestInit): Promise<Json> {
    const token = a.auth.accessToken;
    if (typeof token !== 'string' || !token)
      throw new ValidationError('TikTok accessToken is required');
    const r = await httpRequest(`${DEFAULT_API_BASE_URL}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=UTF-8',
      },
      fetch: this.deps.fetch,
    });
    if (!r.ok) throw await ttError(r);
    return safeJson(r);
  }
}
function url(m: MediaInput) {
  if (m.source.kind !== 'url')
    throw new ValidationError('TikTok pull publishing requires media URLs');
  return m.source.url;
}
const obj = (v: unknown): Json =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
async function safeJson(r: Response): Promise<Json> {
  try {
    return (await r.json()) as Json;
  } catch {
    return {};
  }
}
async function ttError(r: Response) {
  const b = await r.text(),
    n = Number(r.headers.get('retry-after'));
  if (r.status === 429)
    return new PlatformError(`TikTok rate limited: ${b}`, ErrorCode.RATE_LIMIT_ERROR, {
      retryable: true,
      retryAfterMs: Number.isFinite(n) ? n * 1000 : undefined,
      httpStatus: r.status,
    });
  if (r.status === 401 || r.status === 403)
    return new PlatformError(`TikTok rejected credentials: ${b}`, ErrorCode.AUTH_REFRESH_REQUIRED, {
      retryable: false,
      httpStatus: r.status,
    });
  return new PlatformError(
    `TikTok responded with ${r.status}: ${b}`,
    r.status >= 500 ? ErrorCode.PLATFORM_ERROR : ErrorCode.CONTENT_REJECTED,
    { retryable: r.status >= 500, httpStatus: r.status },
  );
}
