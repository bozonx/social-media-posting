import { ErrorCode, PlatformError, PostType, ValidationError } from '@bozonx/social-posting';
import type {
  AccountConfig,
  ILogger,
  JsonValue,
  MediaInput,
  PostRequest,
  QuotaState,
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
  CONTAINER_LIFETIME_SECS,
  GRAPH_API_VERSION,
  instagramCapabilities,
} from './capabilities.js';
export const DEFAULT_API_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
export const CONTAINER_STEP = 'container';
export interface InstagramExtra extends Record<string, unknown> {
  shareToFeed?: boolean;
  locationId?: string;
  coverUrl?: string;
  thumbOffset?: number;
}
export interface InstagramAccountConfig extends AccountConfig {
  auth: AccountConfig['auth'] & { accessToken?: string };
}
export interface InstagramPlatformDeps {
  logger: ILogger;
  fetch?: typeof fetch;
}
type Json = Record<string, unknown>;

export class InstagramPlatform implements IPlatform {
  readonly name = 'instagram';
  readonly capabilities = instagramCapabilities;
  constructor(private readonly deps: InstagramPlatformDeps) {}
  async publish(
    request: PostRequest<InstagramExtra>,
    account: InstagramAccountConfig & ResolvedAccountConfig,
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
    if (options?.resume)
      return this.checkStatus(
        options.resume,
        account,
        options.signal,
      ) as Promise<PlatformPublishResponse>;
    const token = tokenOf(account),
      user = account.target?.id;
    if (!user) throw new ValidationError('Instagram requires a user id target');
    const children: string[] = [];
    if ((request.media?.length ?? 0) > 1)
      for (const media of request.media ?? [])
        children.push(
          idOf(
            await this.post(
              `/${user}/media`,
              token,
              mediaForm(media, undefined, true),
              options?.signal,
            ),
            'carousel child',
          ),
        );
    const firstMedia = request.media?.[0];
    if (!children.length && !firstMedia) throw new ValidationError('Instagram requires media');
    const form = children.length
      ? { media_type: 'CAROUSEL', children: children.join(','), caption: request.body ?? '' }
      : mediaForm(firstMedia as MediaInput, request.body, false, request.type);
    if (request.extra?.shareToFeed !== undefined)
      form.share_to_feed = String(request.extra.shareToFeed);
    if (request.extra?.locationId) form.location_id = request.extra.locationId;
    if (request.extra?.coverUrl) form.cover_url = request.extra.coverUrl;
    if (request.extra?.thumbOffset !== undefined)
      form.thumb_offset = String(request.extra.thumbOffset);
    const containerId = idOf(
      await this.post(`/${user}/media`, token, form, options?.signal),
      'container',
    );
    return processing(containerId, children);
  }
  async checkStatus(
    handle: ResumeHandle,
    account: InstagramAccountConfig & ResolvedAccountConfig,
    signal?: AbortSignal,
  ): Promise<PlatformStatusResponse> {
    assertHandle(handle);
    const containerId = stringValue(handle.state.containerId),
      user = account.target?.id;
    if (!containerId || !user)
      throw new ValidationError('Instagram container handle or target is incomplete');
    const token = tokenOf(account),
      state = await this.get(`/${containerId}?fields=id,status_code`, token, signal);
    const code = (stringValue(state.status) || stringValue(state.status_code)).toUpperCase();
    if (code === 'ERROR' || code === 'EXPIRED')
      return {
        status: 'failed',
        postId: containerId,
        error: new PlatformError(
          `Instagram container failed: ${code}`,
          ErrorCode.CONTENT_REJECTED,
          { retryable: false, platformCode: code },
        ),
        raw: safe(state),
      };
    if (code !== 'FINISHED' && code !== 'PUBLISHED')
      return { status: 'processing', postId: containerId, checkAfterMs: 5000, raw: safe(state) };
    if (code === 'PUBLISHED') return done(stringValue(state.id) || containerId, state);
    try {
      const result = await this.post(
        `/${user}/media_publish`,
        token,
        { creation_id: containerId },
        signal,
      );
      return done(idOf(result, 'post'), result);
    } catch (error) {
      if (error instanceof PlatformError && error.retryable)
        throw new PlatformError(
          'Instagram publish outcome is unknown; do not repeat it automatically',
          ErrorCode.UNKNOWN_OUTCOME,
          { retryable: false, outcomeUnknown: true, resumeHandle: handle },
        );
      throw error;
    }
  }
  async getQuota(
    account: InstagramAccountConfig & ResolvedAccountConfig,
    signal?: AbortSignal,
  ): Promise<QuotaState> {
    const user = account.target?.id;
    if (!user) throw new ValidationError('Instagram requires a user id target');
    const response = await this.get(
      `/${user}/content_publishing_limit?fields=config,quota_usage`,
      tokenOf(account),
      signal,
    );
    const item = Array.isArray(response.data) && isJson(response.data[0]) ? response.data[0] : {};
    const config = isJson(item.config) ? item.config : {};
    const used = numberValue(item.quota_usage);
    const limit = numberValue(config.quota_total) ?? 100;
    return {
      unit: 'publications',
      limit,
      remaining: used === undefined ? undefined : Math.max(0, limit - used),
      fetchedAt: new Date().toISOString(),
      raw: safe(response),
    };
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
    const response = await httpRequest(`${DEFAULT_API_BASE_URL}${path}`, {
      ...init,
      fetch: this.deps.fetch,
      replayableBody: init.method === 'GET',
    });
    if (!response.ok) throw await metaError(response);
    return (await response.json()) as Json;
  }
}
function mediaForm(
  media: MediaInput,
  caption?: string,
  child = false,
  type?: PostType,
): Record<string, string> {
  if (media.source.kind !== 'url')
    throw new ValidationError('Instagram pull publishing requires a URL source');
  const video = media.type === 'video';
  const mediaType = type === PostType.STORY ? 'STORIES' : video ? 'REELS' : 'IMAGE';
  return {
    media_type: mediaType,
    [video ? 'video_url' : 'image_url']: media.source.url,
    ...(caption ? { caption } : {}),
    ...(child ? { is_carousel_item: 'true' } : {}),
  };
}
function processing(containerId: string, children: string[]): PlatformPublishResponse {
  return {
    status: 'processing',
    postId: containerId,
    parts: children.map(id => ({ id, kind: 'container' })),
    handle: {
      version: 1,
      platform: 'instagram',
      step: CONTAINER_STEP,
      state: { containerId, children },
      expiresAt: new Date(Date.now() + CONTAINER_LIFETIME_SECS * 1000).toISOString(),
    },
    checkAfterMs: 5000,
  };
}
function done(id: string, raw: Json): PlatformStatusResponse {
  return { status: 'published', postId: id, ref: { postId: id, parts: [{ id }] }, raw: safe(raw) };
}
function tokenOf(a: InstagramAccountConfig): string {
  const t = a.auth.accessToken;
  if (typeof t !== 'string' || !t)
    throw new PlatformError('Instagram account carries no access token', ErrorCode.AUTH_ERROR, {
      retryable: false,
    });
  return t;
}
function idOf(body: Json, label: string): string {
  if (typeof body.id !== 'string')
    throw new PlatformError(
      `Instagram ${label} response carried no id`,
      ErrorCode.UNKNOWN_OUTCOME,
      { retryable: false },
    );
  return body.id;
}
function assertHandle(h: ResumeHandle) {
  if (h.platform !== 'instagram' || h.step !== CONTAINER_STEP)
    throw new ValidationError('Invalid Instagram container handle');
  if (h.expiresAt && Date.parse(h.expiresAt) <= Date.now())
    throw new PlatformError('Instagram container expired', ErrorCode.CONTENT_REJECTED, {
      retryable: false,
      platformCode: 'EXPIRED',
    });
}
function safe(v: Json): JsonValue {
  const { access_token: _t, ...rest } = v;
  return rest as JsonValue;
}
function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function stringValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
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
