import type { PostType } from './post-type.js';
import type { ErrorCode } from '../errors/error-code.js';
import type { JsonValue, ResumeHandle } from './resume-handle.js';
import type { PlatformTarget } from './target.js';

export interface Issue {
  /** Stable machine code, e.g. 'BODY_TOO_LONG', 'FIELD_REQUIRED', 'FIELD_UNSUPPORTED'. */
  code: string;
  /** Request path the issue is about, e.g. 'media[2].altText'. */
  field?: string;
  /** English message; hosts localize from `code` + `params`. */
  message: string;
  params?: Record<string, JsonValue>;
}

export interface PostPart {
  id: string;
  target?: PlatformTarget;
  url?: string;
  /** Adapter-defined kind; it need not be a media type. */
  kind?: string;
}

export interface PostRef {
  postId?: string;
  target?: PlatformTarget;
  parts?: PostPart[];
  extra?: Record<string, JsonValue>;
}

export interface ErrorPayload {
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
  /** Progress a resumed call can continue from. */
  resumeHandle?: ResumeHandle;
  /** Additional error details. */
  details?: Record<string, unknown>;
  /** Raw error payload from the platform API. */
  raw?: unknown;
  /** Unique request identifier for tracking. */
  requestId: string;
}

/**
 * A publication that the platform accepted.
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
    /** Every platform object this publication created, when it created more than one. */
    parts?: PostPart[];
    /** Canonical value to persist for deletion and future editing. */
    ref: PostRef;
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
    raw?: unknown;
    /** Unique request identifier for tracking. */
    requestId: string;
  };
}

/**
 * A publication that failed.
 */
export interface ErrorResponse {
  success: false;
  error: ErrorPayload;
}

/** Either outcome of `PostingClient.post()`. */
export type PostResult = PostResponse | ErrorResponse;

/**
 * The outcome of `PostingClient.checkStatus()`.
 */
export type StatusResult =
  | {
      success: true;
      data: {
        status: 'published' | 'processing' | 'failed';
        postId?: string;
        url?: string;
        ref?: PostRef;
        checkAfterMs?: number;
        /** Why the platform rejected it, when status is 'failed'. */
        reason?: ErrorPayload;
        raw?: JsonValue;
      };
    }
  | { success: false; error: ErrorPayload };

export interface DeletePartResult {
  id: string;
  status: 'deleted' | 'alreadyGone' | 'failed' | 'unknown';
  error?: ErrorPayload;
}

export interface DeleteOutcome {
  status: 'deleted' | 'partial';
  parts: DeletePartResult[];
  /** Present when deletion can continue without repeating completed parts. */
  handle?: ResumeHandle;
}

export type DeleteResult =
  | {
      success: true;
      data: {
        status: 'deleted' | 'partial';
        parts: DeletePartResult[];
        /** Present when deletion can continue without repeating completed parts. */
        handle?: ResumeHandle;
      };
    }
  | { success: false; error: ErrorPayload };
