import type { PostType } from './post-type.js';
import type { ErrorCode } from '../errors/error-code.js';
import type { ResumeHandle } from './resume-handle.js';

/**
 * A publication that the platform accepted.
 *
 * `status` distinguishes a post that exists from one the platform is still
 * materializing. For `processing`, `handle` and `checkAfterMs` tell the host
 * how and when to follow up.
 */
export interface PostResponse {
  success: true;
  data: {
    /** Whether the post exists yet. */
    status: 'published' | 'processing';
    /** Platform-specific post ID, once the platform has assigned one. */
    postId?: string;
    /** Public URL to the post (if available). */
    url?: string;
    /** Handle for `checkStatus()` while the post is still processing. */
    handle?: ResumeHandle;
    /** How long to wait before the first status check. */
    checkAfterMs?: number;
    /** Platform name. */
    platform: string;
    /** Actual post type used. */
    type: PostType;
    /** Publication timestamp (ISO 8601). */
    publishedAt: string;
    /** Raw response from the platform API. */
    raw?: Record<string, unknown>;
    /** Unique request identifier for tracking. */
    requestId: string;
  };
}

/**
 * A publication that failed.
 *
 * Everything a host needs for its own backoff is here: whether to retry at all,
 * how long to wait, and — for a multi-step publication — where to resume from.
 */
export interface ErrorResponse {
  success: false;
  error: {
    /** Error code for categorization. */
    code: ErrorCode;
    /** Human-readable error message. */
    message: string;
    /** Whether repeating the call could succeed. */
    retryable: boolean;
    /** How long to wait before repeating, when the platform said so. */
    retryAfterMs?: number;
    /** HTTP status the platform answered with. */
    httpStatus?: number;
    /** Platform's own error code, verbatim. */
    platformCode?: string;
    /**
     * Progress a resumed call can continue from. Pass it back as
     * `post(request, { resume })` instead of repeating the whole request.
     */
    resumeHandle?: ResumeHandle;
    /** Additional error details. */
    details?: Record<string, unknown>;
    /** Raw error payload from the platform API. */
    raw?: unknown;
    /** Unique request identifier for tracking. */
    requestId: string;
  };
}

/** Either outcome of `PostingClient.post()`. */
export type PostResult = PostResponse | ErrorResponse;

/**
 * The outcome of `PostingClient.checkStatus()`.
 */
export interface StatusResult {
  status: 'published' | 'processing' | 'failed';
  /** Platform-specific post ID, once assigned. */
  postId?: string;
  /** Public URL to the post (if available). */
  url?: string;
  /** How long to wait before checking again, while still processing. */
  checkAfterMs?: number;
  /** Why the platform rejected the post, when `status` is `failed`. */
  error?: ErrorResponse['error'];
  /** Raw response from the platform API. */
  raw?: Record<string, unknown>;
}
