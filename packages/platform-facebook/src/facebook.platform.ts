import { ErrorCode, PlatformError, PostType, ValidationError } from '@bozonx/social-posting';
import type {
  AccountConfig,
  ILogger,
  JsonValue,
  MediaInput,
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
} from '@bozonx/social-posting/platform';
import {
  facebookCapabilities,
  GRAPH_API_VERSION,
  VIDEO_CONTAINER_LIFETIME_SECS,
} from './capabilities.js';
export const DEFAULT_API_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
export const REEL_STEP = 'reel';
export const GALLERY_STEP = 'gallery';
type Json = Record<string, unknown>;
export interface FacebookExtra extends Record<string, unknown> {
  link?: string;
  placeId?: string;
  published?: boolean;
}
export interface FacebookAccountConfig extends AccountConfig {
  auth: AccountConfig['auth'] & { accessToken?: string };
}
export interface FacebookPlatformDeps {
  logger: ILogger;
  fetch?: typeof fetch;
}
export class FacebookPlatform implements IPlatform {
  readonly name = 'facebook';
  readonly capabilities = facebookCapabilities;
  constructor(private readonly deps: FacebookPlatformDeps) {}
  async publish(
    request: PostRequest<FacebookExtra>,
    account: FacebookAccountConfig & ResolvedAccountConfig,
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
    const page = account.target?.id;
    if (!page) throw new ValidationError('Facebook requires a Page id target');
    const token = tokenOf(account);
    if (options?.resume) {
      if (options.resume.step === REEL_STEP)
        return this.checkStatus(
          options.resume,
          account,
          options.signal,
        ) as Promise<PlatformPublishResponse>;
      if (options.resume.step === GALLERY_STEP)
        return this.gallery(request, page, token, options.signal, idsFrom(options.resume));
      throw new ValidationError('Invalid Facebook resume handle');
    }
    if (request.type === PostType.SHORT_VIDEO)
      return this.reel(request, page, token, options?.signal);
    if ((request.media?.length ?? 0) > 1)
      return this.gallery(request, page, token, options?.signal, []);
    const media = request.media?.[0];
    let path = `/${page}/feed`,
      form = this.common(request);
    if (media) {
      const url = mediaUrl(media);
      if (media.type === 'image') {
        path = `/${page}/photos`;
        form = { ...form, url };
      } else {
        path = `/${page}/videos`;
        form = {
          ...form,
          file_url: url,
          description: request.body ?? '',
          title: request.title ?? '',
        };
      }
    }
    const result = await this.post(path, token, form, options?.signal);
    return complete(idOf(result, 'publication'), result);
  }
  async checkStatus(
    handle: ResumeHandle,
    account: FacebookAccountConfig & ResolvedAccountConfig,
    signal?: AbortSignal,
  ): Promise<PlatformStatusResponse> {
    if (handle.platform !== 'facebook' || handle.step !== REEL_STEP)
      throw new ValidationError('Invalid Facebook Reel handle');
    if (handle.expiresAt && Date.parse(handle.expiresAt) <= Date.now())
      throw new PlatformError('Facebook Reel container expired', ErrorCode.CONTENT_REJECTED, {
        retryable: false,
        platformCode: 'EXPIRED',
      });
    const videoId = stringValue(handle.state.videoId, false),
      page = account.target?.id;
    if (!videoId || !page)
      throw new ValidationError('Facebook Reel handle or target is incomplete');
    const token = tokenOf(account),
      state = await this.get(`/${videoId}?fields=status`, token, signal),
      statusObject = isJson(state.status) ? state.status : undefined,
      status = stringValue(statusObject?.video_status) || stringValue(state.status);
    if (['ERROR', 'EXPIRED'].includes(status))
      return {
        status: 'failed',
        postId: videoId,
        error: new PlatformError(`Facebook Reel failed: ${status}`, ErrorCode.CONTENT_REJECTED, {
          retryable: false,
          platformCode: status,
        }),
        raw: safe(state),
      };
    if (!['READY', 'PUBLISHED'].includes(status))
      return { status: 'processing', postId: videoId, checkAfterMs: 5000, raw: safe(state) };
    if (status === 'PUBLISHED') return complete(videoId, state);
    try {
      const result = await this.post(
        `/${page}/video_reels`,
        token,
        {
          upload_phase: 'finish',
          video_id: videoId,
          video_state: 'PUBLISHED',
          description: stringValue(handle.state.description, false),
        },
        signal,
      );
      return complete(stringValue(result.id, false) || videoId, result);
    } catch (error) {
      if (error instanceof PlatformError && error.retryable)
        throw new PlatformError(
          'Facebook Reel publish outcome is unknown; do not repeat it automatically',
          ErrorCode.UNKNOWN_OUTCOME,
          { retryable: false, outcomeUnknown: true, resumeHandle: handle },
        );
      throw error;
    }
  }
  private async reel(
    request: PostRequest<FacebookExtra>,
    page: string,
    token: string,
    signal?: AbortSignal,
  ): Promise<PlatformPublishResponse> {
    const media = request.media?.[0];
    if (!media) throw new ValidationError('Facebook Reel requires one video');
    const source = mediaUrl(media);
    const result = await this.post(
        `/${page}/video_reels`,
        token,
        { upload_phase: 'start', file_url: source },
        signal,
      ),
      videoId = stringValue(result.video_id, false) || stringValue(result.id, false);
    if (!videoId)
      throw new PlatformError(
        'Facebook Reel start returned no video id',
        ErrorCode.UNKNOWN_OUTCOME,
        { retryable: false },
      );
    return {
      status: 'processing',
      postId: videoId,
      handle: {
        version: 1,
        platform: 'facebook',
        step: REEL_STEP,
        state: { videoId, description: request.body ?? '' },
        expiresAt: new Date(Date.now() + VIDEO_CONTAINER_LIFETIME_SECS * 1000).toISOString(),
      },
      checkAfterMs: 5000,
      raw: safe(result),
    };
  }
  private async gallery(
    request: PostRequest<FacebookExtra>,
    page: string,
    token: string,
    signal: AbortSignal | undefined,
    photoIds: string[],
  ): Promise<PlatformPublishResponse> {
    try {
      for (let i = photoIds.length; i < (request.media?.length ?? 0); i++) {
        const item = request.media?.[i];
        if (!item) throw new ValidationError(`Facebook gallery is missing media item ${i}`);
        if (item.type !== 'image')
          throw new ValidationError('Facebook gallery supports images only');
        const photo = await this.post(
          `/${page}/photos`,
          token,
          { url: mediaUrl(item), published: 'false' },
          signal,
        );
        photoIds.push(idOf(photo, 'unpublished photo'));
      }
      const attached_media = JSON.stringify(photoIds.map(media_fbid => ({ media_fbid })));
      const result = await this.post(
        `/${page}/feed`,
        token,
        { ...this.common(request), attached_media },
        signal,
      );
      const postId = idOf(result, 'gallery post');
      return {
        ...complete(postId, result),
        parts: [
          ...photoIds.map(id => ({ id, kind: 'unpublished-photo' })),
          { id: postId, kind: 'post' },
        ],
      };
    } catch (error) {
      if (photoIds.length && error instanceof PlatformError)
        throw new PlatformError(error.message, error.code, {
          retryable: error.retryable,
          httpStatus: error.httpStatus,
          platformCode: error.platformCode,
          resumeHandle: {
            version: 1,
            platform: 'facebook',
            step: GALLERY_STEP,
            state: { photoIds },
          },
        });
      throw error;
    }
  }
  private common(request: PostRequest<FacebookExtra>): Record<string, string> {
    const form: Record<string, string> = { message: request.body ?? '' };
    if (request.extra?.link) form.link = request.extra.link;
    if (request.extra?.placeId) form.place = request.extra.placeId;
    if (request.extra?.published !== undefined) form.published = String(request.extra.published);
    if (request.scheduledAt) {
      form.published = 'false';
      form.scheduled_publish_time = String(Math.floor(Date.parse(request.scheduledAt) / 1000));
    }
    return form;
  }
  private post(path: string, token: string, form: Record<string, string>, signal?: AbortSignal) {
    return this.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...form, access_token: token }),
      signal,
    });
  }
  private get(path: string, token: string, signal?: AbortSignal) {
    return this.request(
      `${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`,
      { method: 'GET', signal },
    );
  }
  private async request(path: string, init: RequestInit): Promise<Json> {
    const r = await httpRequest(`${DEFAULT_API_BASE_URL}${path}`, {
      ...init,
      fetch: this.deps.fetch,
      replayableBody: init.method === 'GET',
    });
    if (!r.ok) throw await metaError(r);
    return (await r.json()) as Json;
  }
}
function mediaUrl(m: MediaInput): string {
  if (m.source.kind !== 'url')
    throw new ValidationError('Facebook pull publishing requires a URL source');
  return m.source.url;
}
function tokenOf(a: FacebookAccountConfig): string {
  const t = a.auth.accessToken;
  if (typeof t !== 'string' || !t)
    throw new PlatformError('Facebook Page account carries no access token', ErrorCode.AUTH_ERROR, {
      retryable: false,
    });
  return t;
}
function idOf(j: Json, label: string): string {
  if (typeof j.id !== 'string')
    throw new PlatformError(`Facebook ${label} response carried no id`, ErrorCode.UNKNOWN_OUTCOME, {
      retryable: false,
    });
  return j.id;
}
function idsFrom(h: ResumeHandle): string[] {
  if (h.platform !== 'facebook' || h.step !== GALLERY_STEP || !Array.isArray(h.state.photoIds))
    throw new ValidationError('Invalid Facebook gallery handle');
  return h.state.photoIds.filter((v): v is string => typeof v === 'string');
}
function complete(id: string, raw: Json): PlatformPublishResponse & PlatformStatusResponse {
  return { status: 'published', postId: id, ref: { postId: id, parts: [{ id }] }, raw: safe(raw) };
}
function safe(v: Json): JsonValue {
  const { access_token: _t, upload_url: _u, ...rest } = v;
  return rest as JsonValue;
}
function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function stringValue(value: unknown, upper = true): string {
  const result = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  return upper ? result.toUpperCase() : result;
}
async function metaError(r: Response): Promise<PlatformError> {
  const b = (await r.json().catch(() => ({}))) as {
    error?: { message?: string; code?: number; error_subcode?: number; is_transient?: boolean };
  };
  const e = b.error,
    c = e?.code,
    k =
      r.status === 429 || c === 4 || c === 32
        ? ErrorCode.RATE_LIMIT_ERROR
        : r.status === 401 || c === 190
          ? ErrorCode.AUTH_REFRESH_REQUIRED
          : r.status >= 500 || e?.is_transient
            ? ErrorCode.PLATFORM_ERROR
            : ErrorCode.CONTENT_REJECTED;
  return new PlatformError(e?.message ?? `Meta responded with ${r.status}`, k, {
    httpStatus: r.status,
    platformCode: String(e?.error_subcode ?? c ?? r.status),
    retryable: k === ErrorCode.RATE_LIMIT_ERROR || k === ErrorCode.PLATFORM_ERROR,
    retryAfterMs: Number(r.headers.get('retry-after')) * 1000 || undefined,
    raw: b,
  });
}
