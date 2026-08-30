import { PostingConfig, type PostingConfigInput } from './config/posting-config.js';
import { PlatformRegistry } from './platforms/platform-registry.js';
import { AuthValidatorRegistry } from './platforms/auth-validator-registry.js';
import {
  PostService,
  type DeleteCallOptions,
  type PublishCallOptions,
} from './services/post.service.js';
import { PreviewService, type PreviewCallOptions } from './services/preview.service.js';
import { ConsoleLogger, type ILogger } from './logger/logger.js';
import type { PlatformModule } from './platforms/platform-module.js';
import type { PlatformCapabilities, QuotaState } from './platforms/capabilities.js';
import type { ResolvedCapabilities } from './platforms/platform.interface.js';
import type { PostRequest } from './types/post-request.js';
import type { PostResult, StatusResult, DeleteResult, PostRef } from './types/post-response.js';
import type { PreviewResult } from './types/preview-response.js';
import type { ResumeHandle } from './types/resume-handle.js';
import type { CredentialProvider } from './auth/credentials.js';

export type { DeleteCallOptions, PublishCallOptions, PreviewCallOptions };

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
   */
  credentialProvider?: CredentialProvider;
  /**
   * Custom fetch implementation for tests, regional endpoints or proxies.
   */
  fetch?: typeof fetch;
}

/**
 * The library's entry point: publish, delete and preview posts on registered platforms.
 */
export interface PostingClient {
  /**
   * Publish a post. Exactly one attempt; retrying is the caller's job.
   * @param request - Post request with platform, content and media.
   * @param options - Abort signal and optional resume handle from a failed attempt.
   */
  post(request: PostRequest, options?: PublishCallOptions): Promise<PostResult>;

  /**
   * Delete a published post by reference.
   * @param request - Platform, account, auth and target information.
   * @param ref - PostRef identifying the post and its parts to delete.
   * @param options - Abort signal, resume handle and includeRaw.
   */
  delete(
    request: Pick<PostRequest, 'platform' | 'account' | 'auth' | 'target'>,
    ref: PostRef,
    options?: DeleteCallOptions,
  ): Promise<DeleteResult>;

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
   * @param options - Capabilities the host resolved for this account, when it has them.
   */
  preview(request: PostRequest, options?: PreviewCallOptions): Promise<PreviewResult>;

  /**
   * Ask a network what it accepts for one account, right now.
   *
   * Nothing is cached: the answer carries `cacheableForSecs`, and where that is
   * `0` the call belongs before every publication.
   * @param request - Enough of a request to resolve the platform and credentials.
   * @param signal - Aborts the lookup.
   */
  resolveCapabilities(
    request: Pick<PostRequest, 'platform' | 'account' | 'auth'>,
    signal?: AbortSignal,
  ): Promise<ResolvedCapabilities>;

  /**
   * Remaining allowance for an account, where the network reports one.
   * @param request - Enough of a request to resolve the platform and credentials.
   * @param signal - Aborts the lookup.
   */
  getQuota(
    request: Pick<PostRequest, 'platform' | 'account' | 'auth'>,
    signal?: AbortSignal,
  ): Promise<QuotaState>;

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
 * @param options - Accounts, tuning knobs, platforms, fetch and an optional logger.
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
      platformModule.create({
        logger,
        credentialProvider: options.credentialProvider,
        fetch: options.fetch,
      }),
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

    delete(
      request: Pick<PostRequest, 'platform' | 'account' | 'auth' | 'target'>,
      ref: PostRef,
      options?: DeleteCallOptions,
    ): Promise<DeleteResult> {
      return postService.delete(request, ref, options);
    },

    checkStatus(
      request: Pick<PostRequest, 'platform' | 'account' | 'auth'>,
      handle: ResumeHandle,
      signal?: AbortSignal,
    ): Promise<StatusResult> {
      return postService.checkStatus(request, handle, signal);
    },

    preview(request: PostRequest, previewOptions?: PreviewCallOptions): Promise<PreviewResult> {
      return previewService.preview(request, previewOptions);
    },

    resolveCapabilities(
      request: Pick<PostRequest, 'platform' | 'account' | 'auth'>,
      signal?: AbortSignal,
    ): Promise<ResolvedCapabilities> {
      return postService.resolveCapabilities(request, signal);
    },

    getQuota(
      request: Pick<PostRequest, 'platform' | 'account' | 'auth'>,
      signal?: AbortSignal,
    ): Promise<QuotaState> {
      return postService.getQuota(request, signal);
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
