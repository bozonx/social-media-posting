import { ErrorCode, PlatformError, ValidationError } from '@bozonx/social-posting';
import type {
  AccountConfig,
  ILogger,
  PostRequest,
  ResolvedAccountConfig,
} from '@bozonx/social-posting';
import { httpRequest, validateAgainstCapabilities } from '@bozonx/social-posting/platform';
import type {
  IPlatform,
  PlatformPublishResponse,
  PublishOptions,
} from '@bozonx/social-posting/platform';
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
    const refs = (request.media ?? []).map(m => {
      if (m.source.kind !== 'platformRef')
        throw new ValidationError('X media must be an uploaded media reference');
      return m.source.ref;
    });
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
    const token = account.auth.accessToken;
    if (typeof token !== 'string' || !token) throw new ValidationError('X accessToken is required');
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
}
type Json = Record<string, unknown>;
const obj = (v: unknown): Json =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
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
