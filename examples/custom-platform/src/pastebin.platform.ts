/**
 * A complete social network implemented outside the library.
 *
 * Nothing here imports anything private, and nothing in `@bozonx/social-posting`
 * knows this file exists. If this compiles and passes the same contract tests
 * the built-in platforms do, the extension seam is real rather than nominal.
 */
import { ErrorCode, PlatformError, PostType, ValidationError } from '@bozonx/social-posting';
import { MediaInputHelper, httpRequest } from '@bozonx/social-posting/platform';
import type {
  ILogger,
  PlatformCapabilities,
  PlatformModule,
  PostRequest,
  ResolvedAccountConfig,
} from '@bozonx/social-posting';
import type {
  IPlatform,
  PlatformPublishResponse,
  PublishOptions,
} from '@bozonx/social-posting/platform';

/** What this imaginary network accepts, stated as data. */
export const pastebinCapabilities: PlatformCapabilities = {
  name: 'pastebin',
  postTypes: {
    [PostType.POST]: {
      requiredFields: ['body'],
      forbiddenFields: ['media'],
    },
  },
  maxBodyLength: 512_000,
  supportedBodyFormats: ['text'],
  targetBodyFormat: 'text',
  ignoredFields: ['tags', 'description', 'language'],
  rateLimits: { postsPerDay: 100 },
};

/** Credentials this network expects. */
interface PastebinAuth {
  apiKey?: string;
}

class PastebinPlatform implements IPlatform {
  readonly name = 'pastebin';
  readonly capabilities = pastebinCapabilities;

  constructor(private readonly logger: ILogger) {}

  async publish(
    request: PostRequest,
    accountConfig: ResolvedAccountConfig,
    options?: PublishOptions,
  ): Promise<PlatformPublishResponse> {
    const body = request.body?.trim();
    if (!body) {
      throw new ValidationError("Field 'body' is required for pastebin");
    }
    if (MediaInputHelper.isNotEmpty(request.media)) {
      throw new ValidationError('pastebin does not accept media');
    }

    const { apiKey } = accountConfig.auth as PastebinAuth;
    const response = await httpRequest('https://pastebin.example/api/paste', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ content: body, title: request.title }),
      signal: options?.signal,
    });

    if (!response.ok) {
      // Classify once, here, so the host reads one error shape for every network.
      const retryAfter = Number(response.headers.get('retry-after'));
      throw new PlatformError(
        `pastebin responded with ${response.status}`,
        response.status === 429 ? ErrorCode.RATE_LIMIT_ERROR : ErrorCode.PLATFORM_ERROR,
        {
          retryable: response.status === 429 || response.status >= 500,
          retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined,
          httpStatus: response.status,
        },
      );
    }

    const created = (await response.json()) as { id: string; url: string };
    this.logger.log(`Published paste ${created.id}`, 'PastebinPlatform');

    return { status: 'published', postId: created.id, url: created.url };
  }
}

/** The one object a host registers to publish to this network. */
export const pastebin: PlatformModule = {
  name: 'pastebin',
  capabilities: pastebinCapabilities,
  create: deps => new PastebinPlatform(deps.logger),
  authValidator: {
    providerName: 'pastebin',
    validate: auth => ({
      errors: typeof auth.apiKey === 'string' ? [] : ["Field 'apiKey' is required"],
    }),
  },
};
