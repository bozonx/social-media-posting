import { PostingConfig, type PostingConfigInput } from './config/posting-config.js';
import { PlatformRegistry } from './platforms/platform-registry.js';
import { AuthValidatorRegistry } from './platforms/auth-validator-registry.js';
import { PostService } from './services/post.service.js';
import { PreviewService } from './services/preview.service.js';
import { ConsoleLogger, type ILogger } from './logger/logger.js';
import type { PlatformModule } from './platforms/platform-module.js';
import type { PlatformCapabilities } from './platforms/capabilities.js';
import type { PostRequest } from './types/post-request.js';
import type { PostResult, StatusResult } from './types/post-response.js';
import type { PreviewResult } from './types/preview-response.js';
import type { ResumeHandle } from './types/resume-handle.js';
import type { PublishCallOptions } from './services/post.service.js';
import type { CredentialProvider } from './auth/credentials.js';

/**
 * Everything needed to build a posting client.
 */
export interface PostingClientOptions extends PostingConfigInput {
  /**
   * Networks this client can publish to, as the descriptors their packages
   * export. The core ships none of its own.
   */
  platforms?: PlatformModule[];
  /**
   * Logger the client writes to. Defaults to a console logger at `logLevel`.
   * Nothing outside the client is ever reconfigured — no ambient logger is touched.
   */
  logger?: ILogger;
  /**
   * Where credentials come from, and where rotated ones go back to.
   *
   * Omit it and the accounts in `accounts` are used as-is, which is right for
   * static-token networks. A host serving a network with expiring tokens
   * supplies its own, backed by its encrypted store.
   */
  credentialProvider?: CredentialProvider;
}

/**
 * The library's entry point: publish and preview posts on registered platforms.
 */
export interface PostingClient {
  /**
   * Publish a post. Exactly one attempt; retrying is the caller's job.
   * @param request - Post request with platform, content and media.
   * @param options - Abort signal and optional resume handle from a failed attempt.
   */
  post(request: PostRequest, options?: PublishCallOptions): Promise<PostResult>;

  /**
   * Check on a post that `post()` left in `processing`.
   * @param request - Enough of a request to resolve the platform and credentials.
   * @param handle - The handle `post()` returned.
   * @param signal - Aborts the operation.
   */
  checkStatus(
    request: Pick<PostRequest, 'platform' | 'account' | 'auth'>,
    handle: ResumeHandle,
    signal?: AbortSignal,
  ): Promise<StatusResult>;

  /**
   * Validate a post and report what publishing it would do, without publishing.
   * @param request - Post request to preview.
   */
  preview(request: PostRequest): Promise<PreviewResult>;

  /**
   * Register an additional network after construction.
   * @param platformModule - The descriptor the network's package exports.
   */
  registerPlatform(platformModule: PlatformModule): void;

  /** Names of every platform this client can publish to. */
  getRegisteredPlatforms(): string[];

  /**
   * Read what a platform accepts — post types, limits, formats — so a host UI
   * can show its rules without attempting a publish.
   * @param platform - Platform name.
   * @throws ValidationError if the platform is not registered.
   */
  getCapabilities(platform: string): PlatformCapabilities;
}

/**
 * Create a posting client.
 *
 * The client owns nothing global: two clients can coexist in one process with
 * different accounts and different loggers.
 *
 * @param options - Accounts, tuning knobs, platforms and an optional logger.
 * @returns A ready-to-use client.
 * @throws Error if the configuration is invalid.
 */
export function createPostingClient(options: PostingClientOptions): PostingClient {
  const config = new PostingConfig(options);
  const logger = options.logger ?? new ConsoleLogger(config.logLevel);

  const platformRegistry = new PlatformRegistry();
  const authValidatorRegistry = new AuthValidatorRegistry();

  const register = (platformModule: PlatformModule): void => {
    platformRegistry.register(
      platformModule.create({ logger, credentialProvider: options.credentialProvider }),
    );
    if (platformModule.authValidator) {
      authValidatorRegistry.register(platformModule.authValidator);
    }
  };

  for (const platformModule of options.platforms ?? []) {
    register(platformModule);
  }

  const deps = {
    config,
    platformRegistry,
    authValidatorRegistry,
    logger,
    credentialProvider: options.credentialProvider,
  };
  const postService = new PostService(deps);
  const previewService = new PreviewService(deps);

  return {
    post(request: PostRequest, options?: PublishCallOptions): Promise<PostResult> {
      return postService.publish(request, options);
    },

    checkStatus(
      request: Pick<PostRequest, 'platform' | 'account' | 'auth'>,
      handle: ResumeHandle,
      signal?: AbortSignal,
    ): Promise<StatusResult> {
      return postService.checkStatus(request, handle, signal);
    },

    preview(request: PostRequest): Promise<PreviewResult> {
      return previewService.preview(request);
    },

    registerPlatform(platformModule: PlatformModule): void {
      register(platformModule);
    },

    getRegisteredPlatforms(): string[] {
      return platformRegistry.getRegisteredPlatforms();
    },

    getCapabilities(platform: string): PlatformCapabilities {
      return platformRegistry.getCapabilities(platform);
    },
  };
}
