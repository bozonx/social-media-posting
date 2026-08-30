import { ErrorCode, PlatformError, PostType, ValidationError } from '@bozonx/social-posting';
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
    if (request.type === PostType.VIDEO) {
      if (media.source.kind !== 'platformRef')
        throw new ValidationError('Pinterest video requires an uploaded media reference');
      media_source = { source_type: 'video_id', media_id: media.source.ref };
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
    const r = await httpRequest(`${DEFAULT_API_BASE_URL}/pins`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: options?.signal,
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
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
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
