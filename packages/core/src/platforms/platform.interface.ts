import type { PostType } from '../types/post-type.js';
import type { PostRequest } from '../types/post-request.js';
import type { PreviewResult } from '../types/preview-response.js';
import type { ResolvedAccountConfig } from '../types/account-config.js';
import type { ResumeHandle } from '../types/resume-handle.js';
import type { PlatformError } from '../errors/platform-error.js';

/**
 * What a platform reports after `publish()` returns without throwing.
 *
 * `published` means the post exists. `processing` means the platform accepted
 * the content and will materialize it later — TikTok and YouTube take minutes,
 * and moderation can still reject it. In that case the host schedules a
 * follow-up job for `checkStatus()`; this library polls nothing on its own.
 */
export interface PlatformPublishResponse {
  /** Whether the post exists yet. */
  status: 'published' | 'processing';
  /** Platform-specific post ID, once the platform has assigned one. */
  postId?: string;
  /** Public URL to the post (if available). */
  url?: string;
  /** Handle to pass to `checkStatus()` while the post is still processing. */
  handle?: ResumeHandle;
  /** How long to wait before the first status check, when the platform says so. */
  checkAfterMs?: number;
  /** Raw response from the platform API. */
  raw?: Record<string, unknown>;
}

/**
 * The outcome of `checkStatus()` for a post that was still processing.
 */
export interface PlatformStatusResponse {
  status: 'published' | 'processing' | 'failed';
  /** Platform-specific post ID, once assigned. */
  postId?: string;
  /** Public URL to the post (if available). */
  url?: string;
  /** How long to wait before checking again, while still processing. */
  checkAfterMs?: number;
  /** Why the platform rejected the post, when `status` is `failed`. */
  error?: PlatformError;
  /** Raw response from the platform API. */
  raw?: Record<string, unknown>;
}

/**
 * Options for a single publish call.
 */
export interface PublishOptions {
  /** Aborts the operation, including any in-flight HTTP call. */
  signal?: AbortSignal;
  /**
   * Progress from a previous, failed attempt. When present the platform
   * continues from that step rather than starting the sequence again.
   */
  resume?: ResumeHandle;
}

/**
 * The contract every social network implementation fulfils.
 *
 * Implementations live in their own package, depend only on
 * `@bozonx/social-posting`, and are handed to the client at construction.
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
   *
   * Throws {@link PlatformError} on failure, carrying the classification, any
   * `retryAfterMs` the platform stated, and a `resumeHandle` when the attempt
   * left recoverable progress behind.
   *
   * @param request - Post request data.
   * @param accountConfig - Resolved credentials and per-account settings.
   * @param options - Abort signal and optional resume handle.
   */
  publish(
    request: PostRequest,
    accountConfig: ResolvedAccountConfig,
    options?: PublishOptions,
  ): Promise<PlatformPublishResponse>;

  /**
   * Validate a post and report what would happen, without publishing.
   * @param request - Post request data.
   * @param accountConfig - Resolved credentials and per-account settings.
   */
  preview(request: PostRequest, accountConfig: ResolvedAccountConfig): Promise<PreviewResult>;

  /**
   * Check on a post that `publish()` left in `processing`.
   *
   * Implemented only by platforms that materialize posts asynchronously. The
   * host decides when to call it; this library never polls.
   *
   * @param handle - The handle returned by `publish()`.
   * @param accountConfig - Resolved credentials and per-account settings.
   * @param signal - Aborts the operation.
   */
  checkStatus?(
    handle: ResumeHandle,
    accountConfig: ResolvedAccountConfig,
    signal?: AbortSignal,
  ): Promise<PlatformStatusResponse>;
}
