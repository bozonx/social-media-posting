import {
  ErrorCode,
  PlatformError,
  ValidationError,
} from '@bozonx/social-posting';
import {
  httpRequest,
  validateAgainstCapabilities,
} from '@bozonx/social-posting/platform';
import type {
  Issue,
  PostRequest,
  PostType,
  ResolvedAccountConfig,
} from '@bozonx/social-posting';
import type {
  CapabilityValidationOptions,
  ILogger,
  IPlatform,
  PlatformPublishResponse,
  PublishOptions,
} from '@bozonx/social-posting/platform';
import { discordCapabilities } from './capabilities.js';

/** Collaborators this platform needs, passed explicitly. */
export interface DiscordPlatformDeps {
  logger: ILogger;
  fetch?: typeof fetch;
}

const LOG_CONTEXT = 'DiscordPlatform';

export class DiscordPlatform implements IPlatform {
  readonly name = 'discord';
  readonly capabilities = discordCapabilities;

  private readonly logger: ILogger;
  private readonly fetch?: typeof fetch;

  constructor(deps: DiscordPlatformDeps) {
    this.logger = deps.logger;
    this.fetch = deps.fetch;
  }

  async publish(
    request: PostRequest,
    accountConfig: ResolvedAccountConfig,
    options?: PublishOptions,
  ): Promise<PlatformPublishResponse> {
    const signal = options?.signal;

    if (signal?.aborted) {
      throw new PlatformError('Request aborted before publishing', ErrorCode.NETWORK_ERROR, {
        retryable: false,
      });
    }

    const { issues } = validateAgainstCapabilities(
      request,
      this.capabilities,
      this.validationHooks(accountConfig),
    );
    if (issues.length > 0) {
      throw new ValidationError(issues);
    }

    // TODO: call the Discord API. Use httpRequest() so a connection that
    // dies before the request completes is retried once, and nothing else is.
    const response = await httpRequest('https://api.discord.example/posts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${String(accountConfig.auth.accessToken)}`,
      },
      body: JSON.stringify({ text: request.body }),
      signal,
      fetch: this.fetch,
    });

    if (!response.ok) {
      throw this.toPlatformError(response, await response.text());
    }

    const created = (await response.json()) as { id: string; url?: string };
    this.logger.log(`Published ${created.id}`, LOG_CONTEXT);

    return {
      status: 'published',
      postId: created.id,
      url: created.url,
      parts: [{ id: created.id, url: created.url }],
      ref: { postId: created.id },
    };
  }

  /** Rules the capability descriptor cannot express. */
  validateExtra(
    _request: PostRequest,
    _accountConfig: ResolvedAccountConfig,
    _type: PostType,
  ): Issue[] {
    return [];
  }

  private validationHooks(accountConfig: ResolvedAccountConfig): CapabilityValidationOptions {
    return {
      validateExtra: (request, type) => this.validateExtra(request, accountConfig, type),
    };
  }

  /**
   * Classify a Discord failure once, here, so the core never has to.
   *
   * Carry `retryAfterMs` whenever the network states a cool-down: it is what
   * lets the host back off correctly instead of guessing.
   */
  private toPlatformError(response: Response, body: string): PlatformError {
    const retryAfter = Number(response.headers.get('retry-after'));

    if (response.status === 429) {
      return new PlatformError(`Discord rate limited: ${body}`, ErrorCode.RATE_LIMIT_ERROR, {
        retryable: true,
        retryAfterMs: Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined,
        httpStatus: response.status,
      });
    }

    if (response.status === 401 || response.status === 403) {
      return new PlatformError(`Discord rejected the credentials: ${body}`, ErrorCode.AUTH_ERROR, {
        retryable: false,
        httpStatus: response.status,
      });
    }

    return new PlatformError(`Discord responded with ${response.status}: ${body}`,
      response.status >= 500 ? ErrorCode.PLATFORM_ERROR : ErrorCode.VALIDATION_ERROR,
      { retryable: response.status >= 500, httpStatus: response.status },
    );
  }
}
