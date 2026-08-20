import type { PostType } from '../types/post-type.js';
import type { PostRequest } from '../types/post-request.js';
import type { PreviewResult } from '../types/preview-response.js';
import type { ResolvedAccountConfig } from '../types/account-config.js';
import type { JsonValue, ResumeHandle } from '../types/resume-handle.js';
import type { PlatformError } from '../errors/platform-error.js';
import type { PlatformCapabilities } from './capabilities.js';
import type { PostPart, PostRef, DeleteOutcome, Issue } from '../types/post-response.js';

/**
 * What a platform reports after `publish()` returns without throwing.
 */
export interface PlatformPublishResponse {
  /** Whether the post exists yet. */
  status: 'published' | 'processing';
  /** Platform-specific post ID, once the platform has assigned one. */
  postId?: string;
  /** Public URL to the post (if available). */
  url?: string;
  /** Every platform object this publication created. */
  parts?: PostPart[];
  /** Canonical reference to persist for deletion and status checking. */
  ref?: PostRef;
  /** Handle to pass to `checkStatus()` while the post is still processing. */
  handle?: ResumeHandle;
  /** How long to wait before the first status check, when the platform says so. */
  checkAfterMs?: number;
  /** Raw response from the platform API. */
  raw?: unknown;
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
  /** Canonical reference for the completed publication. */
  ref?: PostRef;
  /** How long to wait before checking again, while still processing. */
  checkAfterMs?: number;
  /** Why the platform rejected the post, when `status` is `failed`. */
  error?: PlatformError;
  /** Raw response from the platform API. */
  raw?: JsonValue;
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
 * Options for a deletion call.
 */
export interface DeleteOptions {
  /** Aborts the operation, including any in-flight HTTP call. */
  signal?: AbortSignal;
  /** Resume from an earlier partial deletion. */
  resume?: ResumeHandle;
}

/**
 * The contract every social network implementation fulfils.
 */
export interface IPlatform {
  /** Platform name (e.g. 'telegram'). */
  readonly name: string;
  /**
   * What this platform accepts, as data: post types, limits, formats and
   * transport traits. Generic validation and preview read it, so a platform
   * states its rules once instead of re-implementing the checks.
   */
  readonly capabilities: PlatformCapabilities;

  /**
   * Publish a post.
   */
  publish(
    request: PostRequest,
    accountConfig: ResolvedAccountConfig,
    options?: PublishOptions,
  ): Promise<PlatformPublishResponse>;

  /**
   * Delete a post by reference.
   *
   * Optional: implemented by platforms that support deleting publications.
   */
  delete?(
    ref: PostRef,
    accountConfig: ResolvedAccountConfig,
    options?: DeleteOptions,
  ): Promise<DeleteOutcome>;

  /**
   * Validate a post and report what would happen, without publishing.
   */
  preview?(request: PostRequest, accountConfig: ResolvedAccountConfig): Promise<PreviewResult>;

  /**
   * Type detection for a network whose type system does not match the generic
   * rules. Optional; {@link detectPostType} is used when absent.
   */
  detectType?(request: PostRequest): PostType;

  /**
   * Rules the capability descriptor cannot express.
   * @returns Issues or error messages; an empty array means the request passes.
   */
  validateExtra?(
    request: PostRequest,
    accountConfig: ResolvedAccountConfig,
    detectedType: PostType,
  ): Issue[] | string[];

  /**
   * Check on a post that `publish()` left in `processing`.
   */
  checkStatus?(
    handle: ResumeHandle,
    accountConfig: ResolvedAccountConfig,
    signal?: AbortSignal,
  ): Promise<PlatformStatusResponse>;
}
