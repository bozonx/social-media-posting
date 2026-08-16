import type { PostType } from '../types/post-type.js';
import type { PostRequest } from '../types/post-request.js';
import type { PreviewResult } from '../types/preview-response.js';
import type { ResolvedAccountConfig } from '../types/account-config.js';

/**
 * Response from a platform after a successful publication.
 */
export interface PlatformPublishResponse {
  /** Platform-specific post ID. */
  postId: string;
  /** Public URL to the post (if available). */
  url?: string;
  /** Raw response from the platform API. */
  raw?: Record<string, unknown>;
}

/**
 * The contract every social network implementation fulfils.
 *
 * Implementations live in their own package, depend only on `@bozonx/social-posting`
 * and are handed to the client through a {@link PlatformModule} descriptor.
 */
export interface IPlatform {
  /** Platform name (e.g. 'telegram'). */
  readonly name: string;
  /** Post types this platform can publish. */
  readonly supportedTypes: PostType[];
  /** Whether a cover image may accompany other media (e.g. a video cover). */
  readonly supportsCoverWithMedia?: boolean;

  /**
   * Publish a post.
   * @param request - Post request data.
   * @param accountConfig - Resolved credentials and per-account settings.
   * @param abortSignal - Aborts the operation, including any in-flight HTTP call.
   * @returns Publication result with post ID and URL.
   */
  publish(
    request: PostRequest,
    accountConfig: ResolvedAccountConfig,
    abortSignal?: AbortSignal,
  ): Promise<PlatformPublishResponse>;

  /**
   * Validate a post and report what would happen, without publishing.
   * @param request - Post request data.
   * @param accountConfig - Resolved credentials and per-account settings.
   */
  preview(request: PostRequest, accountConfig: ResolvedAccountConfig): Promise<PreviewResult>;
}
