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
import { LINKEDIN_VERSION, linkedinCapabilities } from './capabilities.js';
export const DEFAULT_API_BASE_URL = 'https://api.linkedin.com/rest';
export interface LinkedInExtra extends Record<string, unknown> {
  distributionFeed?: 'MAIN_FEED' | 'NONE';
  commentsEnabled?: boolean;
}
export interface LinkedInAccountConfig extends AccountConfig {
  auth: AccountConfig['auth'] & { accessToken?: string };
}
export interface LinkedinPlatformDeps {
  logger: ILogger;
  fetch?: typeof fetch;
}
type Json = Record<string, unknown>;
export class LinkedinPlatform implements IPlatform {
  readonly name = 'linkedin';
  readonly capabilities = linkedinCapabilities;
  constructor(private readonly deps: LinkedinPlatformDeps) {}
  async publish(
    request: PostRequest<LinkedInExtra>,
    account: LinkedInAccountConfig & ResolvedAccountConfig,
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
    const author = account.target?.id;
    if (!author) throw new ValidationError('LinkedIn requires an author URN target');
    const content: Json = {};
    const refs = (request.media ?? []).map(item => {
      if (item.source.kind !== 'platformRef')
        throw new ValidationError('LinkedIn media must be an uploaded asset reference');
      return item.source.ref;
    });
    if (refs.length)
      content.media = refs.map((id, index) => ({ id, altText: request.media?.[index]?.altText }));
    const payload: Json = {
      author,
      commentary: request.body ?? '',
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: request.extra?.distributionFeed ?? 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
      ...content,
    };
    if (request.extra?.commentsEnabled === false) payload.commentary = request.body ?? '';
    const response = await httpRequest(`${DEFAULT_API_BASE_URL}/posts`, {
      method: 'POST',
      headers: headers(account),
      body: JSON.stringify(payload),
      signal: options?.signal,
      fetch: this.deps.fetch,
    });
    if (!response.ok) throw await platformError('LinkedIn', response);
    const data = await json(response),
      id = response.headers.get('x-restli-id') ?? string(data.id) ?? string(data.urn);
    if (!id)
      throw new PlatformError('LinkedIn returned no post id', ErrorCode.UNKNOWN_OUTCOME, {
        retryable: false,
      });
    return { status: 'published', postId: id, parts: [{ id }], ref: { postId: id }, raw: data };
  }
}
function headers(a: LinkedInAccountConfig & ResolvedAccountConfig): Record<string, string> {
  const token = a.auth.accessToken;
  if (typeof token !== 'string' || !token)
    throw new ValidationError('LinkedIn accessToken is required');
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'linkedin-version': LINKEDIN_VERSION,
    'x-restli-protocol-version': '2.0.0',
  };
}
async function json(r: Response): Promise<Json> {
  try {
    return (await r.json()) as Json;
  } catch {
    return {};
  }
}
function string(v: unknown) {
  return typeof v === 'string' && v ? v : undefined;
}
async function platformError(label: string, r: Response) {
  const body = await r.text(),
    retry = Number(r.headers.get('retry-after'));
  if (r.status === 429)
    return new PlatformError(`${label} rate limited: ${body}`, ErrorCode.RATE_LIMIT_ERROR, {
      retryable: true,
      retryAfterMs: Number.isFinite(retry) ? retry * 1000 : undefined,
      httpStatus: r.status,
    });
  if (r.status === 401 || r.status === 403)
    return new PlatformError(
      `${label} rejected credentials: ${body}`,
      ErrorCode.AUTH_REFRESH_REQUIRED,
      { retryable: false, httpStatus: r.status },
    );
  return new PlatformError(
    `${label} responded with ${r.status}: ${body}`,
    r.status >= 500 ? ErrorCode.PLATFORM_ERROR : ErrorCode.CONTENT_REJECTED,
    { retryable: r.status >= 500, httpStatus: r.status },
  );
}
