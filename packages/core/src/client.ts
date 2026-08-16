import { PostingConfig, type PostingConfigInput } from './config/posting-config.js';
import { PlatformRegistry } from './platforms/platform-registry.js';
import { AuthValidatorRegistry } from './platforms/auth-validator-registry.js';
import { PostService } from './services/post.service.js';
import { PreviewService } from './services/preview.service.js';
import { ConsoleLogger, type ILogger } from './logger/logger.js';
import type { IPlatform } from './platforms/platform.interface.js';
import type { IAuthValidator } from './platforms/auth-validator.interface.js';
import type { PostRequest } from './types/post-request.js';
import type { PostResult } from './types/post-response.js';
import type { PreviewResult } from './types/preview-response.js';

/**
 * Everything needed to build a posting client.
 */
export interface PostingClientOptions extends PostingConfigInput {
  /** Platform implementations to serve. The core ships none of its own. */
  platforms?: IPlatform[];
  /** Credential-shape validators, one per platform at most. */
  authValidators?: IAuthValidator[];
  /**
   * Logger the client writes to. Defaults to a console logger at `logLevel`.
   * Nothing outside the client is ever reconfigured — no ambient logger is touched.
   */
  logger?: ILogger;
}

/**
 * The library's entry point: publish and preview posts on registered platforms.
 */
export interface PostingClient {
  /**
   * Publish a post.
   * @param request - Post request with platform, content and media.
   * @param abortSignal - Aborts the operation, including the in-flight platform call.
   */
  post(request: PostRequest, abortSignal?: AbortSignal): Promise<PostResult>;

  /**
   * Validate a post and report what publishing it would do, without publishing.
   * @param request - Post request to preview.
   */
  preview(request: PostRequest): Promise<PreviewResult>;

  /**
   * Register an additional platform after construction.
   * @param platform - Platform implementation.
   * @param authValidator - Optional validator for that platform's credentials.
   */
  registerPlatform(platform: IPlatform, authValidator?: IAuthValidator): void;

  /** Names of every platform this client can publish to. */
  getRegisteredPlatforms(): string[];
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

  for (const platform of options.platforms ?? []) {
    platformRegistry.register(platform);
  }
  for (const validator of options.authValidators ?? []) {
    authValidatorRegistry.register(validator);
  }

  const deps = { config, platformRegistry, authValidatorRegistry, logger };
  const postService = new PostService(deps);
  const previewService = new PreviewService(deps);

  return {
    post(request: PostRequest, abortSignal?: AbortSignal): Promise<PostResult> {
      return postService.publish(request, abortSignal);
    },

    preview(request: PostRequest): Promise<PreviewResult> {
      return previewService.preview(request);
    },

    registerPlatform(platform: IPlatform, authValidator?: IAuthValidator): void {
      platformRegistry.register(platform);
      if (authValidator) {
        authValidatorRegistry.register(authValidator);
      }
    },

    getRegisteredPlatforms(): string[] {
      return platformRegistry.getRegisteredPlatforms();
    },
  };
}
