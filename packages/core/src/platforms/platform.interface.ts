import type { PostType } from '../types/post-type.js';
import type { PostRequest } from '../types/post-request.js';
import type { ResolvedAccountConfig } from '../types/account-config.js';
import type { JsonValue, ResumeHandle } from '../types/resume-handle.js';
import type { PlatformError } from '../errors/platform-error.js';
import type { PlatformCapabilities, QuotaState } from './capabilities.js';
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
 * What a network reported about itself for one account, plus how long the host
 * may keep it. The library never caches this: it hands it back and the host
 * decides where it lives.
 */
export interface ResolvedCapabilities {
  /** The static descriptor with the runtime reading folded over it. */
  capabilities: PlatformCapabilities;
  /**
   * How long the host may reuse this, in seconds. `0` means "fetch before
   * every publication" (TikTok's Creator Info is the reason this exists).
   */
  cacheableForSecs?: number;
  /** When the reading was taken (ISO 8601). */
  fetchedAt: string;
}

/**
 * What an adapter reports from a runtime capability lookup.
 *
 * Only the fields the network actually told it about: the core folds them over
 * the static descriptor with {@link mergeCapabilities}, so the merge rule is
 * one implementation rather than one per adapter.
 */
export interface RuntimeCapabilities {
  capabilities: Partial<PlatformCapabilities>;
  /** How long the host may reuse this, in seconds. `0` means never cache. */
  cacheableForSecs?: number;
  /** When the reading was taken (ISO 8601). */
  fetchedAt: string;
}

/**
 * What `reconcile()` found out about a publication whose outcome was unknown.
 */
export type ReconcileOutcome =
  | { status: 'published'; postId?: string; url?: string; ref?: PostRef; parts?: PostPart[] }
  | { status: 'absent' }
  | { status: 'unknown' };

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
  /**
   * Capabilities the host resolved for this account, when the platform has a
   * `resolveCapabilities()` and the host called it. Absent means the static
   * descriptor applies.
   */
  capabilities?: PlatformCapabilities;
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
   * What this network accepts for *this account*, asked at runtime.
   *
   * For networks whose real limits are per-account (TikTok's Creator Info,
   * a Mastodon instance's `/api/v1/instance`). The result is returned to the
   * host together with `cacheableForSecs`; the library stores nothing.
   */
  resolveCapabilities?(
    accountConfig: ResolvedAccountConfig,
    signal?: AbortSignal,
  ): Promise<RuntimeCapabilities>;

  /**
   * Remaining allowance, for networks with an endpoint that reports it
   * (Vimeo's storage, Instagram's rolling publish window).
   */
  getQuota?(accountConfig: ResolvedAccountConfig, signal?: AbortSignal): Promise<QuotaState>;

  /**
   * Find out whether a publication whose outcome was unknown actually happened.
   *
   * The alternative to this is repeating `create` after a timeout, which is how
   * a network ends up with two identical posts. A platform that cannot answer
   * the question omits this and declares `supportsIdempotencyKey` instead; a
   * platform with neither makes the core report `UNKNOWN_OUTCOME`.
   */
  reconcile?(
    handle: ResumeHandle,
    accountConfig: ResolvedAccountConfig,
    signal?: AbortSignal,
  ): Promise<ReconcileOutcome>;

  /**
   * Edit a published post.
   *
   * Reserved: declared now so that adding editing later does not change the
   * shape of `PostRef`, of which hosts already store millions.
   */
  edit?(
    ref: PostRef,
    request: PostRequest,
    accountConfig: ResolvedAccountConfig,
    options?: PublishOptions,
  ): Promise<PlatformPublishResponse>;

  /**
   * Check on a post that `publish()` left in `processing`.
   */
  checkStatus?(
    handle: ResumeHandle,
    accountConfig: ResolvedAccountConfig,
    signal?: AbortSignal,
  ): Promise<PlatformStatusResponse>;
}
